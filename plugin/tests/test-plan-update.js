#!/usr/bin/env node
'use strict';

// Unit + integration tests for the plan update backing module (FSD-015).
// Mirrors test-spec-update.js shape. Covers: parsePlan (minimal, all 6
// sections, unknown-heading tolerance, malformed frontmatter rejection);
// rewriteFrontmatter (scalar, array, array-replacement, delete); all 3 ops
// (update with 8 sub-targets, archive, supersede) including happy / refusal
// / idempotent / rollback paths; byte-preservation of untouched sections;
// atomicity under injected failure; every-op-bumps-updated; round-trip
// through scanArtifacts.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parsePlan,
  readPlan,
  writePlanAtomic,
  rewriteFrontmatter,
  update,
  archive,
  supersede,
  today,
} = require(path.join(__dirname, '..', 'scripts', 'plan-update.js'));
const { validatePlan } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { writePlanFile, resolvePlanPath } = require(path.join(__dirname, '..', 'scripts', 'plan.js'));
const { writeSpecFile } = require(path.join(__dirname, '..', 'scripts', 'spec.js'));
const { writeProjectFiles } = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));
const { scanArtifacts } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-plan-upd-'));
}

function seedProject(planningDir, projectName = 'Demo Project') {
  return writeProjectFiles({
    planningDir,
    projectData: { project: projectName, id: 'demo', title: projectName, vision: 'demo' },
    roadmapData: { project: projectName, id: 'r', title: `${projectName} R`, version: '0.1', current_milestone: 'v1' },
  });
}

function seedSpec(projectPath, planningDir, id) {
  const res = writeSpecFile({
    projectPath, planningDir,
    specData: { id, title: id.replace(/-/g, ' '), status: 'active', approved: true },
  });
  assert.strictEqual(res.ok, true, res.reason);
  return res.written[0];
}

// Seed a plan by first seeding a spec with the same id (so the
// spec-hard-require is satisfied).
function seedPlan(projectPath, planningDir, id, overrides = {}) {
  const specId = overrides.specId || `${id}-spec`;
  seedSpec(projectPath, planningDir, specId);
  const planData = Object.assign(
    {
      id,
      title: id.replace(/-/g, ' '),
      related: [`spec/${specId}`],
      sections: {
        context: `Context for ${id}.`,
        approach: `Approach for ${id}.`,
        phases: `Phases for ${id}.`,
      },
    },
    overrides,
  );
  delete planData.specId;
  const res = writePlanFile({ projectPath, planningDir, planData });
  assert.strictEqual(res.ok, true, res.reason);
  return res.written[0];
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? parseYaml(m[1]) : {};
}

function extractSectionBody(content, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'm');
  const m = content.match(re);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  const rest = content.slice(startIdx);
  const nextMatch = rest.match(/^##\s+/m);
  const endIdx = nextMatch ? nextMatch.index : rest.length;
  return rest.slice(0, endIdx).trim();
}

// --- exports + primitives ---

// Test 1: Module exports are shaped correctly.
{
  assert.strictEqual(typeof parsePlan, 'function');
  assert.strictEqual(typeof readPlan, 'function');
  assert.strictEqual(typeof writePlanAtomic, 'function');
  assert.strictEqual(typeof rewriteFrontmatter, 'function');
  assert.strictEqual(typeof update, 'function');
  assert.strictEqual(typeof archive, 'function');
  assert.strictEqual(typeof supersede, 'function');
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
}

// --- parsePlan ---

// Test 2: Parses a plan file (frontmatter + title + 6 canonical sections).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'minimal');

  const { parsed } = readPlan(pp);
  assert.strictEqual(parsed.frontmatter.id, 'minimal');
  assert.strictEqual(parsed.frontmatter.project, 'Demo Project');
  assert.ok(parsed.titleLine !== null, 'titleLine must be located');
  assert.strictEqual(parsed.sections.length, 6);
  assert.deepStrictEqual(
    parsed.sections.map(s => s.id),
    ['context', 'approach', 'phases', 'risks', 'acceptance', 'open_questions'],
  );
  for (let i = 0; i < parsed.sections.length - 1; i++) {
    assert.strictEqual(parsed.sections[i].range[1], parsed.sections[i + 1].range[0]);
  }

  fs.rmSync(root, { recursive: true });
}

