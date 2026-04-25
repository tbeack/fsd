#!/usr/bin/env node
'use strict';

// Unit + integration tests for the spec authoring backing module (FSD-006).
// Covers: renderSpec (minimal/full/placeholder/skipped-section), writeSpecFile
// (happy path, refuse-to-overwrite, validation failure, config.structure.spec
// override, atomicity under injected failure, PROJECT.md auto-injection paths,
// round-trip via loader.scanArtifacts).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  renderSpec,
  writeSpecFile,
  resolveSpecPath,
  today,
  SECTION_ORDER,
  SECTION_META,
} = require(path.join(__dirname, '..', 'scripts', 'spec.js'));
const { validateSpec } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { scanArtifacts } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));
const { writeProjectFiles } = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-spec-'));
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  return parseYaml(m[1]);
}

function seedProjectMd(planningDir, projectName = 'Demo Project') {
  // Real PROJECT.md + ROADMAP.md pair via the backing module, so
  // loadProjectContext treats it as valid.
  return writeProjectFiles({
    planningDir,
    projectData: { project: projectName, id: 'demo-project', title: projectName, vision: 'demo' },
    roadmapData: {
      project: projectName,
      id: 'demo-project-roadmap',
      title: `${projectName} Roadmap`,
      version: '0.1',
      current_milestone: 'v1',
    },
  });
}

// --- Exports + constants ---

// Test 1: Module exports and section constants are shaped correctly.
{
  assert.strictEqual(typeof renderSpec, 'function');
  assert.strictEqual(typeof writeSpecFile, 'function');
  assert.strictEqual(typeof resolveSpecPath, 'function');
  assert.strictEqual(typeof today, 'function');
  assert.deepStrictEqual(SECTION_ORDER, [
    'problem', 'goals', 'non_goals', 'requirements', 'acceptance', 'open_questions',
  ]);
  for (const id of SECTION_ORDER) {
    assert.ok(SECTION_META[id], `SECTION_META must include ${id}`);
    assert.strictEqual(typeof SECTION_META[id].heading, 'string');
    assert.strictEqual(typeof SECTION_META[id].placeholder, 'string');
  }
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
}

// --- renderSpec ---

