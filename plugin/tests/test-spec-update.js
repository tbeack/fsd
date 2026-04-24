#!/usr/bin/env node
'use strict';

// Unit + integration tests for the spec update backing module (FSD-014).
// Covers: parseSpec (minimal, all 6 sections, unknown-heading tolerance,
// malformed frontmatter rejection), all 4 ops (update with each sub-target,
// approve, archive, supersede) including happy/refusal/idempotent/rollback
// paths, byte-preservation of untouched sections, atomicity under injected
// failure, every-op-bumps-updated, and round-trip through scanArtifacts.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseSpec,
  readSpec,
  writeSpecAtomic,
  rewriteFrontmatter,
  update,
  approve,
  archive,
  supersede,
  today,
} = require(path.join(__dirname, '..', 'scripts', 'spec-update.js'));
const { validateSpec } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { writeSpecFile, resolveSpecPath } = require(path.join(__dirname, '..', 'scripts', 'spec.js'));
const { writeProjectFiles } = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));
const { scanArtifacts } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-spec-upd-'));
}

function seedProject(planningDir, projectName = 'Demo Project') {
  return writeProjectFiles({
    planningDir,
    projectData: { project: projectName, id: 'demo', title: projectName, vision: 'demo' },
    roadmapData: { project: projectName, id: 'r', title: `${projectName} R`, version: '0.1', current_milestone: 'v1' },
  });
}

function seedSpec(projectPath, planningDir, id, overrides = {}) {
  const specData = Object.assign(
    {
      id,
      title: id.replace(/-/g, ' '),
      sections: {
        problem: `Problem for ${id}.`,
        goals: `Goals for ${id}.`,
        acceptance: `- [ ] Verifies ${id}.`,
      },
    },
    overrides,
  );
  const res = writeSpecFile({ projectPath, planningDir, specData });
  assert.strictEqual(res.ok, true, res.reason);
  return res.written[0];
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? parseYaml(m[1]) : {};
}

// Extract a specific section's body from rendered content by heading text.
function extractSectionBody(content, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'm');
  const m = content.match(re);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  // Find the next `## ` heading or EOF.
  const rest = content.slice(startIdx);
  const nextMatch = rest.match(/^##\s+/m);
  const endIdx = nextMatch ? nextMatch.index : rest.length;
  return rest.slice(0, endIdx).trim();
}

// --- exports + primitives ---

// Test 1: Module exports are shaped correctly.
{
  assert.strictEqual(typeof parseSpec, 'function');
  assert.strictEqual(typeof readSpec, 'function');
  assert.strictEqual(typeof writeSpecAtomic, 'function');
  assert.strictEqual(typeof rewriteFrontmatter, 'function');
  assert.strictEqual(typeof update, 'function');
  assert.strictEqual(typeof approve, 'function');
  assert.strictEqual(typeof archive, 'function');
  assert.strictEqual(typeof supersede, 'function');
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
}

// --- parseSpec ---

// Test 2: Parses a minimal spec file (frontmatter + title + 6 sections).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'minimal');

  const { parsed } = readSpec(sp);
  assert.strictEqual(parsed.frontmatter.id, 'minimal');
  assert.strictEqual(parsed.frontmatter.project, 'Demo Project');
  assert.ok(parsed.titleLine !== null, 'titleLine must be located');
  assert.strictEqual(parsed.sections.length, 6);
  assert.deepStrictEqual(
    parsed.sections.map(s => s.id),
    ['problem', 'goals', 'non_goals', 'requirements', 'acceptance', 'open_questions'],
  );
  // Each section's range spans from heading to next heading / EOF
  for (let i = 0; i < parsed.sections.length - 1; i++) {
    assert.strictEqual(parsed.sections[i].range[1], parsed.sections[i + 1].range[0]);
  }

  fs.rmSync(root, { recursive: true });
}