// Test 3: Unknown `##` headings are captured with id:null.
{
  const content = `---
project: X
id: x
title: X
status: draft
created: 2026-04-24
---

# X

## Context
C

## My Custom Block
body

## Approach
A
`;
  const parsed = parsePlan(content);
  const ids = parsed.sections.map(s => s.id);
  assert.deepStrictEqual(ids, ['context', null, 'approach']);
  assert.strictEqual(parsed.sections[1].heading, 'My Custom Block');
  assert.strictEqual(parsed.sections[1].bodyContent, 'body');
}

// Test 4: Malformed frontmatter (no opening ---) is rejected.
{
  assert.throws(() => parsePlan('no frontmatter here\n'), /does not begin with/);
}

// Test 5: Unterminated frontmatter (no closing ---) is rejected.
{
  assert.throws(() => parsePlan('---\nproject: X\n(no close)\n'), /unterminated/);
}

// --- rewriteFrontmatter ---

// Test 6: scalar update preserves key order.
{
  const lines = '---\nproject: X\nid: x\nstatus: draft\ncreated: 2026-01-01\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 5], { status: 'active' });
  assert.deepStrictEqual(out, ['---', 'project: X', 'id: x', 'status: active', 'created: 2026-01-01', '---']);
}

// Test 7: adds a new key before the closing fence.
{
  const lines = '---\nproject: X\nid: x\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 3], { estimate: '~2 days' });
  assert.deepStrictEqual(out, ['---', 'project: X', 'id: x', 'estimate: ~2 days', '---']);
}

// Test 8: emits arrays as block sequences (supersedes).
{
  const lines = '---\nproject: X\nid: x\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 3], { supersedes: ['foo-v1', 'foo-v2'] });
  assert.deepStrictEqual(out, ['---', 'project: X', 'id: x', 'supersedes:', '  - foo-v1', '  - foo-v2', '---']);
}

// Test 9: replaces an existing array (old continuation lines skipped).
{
  const lines = '---\nproject: X\nid: x\ndepends_on:\n  - a\n  - b\ntags:\n  - t1\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 8], { depends_on: ['c'] });
  assert.ok(out.includes('depends_on:'));
  assert.ok(out.includes('  - c'));
  assert.ok(!out.some(l => l === '  - a'));
  assert.ok(!out.some(l => l === '  - b'));
  assert.ok(out.includes('tags:'));
  assert.ok(out.includes('  - t1'));
}

// Test 10: deletes a key when update value is null.
{
  const lines = '---\nproject: X\nid: x\nestimate: ~2 days\n---\n'.split('\n');
  const out = rewriteFrontmatter(lines, [0, 4], { estimate: null });
  assert.ok(!out.some(l => l.startsWith('estimate:')));
}

// --- writePlanAtomic ---

// Test 11: writes valid content; leaves disk unchanged on validation failure.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'atomic');
  const original = fs.readFileSync(pp, 'utf-8');

  // Bad content: id is not kebab-case (uppercase letters rejected).
  const bad = '---\nproject: X\nid: ATOMIC\ntitle: X\nstatus: draft\ncreated: 2026-04-24\n---\n\n# X\n\n## Context\nc\n';
  const res = writePlanAtomic(pp, bad);
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /validatePlan rejected/);
  assert.strictEqual(fs.readFileSync(pp, 'utf-8'), original);

  fs.rmSync(root, { recursive: true });
}

// --- update: title ---

// Test 12: update title rewrites frontmatter AND `# <title>` heading; other content preserved.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'title-test', { title: 'Old Title' });
  const originalContext = extractSectionBody(fs.readFileSync(pp, 'utf-8'), 'Context');

  const res = update({ planPath: pp, target: 'title', value: 'Brand New Title' });
  assert.strictEqual(res.ok, true, res.reason);
  assert.strictEqual(res.written, true);

  const after = fs.readFileSync(pp, 'utf-8');
  const fm = extractFrontmatter(after);
  assert.strictEqual(fm.title, 'Brand New Title');
  assert.match(after, /^# Brand New Title$/m);
  assert.strictEqual(extractSectionBody(after, 'Context'), originalContext);
  assert.strictEqual(fm.updated, today());

  fs.rmSync(root, { recursive: true });
}