// Test 2: Minimal input produces validateSpec-compliant frontmatter.
{
  const out = renderSpec({ project: 'FSD', id: 'hello', title: 'Hello' });
  const fm = extractFrontmatter(out);
  const v = validateSpec(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  assert.strictEqual(fm.project, 'FSD');
  assert.strictEqual(fm.id, 'hello');
  assert.strictEqual(fm.title, 'Hello');
  assert.strictEqual(fm.status, 'draft', 'default status must be draft');
  assert.match(fm.created, /^\d{4}-\d{2}-\d{2}$/);
  // All six section headings appear, in order.
  const headings = [...out.matchAll(/^##\s+(.+)$/gm)].map(m => m[1]);
  assert.deepStrictEqual(headings, [
    'Problem', 'Goals', 'Non-goals', 'Requirements', 'Acceptance', 'Open questions',
  ]);
  // No trailing whitespace run, ends with exactly one newline.
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
}

// Test 3: Skipped sections retain their italicized placeholder copy.
{
  const out = renderSpec({ project: 'FSD', id: 'p', title: 'P' });
  for (const id of SECTION_ORDER) {
    const placeholder = SECTION_META[id].placeholder;
    // Acceptance's placeholder is a bullet, not italic prose — still appears verbatim.
    assert.ok(out.includes(placeholder), `expected placeholder for ${id}: ${placeholder}`);
  }
}

// Test 4: User-provided sections replace placeholders; whitespace is trimmed.
{
  const out = renderSpec({
    project: 'FSD',
    id: 'custom',
    title: 'Custom',
    sections: {
      problem: '   We have a problem.\n',
      acceptance: '- [ ] it works\n- [ ] it is fast',
    },
  });
  // Problem content present; leading whitespace stripped.
  assert.ok(out.includes('\n## Problem\n\nWe have a problem.\n\n## Goals'),
    `expected Problem section with trimmed content; got:\n${out}`);
  assert.ok(out.includes('- [ ] it works\n- [ ] it is fast'));
  // Placeholders for skipped sections still present.
  assert.ok(out.includes(SECTION_META.goals.placeholder));
}

// Test 5: Full input (all optional fields populated) renders + validates.
{
  const out = renderSpec({
    project: 'FSD',
    id: 'auth-v2',
    title: 'Auth v2',
    status: 'active',
    created: '2026-04-24',
    updated: '2026-04-24',
    approved: true,
    related: ['plan/auth-v2-migration', 'research/threat-model'],
    tags: ['security', 'auth'],
    supersedes: ['auth-v1'],
    sections: { problem: 'P', goals: 'G', non_goals: 'N', requirements: 'R', acceptance: '- [ ] A', open_questions: 'O' },
  });
  const fm = extractFrontmatter(out);
  const v = validateSpec(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  // Key order: project/id/title/status/created/updated/approved/related/tags/supersedes
  const keys = Object.keys(fm);
  assert.deepStrictEqual(keys.slice(0, 5), ['project', 'id', 'title', 'status', 'created']);
  assert.ok(keys.includes('approved'));
  assert.ok(keys.includes('related'));
  assert.ok(keys.includes('tags'));
  assert.ok(keys.includes('supersedes'));
}

// Test 6: `approved: false` is omitted (default), `approved: true` is emitted.
{
  const omitted = renderSpec({ project: 'X', id: 'x', title: 'X' });
  assert.ok(!omitted.match(/^approved:/m), 'default approved should be omitted');

  const omittedFalse = renderSpec({ project: 'X', id: 'x', title: 'X', approved: false });
  assert.ok(!omittedFalse.match(/^approved:/m), 'explicit approved: false should also be omitted (matches default)');

  const emitted = renderSpec({ project: 'X', id: 'x', title: 'X', approved: true });
  assert.match(emitted, /^approved: true$/m);
}

// Test 7: Empty arrays for related/tags/supersedes are omitted from frontmatter.
{
  const out = renderSpec({
    project: 'X', id: 'x', title: 'X',
    related: [], tags: [], supersedes: [],
  });
  assert.ok(!out.match(/^related:/m));
  assert.ok(!out.match(/^tags:/m));
  assert.ok(!out.match(/^supersedes:/m));
}

// --- resolveSpecPath ---

// Test 8: resolveSpecPath honors default structure and config overrides.
{
  const a = resolveSpecPath({ projectPath: '/repo/.fsd', config: {}, id: 'foo' });
  assert.strictEqual(a, path.join('/repo/.fsd', 'spec', 'foo.md'));

  const b = resolveSpecPath({ projectPath: '/repo/.fsd', config: { structure: { spec: 'specifications' } }, id: 'bar' });
  assert.strictEqual(b, path.join('/repo/.fsd', 'specifications', 'bar.md'));
}

// --- writeSpecFile: happy path + round-trip ---

// Test 9: Happy path — writes to default structure.spec, validates, round-trips via scanArtifacts.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  assert.strictEqual(seedProjectMd(planningDir).ok, true);

  const result = writeSpecFile({
    projectPath,
    planningDir,
    specData: {
      id: 'artifact-metadata',
      title: 'Artifact Metadata Schema',
      sections: { problem: 'Specs need metadata.', acceptance: '- [ ] validateSpec passes' },
    },
  });

  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.written.length, 1);
  const expected = path.join(projectPath, 'spec', 'artifact-metadata.md');
  assert.strictEqual(result.written[0], expected);
  assert.ok(fs.existsSync(expected));

  // project: field was auto-injected from PROJECT.md
  const written = fs.readFileSync(expected, 'utf-8');
  const fm = extractFrontmatter(written);
  assert.strictEqual(fm.project, 'Demo Project');
  assert.strictEqual(fm.id, 'artifact-metadata');

  // Round-trip: scanArtifacts picks it up, validation passes
  const scanned = scanArtifacts({ fsdDir: projectPath, kind: 'spec', dirName: 'spec' });
  assert.strictEqual(scanned.length, 1);
  assert.strictEqual(scanned[0].id, 'artifact-metadata');
  assert.strictEqual(scanned[0].validation.valid, true, scanned[0].validation.errors.join('; '));

  fs.rmSync(root, { recursive: true });
}

// Test 10: Config override — structure.spec renamed to "specifications".
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const result = writeSpecFile({
    projectPath,
    planningDir,
    config: { structure: { spec: 'specifications' } },
    specData: { id: 'renamed-dir', title: 'Renamed Dir' },
  });
  assert.strictEqual(result.ok, true, result.reason);
  const expected = path.join(projectPath, 'specifications', 'renamed-dir.md');
  assert.strictEqual(result.written[0], expected);
  assert.ok(fs.existsSync(expected));
  // Default dir not created
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec')), false);

  fs.rmSync(root, { recursive: true });
}

// --- writeSpecFile: refusal paths ---

// Test 11: Refuses to overwrite; on-disk content unchanged.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const first = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'dup', title: 'Dup v1' },
  });
  assert.strictEqual(first.ok, true);
  const firstContent = fs.readFileSync(first.written[0], 'utf-8');

  const second = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'dup', title: 'Dup v2 — should never win' },
  });
  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /refusing to overwrite/i);
  assert.deepStrictEqual(second.skipped, [path.join(projectPath, 'spec', 'dup.md')]);
  // File content is unchanged
  assert.strictEqual(fs.readFileSync(first.written[0], 'utf-8'), firstContent);
  assert.ok(firstContent.includes('title: Dup v1'));

  fs.rmSync(root, { recursive: true });
}