// Test 3: Unknown `##` headings are captured with id:null (user-authored sections tolerated).
{
  const content = `---
project: X
id: x
title: X
status: draft
created: 2026-04-24
---

# X

## Problem
P

## My Custom Block
body

## Goals
G
`;
  const parsed = parseSpec(content);
  const ids = parsed.sections.map(s => s.id);
  assert.deepStrictEqual(ids, ['problem', null, 'goals']);
  assert.strictEqual(parsed.sections[1].heading, 'My Custom Block');
  assert.strictEqual(parsed.sections[1].bodyContent, 'body');
}

// Test 4: Malformed frontmatter (no opening ---) is rejected.
{
  assert.throws(() => parseSpec('no frontmatter here\n'), /does not begin with/);
}

// Test 5: Unterminated frontmatter (no closing ---) is rejected.
{
  assert.throws(() => parseSpec('---\nproject: X\n(no close)\n'), /unterminated/);
}

// --- rewriteFrontmatter ---

// Test 6: rewriteFrontmatter scalar update preserves key order.
{
  const lines = '---\nproject: X\nid: x\nstatus: draft\ncreated: 2026-01-01\n---\n'.split('\n');
  const fmRange = [0, 5];
  const out = rewriteFrontmatter(lines, fmRange, { status: 'active' });
  assert.deepStrictEqual(out, ['---', 'project: X', 'id: x', 'status: active', 'created: 2026-01-01', '---']);
}

// Test 7: rewriteFrontmatter adds a new key before closing fence.
{
  const lines = '---\nproject: X\nid: x\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 3], { approved: 'true' });
  assert.deepStrictEqual(out, ['---', 'project: X', 'id: x', 'approved: true', '---']);
}

// Test 8: rewriteFrontmatter emits arrays as block sequences.
{
  const lines = '---\nproject: X\nid: x\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 3], { related: ['spec/foo', 'plan/bar'] });
  assert.deepStrictEqual(out, ['---', 'project: X', 'id: x', 'related:', '  - spec/foo', '  - plan/bar', '---']);
}

// Test 9: rewriteFrontmatter replaces an existing array (old continuation lines are skipped).
{
  const lines = '---\nproject: X\nid: x\nrelated:\n  - spec/old\n  - plan/old\ntags:\n  - a\n---\n'.split('\n');
  // frontmatterRange is [0, 8]
  const out = rewriteFrontmatter(lines, [0, 8], { related: ['spec/new'] });
  // Expect: project, id, related: with just spec/new, tags preserved
  assert.ok(out.includes('related:'));
  assert.ok(out.includes('  - spec/new'));
  assert.ok(!out.some(l => l === '  - spec/old'));
  assert.ok(!out.some(l => l === '  - plan/old'));
  assert.ok(out.includes('tags:'));
  assert.ok(out.includes('  - a'));
}

// Test 10: rewriteFrontmatter deletes a key when update value is null.
{
  const lines = '---\nproject: X\nid: x\napproved: true\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 4], { approved: null });
  assert.ok(!out.some(l => l.startsWith('approved:')));
}

// --- writeSpecAtomic ---

// Test 11: writeSpecAtomic writes valid content and leaves disk unchanged on validation failure.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'atomic');
  const original = fs.readFileSync(sp, 'utf-8');

  const bad = '---\nproject: X\nid: ATOMIC\ntitle: X\nstatus: draft\ncreated: 2026-04-24\n---\n\n# X\n\n## Problem\np\n';
  const res = writeSpecAtomic(sp, bad);
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /validateSpec rejected/);
  assert.strictEqual(fs.readFileSync(sp, 'utf-8'), original);

  fs.rmSync(root, { recursive: true });
}

// --- update: title ---