// Test 13: update title with identical value is a no-op.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'noop-title', { title: 'Same' });

  const before = fs.readFileSync(pp, 'utf-8');
  const res = update({ planPath: pp, target: 'title', value: 'Same' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.written, false);
  assert.match(res.reason, /no change/i);
  assert.strictEqual(fs.readFileSync(pp, 'utf-8'), before);

  fs.rmSync(root, { recursive: true });
}

// --- update: status ---

// Test 14: update status flips draft → active; rejects archived; rejects enum misses.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'status-flip');
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).status, 'draft');

  const flip = update({ planPath: pp, target: 'status', value: 'active' });
  assert.strictEqual(flip.ok, true); assert.strictEqual(flip.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).status, 'active');

  const noop = update({ planPath: pp, target: 'status', value: 'active' });
  assert.strictEqual(noop.ok, true); assert.strictEqual(noop.written, false);

  const archiveAttempt = update({ planPath: pp, target: 'status', value: 'archived' });
  assert.strictEqual(archiveAttempt.ok, false);
  assert.match(archiveAttempt.reason, /archive op/);

  const junk = update({ planPath: pp, target: 'status', value: 'pending' });
  assert.strictEqual(junk.ok, false);
  assert.match(junk.reason, /draft or active/);

  fs.rmSync(root, { recursive: true });
}

// --- update: related ---

// Test 15: update related add/remove with CROSS_REF validation + dedup + missing-remove error.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'related-ops');

  const bad = update({ planPath: pp, target: 'related', action: 'add', value: 'not-a-ref' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /required pattern/);

  const a1 = update({ planPath: pp, target: 'related', action: 'add', value: 'plan/other' });
  assert.strictEqual(a1.ok, true); assert.strictEqual(a1.written, true);

  const a2 = update({ planPath: pp, target: 'related', action: 'add', value: 'plan/other' });
  assert.strictEqual(a2.ok, true); assert.strictEqual(a2.written, false);
  assert.match(a2.reason, /already in related/i);

  const r1 = update({ planPath: pp, target: 'related', action: 'remove', value: 'plan/other' });
  assert.strictEqual(r1.ok, true); assert.strictEqual(r1.written, true);

  const r2 = update({ planPath: pp, target: 'related', action: 'remove', value: 'plan/other' });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.reason, /not present/);

  fs.rmSync(root, { recursive: true });
}

// Test 16: update tags enforces KEBAB_CASE; add/remove semantics mirror related.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'tag-ops');

  const bad = update({ planPath: pp, target: 'tags', action: 'add', value: 'BadTag' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /required pattern/);

  assert.strictEqual(update({ planPath: pp, target: 'tags', action: 'add', value: 'urgent' }).ok, true);
  const fm = extractFrontmatter(fs.readFileSync(pp, 'utf-8'));
  assert.deepStrictEqual(fm.tags, ['urgent']);

  assert.strictEqual(update({ planPath: pp, target: 'tags', action: 'remove', value: 'urgent' }).ok, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).tags, undefined);

  fs.rmSync(root, { recursive: true });
}

// --- update: depends_on ---

// Test 17: update depends_on add/remove with KEBAB_CASE validation + dedup + missing-remove error.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'deps-ops');

  const bad = update({ planPath: pp, target: 'depends_on', action: 'add', value: 'Bad_Dep' });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, /required pattern/);

  const a1 = update({ planPath: pp, target: 'depends_on', action: 'add', value: 'infra-bootstrap' });
  assert.strictEqual(a1.ok, true); assert.strictEqual(a1.written, true);
  assert.deepStrictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).depends_on, ['infra-bootstrap']);

  const a2 = update({ planPath: pp, target: 'depends_on', action: 'add', value: 'infra-bootstrap' });
  assert.strictEqual(a2.ok, true); assert.strictEqual(a2.written, false);

  const r1 = update({ planPath: pp, target: 'depends_on', action: 'remove', value: 'infra-bootstrap' });
  assert.strictEqual(r1.ok, true); assert.strictEqual(r1.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).depends_on, undefined);

  const r2 = update({ planPath: pp, target: 'depends_on', action: 'remove', value: 'infra-bootstrap' });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.reason, /not present/);

  fs.rmSync(root, { recursive: true });
}

