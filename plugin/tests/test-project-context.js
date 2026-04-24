#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateProject,
  validateRoadmap,
  validateArchitecture,
  SEMVER_LIKE,
  KEBAB_CASE,
} = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { loadProjectContext, loadContent } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const {
  writeProjectFiles,
  renderProject,
  renderRoadmap,
  PROJECT_FILENAME,
  ROADMAP_FILENAME,
} = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-proj-'));
}

const minimalProject = (over = {}) => ({
  project: 'My Project',
  id: 'my-project',
  title: 'My Project',
  status: 'active',
  created: '2026-04-23',
  ...over,
});

const minimalRoadmap = (over = {}) => ({
  project: 'My Project',
  id: 'my-project-roadmap',
  title: 'My Project Roadmap',
  status: 'active',
  created: '2026-04-23',
  version: '0.1',
  current_milestone: 'v1',
  ...over,
});

// --- SEMVER_LIKE regex ---

// Test 1: semver-like regex accepts 1.0 / 1.0.0 and rejects bad forms
{
  for (const ok of ['0.1', '1.0', '1.0.0', '12.34.56', '2.0']) {
    assert.ok(SEMVER_LIKE.test(ok), `${ok} should match semver-like`);
  }
  for (const bad of ['1', 'v1.0', '1.0-beta', '1.', '.1', 'one.two', '1.0.0.0']) {
    assert.ok(!SEMVER_LIKE.test(bad), `${bad} should NOT match semver-like`);
  }
}

// --- validateProject ---

// Test 2: minimal valid PROJECT passes
{
  const r = validateProject(minimalProject());
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 3: missing each common required field rejects
{
  for (const field of ['project', 'id', 'title', 'status', 'created']) {
    const m = minimalProject();
    delete m[field];
    const r = validateProject(m);
    assert.strictEqual(r.valid, false, `missing ${field} should fail`);
    assert.ok(r.errors.some(e => e.startsWith(`${field}:`)));
  }
}

// Test 4: non-kebab id rejected (shared with artifact schema)
{
  const r = validateProject(minimalProject({ id: 'My_Project' }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('id:')));
  assert.ok(KEBAB_CASE.test('my-project'));
}

// Test 5: vision and target_users optional, validated when present
{
  const ok = validateProject(minimalProject({
    vision: 'A tool for X',
    target_users: ['solo devs', 'small teams'],
  }));
  assert.strictEqual(ok.valid, true, ok.errors.join('; '));

  const badVision = validateProject(minimalProject({ vision: '' }));
  assert.strictEqual(badVision.valid, false);
  assert.ok(badVision.errors.some(e => e.startsWith('vision:')));

  const badUsers = validateProject(minimalProject({ target_users: ['ok', ''] }));
  assert.strictEqual(badUsers.valid, false);
  assert.ok(badUsers.errors.some(e => e.startsWith('target_users:')));

  const badUsers2 = validateProject(minimalProject({ target_users: 'solo dev' }));
  assert.strictEqual(badUsers2.valid, false);
  assert.ok(badUsers2.errors.some(e => e.startsWith('target_users:')));
}

// Test 6: unknown keys accepted (lenient, matches rest of framework)
{
  const r = validateProject(minimalProject({ random_extra: 'whatever', tags: ['alpha'] }));
  assert.strictEqual(r.valid, true);
}

// --- validateRoadmap ---

// Test 7: minimal valid ROADMAP passes
{
  const r = validateRoadmap(minimalRoadmap());
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 8: missing version rejected
{
  const m = minimalRoadmap();
  delete m.version;
  const r = validateRoadmap(m);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('version:')));
}

// Test 9: malformed version rejected
{
  for (const bad of ['v1', '1', 'one.zero', '1.0-beta']) {
    const r = validateRoadmap(minimalRoadmap({ version: bad }));
    assert.strictEqual(r.valid, false, `version="${bad}" should fail`);
    assert.ok(r.errors.some(e => e.startsWith('version:')));
  }
}

// Test 10: missing current_milestone rejected
{
  const m = minimalRoadmap();
  delete m.current_milestone;
  const r = validateRoadmap(m);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('current_milestone:')));

  const empty = validateRoadmap(minimalRoadmap({ current_milestone: '' }));
  assert.strictEqual(empty.valid, false);
  assert.ok(empty.errors.some(e => e.startsWith('current_milestone:')));
}

// Test 11: roadmap inherits common-field validation (status enum, ISO date)
{
  const bad = validateRoadmap(minimalRoadmap({ status: 'wip' }));
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.errors.some(e => e.startsWith('status:')));

  const badDate = validateRoadmap(minimalRoadmap({ created: '2026/04/23' }));
  assert.strictEqual(badDate.valid, false);
  assert.ok(badDate.errors.some(e => e.startsWith('created:')));
}