// Test 12: update title rewrites frontmatter AND `# <title>` heading; other content preserved.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'title-test', { title: 'Old Title' });
  const originalProblem = extractSectionBody(fs.readFileSync(sp, 'utf-8'), 'Problem');

  const res = update({ specPath: sp, target: 'title', value: 'Brand New Title' });
  assert.strictEqual(res.ok, true, res.reason);
  assert.strictEqual(res.written, true);

  const after = fs.readFileSync(sp, 'utf-8');
  const fm = extractFrontmatter(after);
  assert.strictEqual(fm.title, 'Brand New Title');
  assert.match(after, /^# Brand New Title$/m);
  // Problem section unchanged
  assert.strictEqual(extractSectionBody(after, 'Problem'), originalProblem);
  // updated: bumped
  assert.strictEqual(fm.updated, today());

  fs.rmSync(root, { recursive: true });
}

// Test 13: update title with identical value is a no-op.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'noop-title', { title: 'Same' });

  const before = fs.readFileSync(sp, 'utf-8');
  const res = update({ specPath: sp, target: 'title', value: 'Same' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.written, false);
  assert.match(res.reason, /no change/i);
  assert.strictEqual(fs.readFileSync(sp, 'utf-8'), before);

  fs.rmSync(root, { recursive: true });
}

// Test 14: update title rejects empty values.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'bad-title');

  assert.match(update({ specPath: sp, target: 'title', value: '' }).reason, /non-empty/i);
  assert.match(update({ specPath: sp, target: 'title', value: '   ' }).reason, /non-empty/i);

  fs.rmSync(root, { recursive: true });
}

// --- update: status ---

// Test 15: update status flips draft → active; rejects archived; rejects enum misses.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'status-flip');
  // Default status is draft
  assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).status, 'draft');

  const flip = update({ specPath: sp, target: 'status', value: 'active' });
  assert.strictEqual(flip.ok, true); assert.strictEqual(flip.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).status, 'active');

  const noop = update({ specPath: sp, target: 'status', value: 'active' });
  assert.strictEqual(noop.ok, true); assert.strictEqual(noop.written, false);

  const archiveAttempt = update({ specPath: sp, target: 'status', value: 'archived' });
  assert.strictEqual(archiveAttempt.ok, false);
  assert.match(archiveAttempt.reason, /archive op/);

  const junk = update({ specPath: sp, target: 'status', value: 'pending' });
  assert.strictEqual(junk.ok, false);
  assert.match(junk.reason, /draft or active/);

  fs.rmSync(root, { recursive: true });
}

// --- update: related ---

// Test 16: update related add validates CROSS_REF; dedup returns no-op; remove errors on missing.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'related-ops');

  // Invalid CROSS_REF rejected
  const bad = update({ specPath: sp, target: 'related', action: 'add', value: 'not-a-ref' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /required pattern/);

  // Add valid
  const a1 = update({ specPath: sp, target: 'related', action: 'add', value: 'plan/auth-migration' });
  assert.strictEqual(a1.ok, true); assert.strictEqual(a1.written, true);

  // Add duplicate → no-op
  const a2 = update({ specPath: sp, target: 'related', action: 'add', value: 'plan/auth-migration' });
  assert.strictEqual(a2.ok, true); assert.strictEqual(a2.written, false);
  assert.match(a2.reason, /already in related/i);

  // Remove present
  const r1 = update({ specPath: sp, target: 'related', action: 'remove', value: 'plan/auth-migration' });
  assert.strictEqual(r1.ok, true); assert.strictEqual(r1.written, true);

  // Remove missing → error (not silent success)
  const r2 = update({ specPath: sp, target: 'related', action: 'remove', value: 'plan/auth-migration' });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.reason, /not present/);

  fs.rmSync(root, { recursive: true });
}