// --- update: task ---

// Test 18: update task set requires non-empty string; clear removes key; clear when absent is no-op.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'task-ops');

  // Clear when absent → no-op (task wasn't set during seeding).
  const clearAbsent = update({ planPath: pp, target: 'task', action: 'clear' });
  assert.strictEqual(clearAbsent.ok, true); assert.strictEqual(clearAbsent.written, false);
  assert.match(clearAbsent.reason, /already absent/i);

  // Empty set rejected.
  const badSet = update({ planPath: pp, target: 'task', action: 'set', value: '' });
  assert.strictEqual(badSet.ok, false);
  assert.match(badSet.reason, /non-empty/i);

  // Bad action.
  const badAction = update({ planPath: pp, target: 'task', action: 'toggle', value: 'x' });
  assert.strictEqual(badAction.ok, false);
  assert.match(badAction.reason, /action must be/i);

  // Set happy path.
  const s1 = update({ planPath: pp, target: 'task', action: 'set', value: 'FSD-042' });
  assert.strictEqual(s1.ok, true); assert.strictEqual(s1.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).task, 'FSD-042');

  // Set same value → no-op.
  const s2 = update({ planPath: pp, target: 'task', action: 'set', value: 'FSD-042' });
  assert.strictEqual(s2.ok, true); assert.strictEqual(s2.written, false);

  // Clear when present → removes key.
  const c1 = update({ planPath: pp, target: 'task', action: 'clear' });
  assert.strictEqual(c1.ok, true); assert.strictEqual(c1.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).task, undefined);

  fs.rmSync(root, { recursive: true });
}

// --- update: estimate ---

// Test 19: update estimate has same set/clear semantics as task.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'est-ops');

  const s1 = update({ planPath: pp, target: 'estimate', action: 'set', value: '~3 days' });
  assert.strictEqual(s1.ok, true); assert.strictEqual(s1.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).estimate, '~3 days');

  const c1 = update({ planPath: pp, target: 'estimate', action: 'clear' });
  assert.strictEqual(c1.ok, true); assert.strictEqual(c1.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).estimate, undefined);

  fs.rmSync(root, { recursive: true });
}

// --- update: section ---

// Test 20: update section rewrites target section; others byte-preserved.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'section-rewrite', {
    sections: {
      context: 'Original context — UNIQUE_MARKER_CTX.',
      approach: 'Original approach — UNIQUE_MARKER_APP.',
      phases: 'Original phases — UNIQUE_MARKER_PHA.',
      risks: 'Original risks — UNIQUE_MARKER_RSK.',
      acceptance: '- [ ] UNIQUE_MARKER_ACC',
      open_questions: 'Original OQ — UNIQUE_MARKER_OQ.',
    },
  });

  const before = fs.readFileSync(pp, 'utf-8');

  const res = update({ planPath: pp, target: 'section', sectionId: 'context', content: 'Completely new context.' });
  assert.strictEqual(res.ok, true); assert.strictEqual(res.written, true);

  const after = fs.readFileSync(pp, 'utf-8');
  assert.strictEqual(extractSectionBody(after, 'Context'), 'Completely new context.');
  for (const [heading, marker] of [
    ['Approach', 'UNIQUE_MARKER_APP'],
    ['Phases', 'UNIQUE_MARKER_PHA'],
    ['Risks', 'UNIQUE_MARKER_RSK'],
    ['Acceptance', 'UNIQUE_MARKER_ACC'],
    ['Open questions', 'UNIQUE_MARKER_OQ'],
  ]) {
    const beforeBody = extractSectionBody(before, heading);
    const afterBody = extractSectionBody(after, heading);
    assert.strictEqual(afterBody, beforeBody, `section "${heading}" must be byte-preserved; marker=${marker}`);
  }

  assert.match(after, /^# section rewrite$/m);
  assert.strictEqual(extractFrontmatter(after).updated, today());

  fs.rmSync(root, { recursive: true });
}