// --- loadProjectContext ---

// Test 12: all three files absent → nulls inside, never throws
{
  const dir = mkTmpDir();
  const r = loadProjectContext({ planningDir: path.join(dir, 'planning') });
  assert.strictEqual(r.project, null);
  assert.strictEqual(r.roadmap, null);
  assert.strictEqual(r.architecture, null);
  assert.strictEqual(r.validation.project, null);
  assert.strictEqual(r.validation.roadmap, null);
  assert.strictEqual(r.validation.architecture, null);
  fs.rmSync(dir, { recursive: true });
}

// Test 13: one present, one absent → mixed result
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  fs.mkdirSync(planningDir);
  fs.writeFileSync(
    path.join(planningDir, PROJECT_FILENAME),
    renderProject({
      project: 'Solo', id: 'solo', title: 'Solo', vision: 'one-liner',
    }),
  );
  const r = loadProjectContext({ planningDir });
  assert.ok(r.project, 'project should be loaded');
  assert.strictEqual(r.project.validation.valid, true);
  assert.strictEqual(r.roadmap, null);
  assert.strictEqual(r.validation.roadmap, null);
  fs.rmSync(dir, { recursive: true });
}

// Test 14: both present and valid → meta + body parsed
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  const res = writeProjectFiles({
    planningDir,
    projectData: {
      project: 'FSD Demo',
      id: 'fsd-demo',
      title: 'FSD Demo',
      vision: 'Show that the kickoff works',
      target_users: ['myself'],
    },
    roadmapData: {
      project: 'FSD Demo',
      id: 'fsd-demo-roadmap',
      title: 'FSD Demo Roadmap',
      version: '0.1',
      current_milestone: 'v1',
    },
  });
  assert.strictEqual(res.ok, true, res.reason);

  const r = loadProjectContext({ planningDir });
  assert.ok(r.project);
  assert.ok(r.roadmap);
  assert.strictEqual(r.architecture, null); // absent in this fixture
  assert.strictEqual(r.project.meta.project, 'FSD Demo');
  assert.strictEqual(r.roadmap.meta.version, '0.1');
  assert.strictEqual(r.roadmap.meta.current_milestone, 'v1');
  assert.strictEqual(r.project.validation.valid, true);
  assert.strictEqual(r.roadmap.validation.valid, true);
  // Body strips frontmatter
  assert.ok(!r.project.body.startsWith('---'));
  assert.ok(r.project.body.includes('# FSD Demo'));
  fs.rmSync(dir, { recursive: true });
}

// Test 15: both present, one invalid → validation surfaced, no throw
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  fs.mkdirSync(planningDir);
  // Valid project, invalid roadmap (bad version)
  fs.writeFileSync(path.join(planningDir, PROJECT_FILENAME),
    `---\nproject: X\nid: x\ntitle: X\nstatus: active\ncreated: 2026-04-23\n---\n`);
  fs.writeFileSync(path.join(planningDir, ROADMAP_FILENAME),
    `---\nproject: X\nid: x-roadmap\ntitle: X Roadmap\nstatus: active\ncreated: 2026-04-23\nversion: broken\ncurrent_milestone: v1\n---\n`);

  const r = loadProjectContext({ planningDir });
  assert.strictEqual(r.project.validation.valid, true);
  assert.strictEqual(r.roadmap.validation.valid, false);
  assert.ok(r.roadmap.validation.errors.some(e => e.startsWith('version:')));
  fs.rmSync(dir, { recursive: true });
}

// --- writeProjectFiles: refuse-to-overwrite ---

// Test 16: refuses when PROJECT.md already exists
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  fs.mkdirSync(planningDir);
  fs.writeFileSync(path.join(planningDir, PROJECT_FILENAME), 'existing');

  const res = writeProjectFiles({
    planningDir,
    projectData: { project: 'X', id: 'x', title: 'X' },
    roadmapData: { project: 'X', id: 'xr', title: 'X', version: '0.1', current_milestone: 'v1' },
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.reason.includes('PROJECT.md'));
  // Original untouched
  assert.strictEqual(fs.readFileSync(path.join(planningDir, PROJECT_FILENAME), 'utf-8'), 'existing');
  // ROADMAP not written either (all-or-nothing)
  assert.strictEqual(fs.existsSync(path.join(planningDir, ROADMAP_FILENAME)), false);
  fs.rmSync(dir, { recursive: true });
}