// Test 17: update tags enforces KEBAB_CASE; add/remove semantics mirror related.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'tag-ops');

  const bad = update({ specPath: sp, target: 'tags', action: 'add', value: 'BadTag' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /required pattern/);

  assert.strictEqual(update({ specPath: sp, target: 'tags', action: 'add', value: 'urgent' }).ok, true);
  const fm = extractFrontmatter(fs.readFileSync(sp, 'utf-8'));
  assert.deepStrictEqual(fm.tags, ['urgent']);

  assert.strictEqual(update({ specPath: sp, target: 'tags', action: 'remove', value: 'urgent' }).ok, true);
  const fm2 = extractFrontmatter(fs.readFileSync(sp, 'utf-8'));
  // After removing the only entry, tags should be absent from frontmatter (empty array deletes).
  assert.strictEqual(fm2.tags, undefined);

  fs.rmSync(root, { recursive: true });
}

// Test 18: update tags with bad action value is rejected.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'bad-action');

  const res = update({ specPath: sp, target: 'tags', action: 'toggle', value: 'x' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /action must be/i);

  fs.rmSync(root, { recursive: true });
}

// --- update: section ---

// Test 19: update section rewrites only the target section; other sections byte-preserved.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'section-rewrite', {
    sections: {
      problem: 'Original problem prose.',
      goals: 'Original goals prose — UNIQUE_MARKER_GOALS.',
      non_goals: 'Original non-goals — UNIQUE_MARKER_NG.',
      requirements: 'Original reqs — UNIQUE_MARKER_REQ.',
      acceptance: '- [ ] UNIQUE_MARKER_ACC',
      open_questions: 'Original OQ — UNIQUE_MARKER_OQ.',
    },
  });

  const before = fs.readFileSync(sp, 'utf-8');

  const res = update({ specPath: sp, target: 'section', sectionId: 'problem', content: 'Completely new problem statement.' });
  assert.strictEqual(res.ok, true); assert.strictEqual(res.written, true);

  const after = fs.readFileSync(sp, 'utf-8');
  // Problem rewritten
  assert.strictEqual(extractSectionBody(after, 'Problem'), 'Completely new problem statement.');
  // Other five sections byte-identical
  for (const [heading, marker] of [
    ['Goals', 'UNIQUE_MARKER_GOALS'],
    ['Non-goals', 'UNIQUE_MARKER_NG'],
    ['Requirements', 'UNIQUE_MARKER_REQ'],
    ['Acceptance', 'UNIQUE_MARKER_ACC'],
    ['Open questions', 'UNIQUE_MARKER_OQ'],
  ]) {
    const beforeBody = extractSectionBody(before, heading);
    const afterBody = extractSectionBody(after, heading);
    assert.strictEqual(afterBody, beforeBody, `section "${heading}" must be byte-preserved; marker=${marker}`);
  }

  // Title preserved
  assert.match(after, /^# section rewrite$/m);
  // Frontmatter updated: bumped
  assert.strictEqual(extractFrontmatter(after).updated, today());

  fs.rmSync(root, { recursive: true });
}

// Test 20: update section with unknown sectionId is rejected.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'bad-section');

  const res = update({ specPath: sp, target: 'section', sectionId: 'summary', content: 'x' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /must be one of/);

  fs.rmSync(root, { recursive: true });
}

// Test 21: update section with identical content is a no-op.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'noop-sec', {
    sections: { problem: 'Identical body.' },
  });

  const before = fs.readFileSync(sp, 'utf-8');
  const res = update({ specPath: sp, target: 'section', sectionId: 'problem', content: 'Identical body.' });
  assert.strictEqual(res.ok, true); assert.strictEqual(res.written, false);
  assert.match(res.reason, /no change/i);
  assert.strictEqual(fs.readFileSync(sp, 'utf-8'), before);

  fs.rmSync(root, { recursive: true });
}

// Test 22: update with unknown target is rejected.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'bad-target');

  const res = update({ specPath: sp, target: 'author', value: 'nope' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /unknown target/);

  fs.rmSync(root, { recursive: true });
}

// --- approve ---