// Test 21: update section with unknown sectionId is rejected.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'bad-section');

  const res = update({ planPath: pp, target: 'section', sectionId: 'summary', content: 'x' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /must be one of/);

  fs.rmSync(root, { recursive: true });
}

// Test 22: update section with identical content is a no-op.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'noop-sec', {
    sections: { context: 'Identical body.' },
  });

  const before = fs.readFileSync(pp, 'utf-8');
  const res = update({ planPath: pp, target: 'section', sectionId: 'context', content: 'Identical body.' });
  assert.strictEqual(res.ok, true); assert.strictEqual(res.written, false);
  assert.match(res.reason, /no change/i);
  assert.strictEqual(fs.readFileSync(pp, 'utf-8'), before);

  fs.rmSync(root, { recursive: true });
}

// Test 23: update with unknown target is rejected.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'bad-target');

  const res = update({ planPath: pp, target: 'author', value: 'nope' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /unknown target/);

  fs.rmSync(root, { recursive: true });
}

// --- archive ---

// Test 24: archive flips status:archived and is idempotent.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'archive-me');

  const first = archive({ planPath: pp });
  assert.strictEqual(first.ok, true); assert.strictEqual(first.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).status, 'archived');

  const again = archive({ planPath: pp });
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
  const ppOld = seedPlan(projectPath, planningDir, 'auth-v1');
  const ppNew = seedPlan(projectPath, planningDir, 'auth-v2');

  const res = supersede({ projectPath, newId: 'auth-v2', oldId: 'auth-v1' });
  assert.strictEqual(res.ok, true, res.reason);
  assert.strictEqual(res.written, true);

  const fmNew = extractFrontmatter(fs.readFileSync(ppNew, 'utf-8'));
  const fmOld = extractFrontmatter(fs.readFileSync(ppOld, 'utf-8'));
  assert.deepStrictEqual(fmNew.supersedes, ['auth-v1']);
  assert.strictEqual(fmOld.status, 'archived');
  assert.strictEqual(fmNew.updated, today());
  assert.strictEqual(fmOld.updated, today());

  fs.rmSync(root, { recursive: true });
}

// Test 26: supersede refuses if either plan doesn't exist (no partial writes).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const ppNew = seedPlan(projectPath, planningDir, 'auth-v2-only');

  const missingOld = supersede({ projectPath, newId: 'auth-v2-only', oldId: 'auth-v1-ghost' });
  assert.strictEqual(missingOld.ok, false);
  assert.match(missingOld.reason, /old plan not found/);
  const fmNew = extractFrontmatter(fs.readFileSync(ppNew, 'utf-8'));
  assert.strictEqual(fmNew.supersedes, undefined);

  const missingNew = supersede({ projectPath, newId: 'ghost', oldId: 'auth-v2-only' });
  assert.strictEqual(missingNew.ok, false);
  assert.match(missingNew.reason, /new plan not found/);

  fs.rmSync(root, { recursive: true });
}

// Test 27: supersede is idempotent when both halves already applied.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  seedPlan(projectPath, planningDir, 'auth-v1');
  seedPlan(projectPath, planningDir, 'auth-v2');

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
  seedPlan(projectPath, planningDir, 'same');

  const res = supersede({ projectPath, newId: 'same', oldId: 'same' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /must differ/);

  fs.rmSync(root, { recursive: true });
}