// Test 12: Invalid id (uppercase) triggers pre-write validation failure; no file written.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const result = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'Bad-ID', title: 'Bad ID' },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /invalid frontmatter/i);
  assert.match(result.reason, /kebab-case/i);
  // Nothing landed on disk
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec', 'Bad-ID.md')), false);
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 13: Missing required specData fields produce clear reasons (no disk write).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);

  const noId = writeSpecFile({
    projectPath, planningDir,
    specData: { title: 'No id' },
  });
  assert.strictEqual(noId.ok, false);
  assert.match(noId.reason, /id is required/i);

  const noTitle = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'no-title' },
  });
  assert.strictEqual(noTitle.ok, false);
  assert.match(noTitle.reason, /title is required/i);

  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec')), false);

  fs.rmSync(root, { recursive: true });
}

// --- writeSpecFile: PROJECT.md precondition paths ---

// Test 14: Missing PROJECT.md — no planningDir PROJECT.md, specData.project absent → refuses.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  // Do NOT seed planningDir.

  const result = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'no-proj', title: 'No proj' },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /PROJECT\.md not found/i);
  assert.match(result.reason, /fsd:new-project/);
  // No file written
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 15: Invalid PROJECT.md — loader flags validation errors → refuses with those errors.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  fs.mkdirSync(planningDir, { recursive: true });
  // Write a PROJECT.md that fails validateProject (missing required fields).
  fs.writeFileSync(path.join(planningDir, 'PROJECT.md'), '---\ntitle: Half a project\n---\n\n# X\n');

  const result = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'bad-proj', title: 'Bad proj' },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /PROJECT\.md invalid/i);
  // Should surface the specific missing-field errors from validateProject
  assert.match(result.reason, /project:|id:|status:|created:/);
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 16: Caller-passed specData.project bypasses PROJECT.md loader entirely.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  // No PROJECT.md — but specData.project is set, so loader is not invoked.

  const result = writeSpecFile({
    projectPath, planningDir,
    specData: { id: 'override', title: 'Override', project: 'Direct Injection' },
  });
  assert.strictEqual(result.ok, true, result.reason);
  const fm = extractFrontmatter(fs.readFileSync(result.written[0], 'utf-8'));
  assert.strictEqual(fm.project, 'Direct Injection');

  fs.rmSync(root, { recursive: true });
}

// --- atomicity ---

// Test 17: A pre-write validation failure leaves zero trace on disk (no tmp files).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProjectMd(planningDir);
  // Pre-create the spec dir so we can confirm no tmp files leak.
  fs.mkdirSync(path.join(projectPath, 'spec'), { recursive: true });

  const result = writeSpecFile({
    projectPath, planningDir,
    specData: {
      id: 'atomicity-check',
      title: 'Atomicity',
      // related entry fails CROSS_REF → validateSpec rejects → write aborts.
      related: ['not-a-valid-ref'],
    },
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /invalid frontmatter/i);
  // Target file absent
  assert.strictEqual(fs.existsSync(path.join(projectPath, 'spec', 'atomicity-check.md')), false);
  // No tmp files leaked
  const entries = fs.readdirSync(path.join(projectPath, 'spec'));
  assert.strictEqual(entries.length, 0, `expected empty spec dir; got ${entries.join(', ')}`);

  fs.rmSync(root, { recursive: true });
}

console.log('  All spec tests passed');