// Test 23: approve flips approved:true and is idempotent.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'approve-me');

  const first = approve({ specPath: sp });
  assert.strictEqual(first.ok, true); assert.strictEqual(first.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).approved, 'true');

  const again = approve({ specPath: sp });
  assert.strictEqual(again.ok, true); assert.strictEqual(again.written, false);
  assert.match(again.reason, /already approved/i);

  fs.rmSync(root, { recursive: true });
}

// --- archive ---

// Test 24: archive flips status:archived and is idempotent.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'archive-me');

  const first = archive({ specPath: sp });
  assert.strictEqual(first.ok, true); assert.strictEqual(first.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).status, 'archived');

  const again = archive({ specPath: sp });
  assert.strictEqual(again.ok, true); assert.strictEqual(again.written, false);
  assert.match(again.reason, /already archived/i);

  fs.rmSync(root, { recursive: true });
}

// --- supersede ---

// Test 25: supersede happy path — new gains supersedes entry, old flips to archived.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const spOld = seedSpec(projectPath, planningDir, 'auth-v1');
  const spNew = seedSpec(projectPath, planningDir, 'auth-v2');

  const res = supersede({ projectPath, newId: 'auth-v2', oldId: 'auth-v1' });
  assert.strictEqual(res.ok, true, res.reason);
  assert.strictEqual(res.written, true);

  const fmNew = extractFrontmatter(fs.readFileSync(spNew, 'utf-8'));
  const fmOld = extractFrontmatter(fs.readFileSync(spOld, 'utf-8'));
  assert.deepStrictEqual(fmNew.supersedes, ['auth-v1']);
  assert.strictEqual(fmOld.status, 'archived');
  assert.strictEqual(fmNew.updated, today());
  assert.strictEqual(fmOld.updated, today());

  fs.rmSync(root, { recursive: true });
}

// Test 26: supersede refuses if either spec doesn't exist (no partial writes).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const spNew = seedSpec(projectPath, planningDir, 'auth-v2-only');

  const missingOld = supersede({ projectPath, newId: 'auth-v2-only', oldId: 'auth-v1-ghost' });
  assert.strictEqual(missingOld.ok, false);
  assert.match(missingOld.reason, /old spec not found/);
  // New spec should not have been modified
  const fmNew = extractFrontmatter(fs.readFileSync(spNew, 'utf-8'));
  assert.strictEqual(fmNew.supersedes, undefined);

  const missingNew = supersede({ projectPath, newId: 'ghost', oldId: 'auth-v2-only' });
  assert.strictEqual(missingNew.ok, false);
  assert.match(missingNew.reason, /new spec not found/);

  fs.rmSync(root, { recursive: true });
}

// Test 27: supersede is idempotent when both halves are already applied.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  seedSpec(projectPath, planningDir, 'auth-v1');
  seedSpec(projectPath, planningDir, 'auth-v2');

  const first = supersede({ projectPath, newId: 'auth-v2', oldId: 'auth-v1' });
  assert.strictEqual(first.ok, true); assert.strictEqual(first.written, true);

  const again = supersede({ projectPath, newId: 'auth-v2', oldId: 'auth-v1' });
  assert.strictEqual(again.ok, true); assert.strictEqual(again.written, false);
  assert.match(again.reason, /already superseded/i);

  fs.rmSync(root, { recursive: true });
}

// Test 28: supersede refuses when newId === oldId.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  seedSpec(projectPath, planningDir, 'same');

  const res = supersede({ projectPath, newId: 'same', oldId: 'same' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /must differ/);

  fs.rmSync(root, { recursive: true });
}