// Test 17: refuses when ROADMAP.md already exists
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  fs.mkdirSync(planningDir);
  fs.writeFileSync(path.join(planningDir, ROADMAP_FILENAME), 'existing');

  const res = writeProjectFiles({
    planningDir,
    projectData: { project: 'X', id: 'x', title: 'X' },
    roadmapData: { project: 'X', id: 'xr', title: 'X', version: '0.1', current_milestone: 'v1' },
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.reason.includes('ROADMAP.md'));
  assert.strictEqual(fs.existsSync(path.join(planningDir, PROJECT_FILENAME)), false);
  fs.rmSync(dir, { recursive: true });
}

// Test 18: creates planning/ dir if missing
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'deeper', 'planning');
  const res = writeProjectFiles({
    planningDir,
    projectData: { project: 'X', id: 'x', title: 'X' },
    roadmapData: { project: 'X', id: 'xr', title: 'X', version: '0.1', current_milestone: 'v1' },
  });
  assert.strictEqual(res.ok, true, res.reason);
  assert.strictEqual(fs.existsSync(path.join(planningDir, PROJECT_FILENAME)), true);
  assert.strictEqual(fs.existsSync(path.join(planningDir, ROADMAP_FILENAME)), true);
  fs.rmSync(dir, { recursive: true });
}

// Test 19: rendered output passes validator round-trip
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  writeProjectFiles({
    planningDir,
    projectData: {
      project: 'Round Trip',
      id: 'round-trip',
      title: 'Round Trip Test',
      vision: 'proving the render pipeline',
      target_users: ['devs', 'testers'],
    },
    roadmapData: {
      project: 'Round Trip',
      id: 'round-trip-roadmap',
      title: 'Round Trip Roadmap',
      version: '1.0.0',
      current_milestone: 'mvp',
    },
  });
  const r = loadProjectContext({ planningDir });
  assert.strictEqual(r.project.validation.valid, true, r.project.validation.errors.join('; '));
  assert.strictEqual(r.roadmap.validation.valid, true, r.roadmap.validation.errors.join('; '));
  assert.deepStrictEqual(r.project.meta.target_users, ['devs', 'testers']);
  fs.rmSync(dir, { recursive: true });
}

// Test 20: renderProject/renderRoadmap produce frontmatter + markdown body
{
  const p = renderProject({ project: 'P', id: 'p', title: 'P' });
  assert.ok(p.startsWith('---\n'));
  assert.ok(p.includes('# P'));
  assert.ok(p.includes('## Identity'));
  assert.ok(p.includes('## Anti-goals'));

  const r = renderRoadmap({
    project: 'P', id: 'p-r', title: 'P Roadmap',
    version: '0.1', current_milestone: 'v1',
  });
  assert.ok(r.includes('## Milestone v1'));
  assert.ok(r.includes('### Phase v1.1'));
}

// --- loadContent integration: projectContext surfaced ---

// Test 21: loadContent returns projectContext key (additive extension)
{
  const dir = mkTmpDir();
  const r = loadContent({
    corePath: '/nonexistent',
    userPath: '/nonexistent',
    projectPath: path.join(dir, '.fsd'),
    config: {},
  });
  assert.ok('projectContext' in r, 'projectContext field must be present');
  assert.strictEqual(r.projectContext.project, null);
  assert.strictEqual(r.projectContext.roadmap, null);
  // Prior fields untouched
  assert.deepStrictEqual(r.skills, []);
  assert.deepStrictEqual(r.agents, []);
  assert.deepStrictEqual(r.commands, []);
  assert.strictEqual(typeof r.validationSummary, 'object');
  fs.rmSync(dir, { recursive: true });
}

// Test 22: loadContent picks up PROJECT.md + ROADMAP.md from sibling planning/
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  fs.mkdirSync(projectPath);
  const planningDir = path.join(root, 'planning');
  writeProjectFiles({
    planningDir,
    projectData: { project: 'Site', id: 'site', title: 'Site' },
    roadmapData: {
      project: 'Site', id: 'site-roadmap', title: 'Site Roadmap',
      version: '0.1', current_milestone: 'v1',
    },
  });

  const r = loadContent({
    corePath: '/nonexistent', userPath: '/nonexistent', projectPath, config: {},
  });
  assert.ok(r.projectContext.project);
  assert.ok(r.projectContext.roadmap);
  assert.strictEqual(r.projectContext.architecture, null);
  assert.strictEqual(r.projectContext.project.meta.project, 'Site');
  assert.strictEqual(r.projectContext.roadmap.meta.current_milestone, 'v1');
  fs.rmSync(root, { recursive: true });
}

// --- validateArchitecture ---