// Test 29: supersede best-effort rollback — if the second write fails,
// the new plan is restored from the in-memory backup.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const ppOld = seedPlan(projectPath, planningDir, 'roll-old');
  const ppNew = seedPlan(projectPath, planningDir, 'roll-new');

  const newOriginal = fs.readFileSync(ppNew, 'utf-8');

  // Corrupt the old plan's frontmatter by removing `title:`. The parser
  // tolerates missing keys, but validatePlan will reject after supersede
  // flips status, triggering rollback of the new-plan write.
  const corruptOld = fs.readFileSync(ppOld, 'utf-8').replace(/^title:.*$/m, '');
  fs.writeFileSync(ppOld, corruptOld);
  const oldCorrupted = fs.readFileSync(ppOld, 'utf-8');

  const res = supersede({ projectPath, newId: 'roll-new', oldId: 'roll-old' });
  assert.strictEqual(res.ok, false, 'supersede should fail when the rewritten old plan is invalid');
  assert.match(res.reason, /old plan write failed/);
  assert.match(res.reason, /new plan restored/);

  assert.strictEqual(
    fs.readFileSync(ppNew, 'utf-8'), newOriginal,
    'new plan should be rolled back to original content after second-write failure',
  );
  assert.strictEqual(fs.readFileSync(ppOld, 'utf-8'), oldCorrupted);

  fs.rmSync(root, { recursive: true });
}

// --- cross-cutting: every op bumps updated: ---

// Test 30: Every op that writes bumps frontmatter updated: to today.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'updated-check');

  const ops = [
    () => update({ planPath: pp, target: 'title', value: 'New title' }),
    () => update({ planPath: pp, target: 'status', value: 'active' }),
    () => update({ planPath: pp, target: 'related', action: 'add', value: 'plan/foo' }),
    () => update({ planPath: pp, target: 'tags', action: 'add', value: 'feature' }),
    () => update({ planPath: pp, target: 'depends_on', action: 'add', value: 'infra' }),
    () => update({ planPath: pp, target: 'task', action: 'set', value: 'FSD-001' }),
    () => update({ planPath: pp, target: 'estimate', action: 'set', value: '~2 days' }),
    () => update({ planPath: pp, target: 'section', sectionId: 'context', content: 'New context.' }),
    () => archive({ planPath: pp }),
  ];
  for (const run of ops) {
    const r = run();
    assert.strictEqual(r.ok, true, `op failed: ${r.reason}`);
    if (r.written) {
      assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).updated, today());
    }
  }

  fs.rmSync(root, { recursive: true });
}

// --- round-trip through scanArtifacts ---

// Test 31: After every op, scanArtifacts returns the plan with validation.valid === true.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  seedPlan(projectPath, planningDir, 'round-trip');

  const pp = resolvePlanPath({ projectPath, config: {}, id: 'round-trip' });

  const checks = [
    () => update({ planPath: pp, target: 'title', value: 'RT' }),
    () => update({ planPath: pp, target: 'related', action: 'add', value: 'plan/foo' }),
    () => update({ planPath: pp, target: 'depends_on', action: 'add', value: 'infra' }),
    () => update({ planPath: pp, target: 'task', action: 'set', value: 'FSD-100' }),
    () => update({ planPath: pp, target: 'estimate', action: 'set', value: '~1 day' }),
    () => archive({ planPath: pp }),
  ];
  for (const fn of checks) {
    const r = fn();
    assert.strictEqual(r.ok, true, r.reason);
    const scanned = scanArtifacts({ fsdDir: projectPath, kind: 'plan', dirName: 'plan' });
    assert.strictEqual(scanned.length, 1);
    assert.strictEqual(scanned[0].validation.valid, true, scanned[0].validation.errors.join('; '));
  }

  fs.rmSync(root, { recursive: true });
}

// --- op refusal when plan missing ---

// Test 32: Every op refuses cleanly when the target plan doesn't exist.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  fs.mkdirSync(path.join(projectPath, 'plan'), { recursive: true });
  const ghost = path.join(projectPath, 'plan', 'does-not-exist.md');

  for (const call of [
    () => update({ planPath: ghost, target: 'title', value: 'x' }),
    () => archive({ planPath: ghost }),
  ]) {
    const r = call();
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not found/i);
  }

  fs.rmSync(root, { recursive: true });
}

console.log('  All plan-update tests passed');