// Test 29: supersede best-effort rollback — if the second write fails (here, by
// corrupting the old spec's frontmatter so validateSpec rejects the rewritten
// version), the new spec write is rolled back from the in-memory backup.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const spOld = seedSpec(projectPath, planningDir, 'roll-old');
  const spNew = seedSpec(projectPath, planningDir, 'roll-new');

  const newOriginal = fs.readFileSync(spNew, 'utf-8');

  // Inject failure on the second write: corrupt the old spec so that AFTER
  // supersede's in-memory status flip, the validateSpec re-check fails. We
  // achieve this by deleting a required field (`title`) from the old spec's
  // frontmatter. The op reads + parses this successfully (parseYaml tolerates
  // the missing key), then re-validates after the status flip — at which
  // point validateSpec reports "title: required".
  const corruptOld = fs.readFileSync(spOld, 'utf-8').replace(/^title:.*$/m, '');
  fs.writeFileSync(spOld, corruptOld);
  const oldCorrupted = fs.readFileSync(spOld, 'utf-8');

  const res = supersede({ projectPath, newId: 'roll-new', oldId: 'roll-old' });
  assert.strictEqual(res.ok, false, 'supersede should fail when the rewritten old spec is invalid');
  assert.match(res.reason, /old spec write failed/);
  assert.match(res.reason, /new spec restored/);

  // The NEW spec must have been restored to its original (pre-supersede) content.
  assert.strictEqual(
    fs.readFileSync(spNew, 'utf-8'), newOriginal,
    'new spec should be rolled back to original content after second-write failure',
  );
  // The OLD spec on disk is left as we corrupted it (supersede never succeeded
  // at writing its own version); assertion guards against accidental partial writes.
  assert.strictEqual(fs.readFileSync(spOld, 'utf-8'), oldCorrupted);

  fs.rmSync(root, { recursive: true });
}

// --- cross-cutting: every op bumps updated: ---

// Test 30: Every op that writes bumps frontmatter updated: to today.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'updated-check');

  const ops = [
    () => update({ specPath: sp, target: 'title', value: 'New title' }),
    () => update({ specPath: sp, target: 'status', value: 'active' }),
    () => update({ specPath: sp, target: 'related', action: 'add', value: 'plan/foo' }),
    () => update({ specPath: sp, target: 'tags', action: 'add', value: 'feature' }),
    () => update({ specPath: sp, target: 'section', sectionId: 'problem', content: 'New problem.' }),
    () => approve({ specPath: sp }),
    () => archive({ specPath: sp }),
  ];
  for (const run of ops) {
    const r = run();
    assert.strictEqual(r.ok, true, `op failed: ${r.reason}`);
    if (r.written) {
      assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).updated, today());
    }
  }

  fs.rmSync(root, { recursive: true });
}

// --- round-trip through scanArtifacts ---

// Test 31: After every op, scanArtifacts returns the spec with validation.valid === true.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  seedSpec(projectPath, planningDir, 'round-trip');

  const sp = resolveSpecPath({ projectPath, config: {}, id: 'round-trip' });

  const checks = [
    () => update({ specPath: sp, target: 'title', value: 'RT' }),
    () => update({ specPath: sp, target: 'related', action: 'add', value: 'spec/foo' }),
    () => approve({ specPath: sp }),
    () => archive({ specPath: sp }),
  ];
  for (const fn of checks) {
    const r = fn();
    assert.strictEqual(r.ok, true, r.reason);
    const scanned = scanArtifacts({ fsdDir: projectPath, kind: 'spec', dirName: 'spec' });
    assert.strictEqual(scanned.length, 1);
    assert.strictEqual(scanned[0].validation.valid, true, scanned[0].validation.errors.join('; '));
  }

  fs.rmSync(root, { recursive: true });
}

// --- op refusal when spec missing ---

// Test 32: Every op refuses cleanly when the target spec doesn't exist.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const ghost = path.join(projectPath, 'spec', 'does-not-exist.md');

  for (const call of [
    () => update({ specPath: ghost, target: 'title', value: 'x' }),
    () => approve({ specPath: ghost }),
    () => archive({ specPath: ghost }),
  ]) {
    const r = call();
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not found/i);
  }

  fs.rmSync(root, { recursive: true });
}

console.log('  All spec-update tests passed');