// Test 23: minimal valid ARCHITECTURE passes
{
  const r = validateArchitecture({
    project: 'Demo', id: 'architecture', title: 'Demo Architecture',
    status: 'active', created: '2026-04-24',
  });
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 24: missing each common required field rejects
{
  const minimal = {
    project: 'Demo', id: 'architecture', title: 'Demo Architecture',
    status: 'active', created: '2026-04-24',
  };
  for (const field of ['project', 'id', 'title', 'status', 'created']) {
    const m = { ...minimal };
    delete m[field];
    const r = validateArchitecture(m);
    assert.strictEqual(r.valid, false, `missing ${field} should fail`);
    assert.ok(r.errors.some(e => e.startsWith(`${field}:`)));
  }
}

// Test 25: optional tags must be kebab-case array when present
{
  const good = validateArchitecture({
    project: 'D', id: 'architecture', title: 'D', status: 'active', created: '2026-04-24',
    tags: ['platform', 'backend'],
  });
  assert.strictEqual(good.valid, true);
  const bad = validateArchitecture({
    project: 'D', id: 'architecture', title: 'D', status: 'active', created: '2026-04-24',
    tags: ['Bad_Tag'],
  });
  assert.strictEqual(bad.valid, false);
}

// --- loadProjectContext: architecture present ---

// Test 26: architecture file present + valid → surfaced alongside project+roadmap
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  const res = writeProjectFiles({
    planningDir,
    projectData: { project: 'ArchFix', id: 'arch-fix', title: 'Arch Fix', vision: 'demo' },
    roadmapData: {
      project: 'ArchFix', id: 'arch-fix-roadmap', title: 'Arch Fix Roadmap',
      version: '0.1', current_milestone: 'v1',
    },
  });
  assert.strictEqual(res.ok, true);
  // Hand-write a minimal ARCHITECTURE.md to avoid coupling to architecture.js here.
  fs.writeFileSync(path.join(planningDir, 'ARCHITECTURE.md'),
    `---\nproject: ArchFix\nid: architecture\ntitle: ArchFix Architecture\nstatus: active\ncreated: 2026-04-24\n---\n\n# ArchFix Architecture\n\n## Stack & Technical Details\n\n_placeholder_\n`);

  const r = loadProjectContext({ planningDir });
  assert.ok(r.architecture, 'architecture should be loaded');
  assert.strictEqual(r.architecture.meta.project, 'ArchFix');
  assert.strictEqual(r.architecture.validation.valid, true);
  assert.strictEqual(r.validation.architecture.valid, true);
  assert.ok(!r.architecture.body.startsWith('---'));
  fs.rmSync(dir, { recursive: true });
}

// Test 27: architecture file present + invalid → validation surfaces errors
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  fs.mkdirSync(planningDir);
  // Invalid: missing required `title` and bad `status` value.
  fs.writeFileSync(path.join(planningDir, 'ARCHITECTURE.md'),
    `---\nproject: X\nid: architecture\nstatus: bogus\ncreated: 2026-04-24\n---\n`);
  const r = loadProjectContext({ planningDir });
  assert.ok(r.architecture);
  assert.strictEqual(r.architecture.validation.valid, false);
  assert.ok(r.architecture.validation.errors.length > 0);
  fs.rmSync(dir, { recursive: true });
}

// --- verification: field propagates through loadProjectContext (FSD-009) ---

// Test 28: PROJECT.md verification field round-trips through loadProjectContext.meta.
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  const res = writeProjectFiles({
    planningDir,
    projectData: {
      project: 'VProj', id: 'vproj', title: 'VProj',
      verification: { tests: 'bash tests.sh', validate: 'node v.js' },
    },
    roadmapData: {
      project: 'VProj', id: 'vproj-roadmap', title: 'VProj Roadmap',
      version: '0.1', current_milestone: 'v1',
    },
  });
  assert.strictEqual(res.ok, true, res.reason);

  const ctx = loadProjectContext({ planningDir });
  assert.strictEqual(ctx.project.validation.valid, true);
  assert.deepStrictEqual(
    ctx.project.meta.verification,
    { tests: 'bash tests.sh', validate: 'node v.js' },
  );
  fs.rmSync(dir, { recursive: true });
}

// Test 29: invalid verification (non-object) surfaces as a validation error.
{
  const dir = mkTmpDir();
  const planningDir = path.join(dir, 'planning');
  fs.mkdirSync(planningDir);
  fs.writeFileSync(
    path.join(planningDir, PROJECT_FILENAME),
    [
      '---',
      'project: Bad',
      'id: bad',
      'title: Bad',
      'status: active',
      'created: 2026-04-24',
      'verification: not-an-object',
      '---',
      '',
      '# Bad',
    ].join('\n'),
  );
  const ctx = loadProjectContext({ planningDir });
  assert.ok(ctx.project);
  assert.strictEqual(ctx.project.validation.valid, false);
  assert.ok(ctx.project.validation.errors.some(e => /verification/.test(e)));
  fs.rmSync(dir, { recursive: true });
}

console.log('  All project-context tests passed');
