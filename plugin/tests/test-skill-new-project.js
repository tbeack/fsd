#!/usr/bin/env node
'use strict';

// Integration test for the `/fsd:new-project` skill. The skill's Step 4
// delegates the actual write to `plugin/scripts/new-project.js` via a `node
// -e` invocation. This test exercises the same contract: runs the backing
// script as a child process against a throwaway fixture dir, then confirms
// both files landed with valid frontmatter and the refuse-to-overwrite path
// returns the expected error.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(pluginRoot, 'scripts', 'new-project.js');
const { loadProjectContext } = require(path.join(pluginRoot, 'scripts', 'loader.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-newproj-'));
}

// Runs the same command shape the skill's Step 4 uses.
function runBacking({ planningDir, projectData, roadmapData }) {
  const runner = `
    const { writeProjectFiles } = require(${JSON.stringify(scriptPath)});
    const result = writeProjectFiles({
      planningDir: process.argv[1],
      projectData: JSON.parse(process.argv[2]),
      roadmapData: JSON.parse(process.argv[3]),
    });
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  `;
  try {
    const out = execFileSync('node', [
      '-e', runner,
      planningDir,
      JSON.stringify(projectData),
      JSON.stringify(roadmapData),
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, result: JSON.parse(out) };
  } catch (err) {
    return { code: err.status, result: JSON.parse(err.stdout || '{}') };
  }
}

// Test 1: End-to-end happy path — script writes both files, validators pass
{
  const root = mkTmpDir();
  const planningDir = path.join(root, 'planning');
  const { code, result } = runBacking({
    planningDir,
    projectData: {
      project: 'Demo Project',
      id: 'demo-project',
      title: 'Demo Project',
      vision: 'prove the kickoff works end-to-end',
      target_users: ['me'],
    },
    roadmapData: {
      project: 'Demo Project',
      id: 'demo-project-roadmap',
      title: 'Demo Project Roadmap',
      version: '0.1',
      current_milestone: 'v1',
    },
  });

  assert.strictEqual(code, 0);
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.written.length, 2);
  assert.ok(fs.existsSync(path.join(planningDir, 'PROJECT.md')));
  assert.ok(fs.existsSync(path.join(planningDir, 'ROADMAP.md')));

  // loader.loadProjectContext round-trips + revalidates both
  const ctx = loadProjectContext({ planningDir });
  assert.strictEqual(ctx.project.validation.valid, true, ctx.project.validation.errors.join('; '));
  assert.strictEqual(ctx.roadmap.validation.valid, true, ctx.roadmap.validation.errors.join('; '));
  assert.strictEqual(ctx.project.meta.project, 'Demo Project');
  assert.strictEqual(ctx.roadmap.meta.version, '0.1');
  assert.strictEqual(ctx.roadmap.meta.current_milestone, 'v1');

  fs.rmSync(root, { recursive: true });
}

// Test 2: Refuse-to-overwrite — pre-existing PROJECT.md blocks the write
{
  const root = mkTmpDir();
  const planningDir = path.join(root, 'planning');
  fs.mkdirSync(planningDir, { recursive: true });
  fs.writeFileSync(path.join(planningDir, 'PROJECT.md'), '# Already there\n');

  const { code, result } = runBacking({
    planningDir,
    projectData: { project: 'X', id: 'x', title: 'X' },
    roadmapData: {
      project: 'X', id: 'xr', title: 'X',
      version: '0.1', current_milestone: 'v1',
    },
  });

  assert.strictEqual(code, 1);
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason.includes('PROJECT.md'), `expected reason to mention PROJECT.md; got: ${result.reason}`);
  // Original content untouched
  assert.strictEqual(fs.readFileSync(path.join(planningDir, 'PROJECT.md'), 'utf-8'), '# Already there\n');
  // Side-effect check: no ROADMAP.md leaked through
  assert.strictEqual(fs.existsSync(path.join(planningDir, 'ROADMAP.md')), false);

  fs.rmSync(root, { recursive: true });
}

// Test 3: Skill file exists and advertises a valid schema-compliant frontmatter
{
  const skillPath = path.join(pluginRoot, 'skills', 'new-project', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'fsd-new-project SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/^---\s*\nname: fsd:new-project/m.test(content), 'frontmatter must declare name: fsd:new-project');
  assert.ok(content.includes('planning/PROJECT.md'));
  assert.ok(content.includes('planning/ROADMAP.md'));
  // Must call out the refuse-to-overwrite guarantee
  assert.ok(/overwrite/i.test(content), 'skill must document overwrite behavior');
}

// --- verification field in interview (FSD-009) ---

// Test 4: SKILL.md documents the optional verification prompt with subfields.
{
  const skillPath = path.join(pluginRoot, 'skills', 'new-project', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf-8');
  // Prompt prose + subfield names + skip escape.
  assert.ok(/verification/i.test(content), 'SKILL.md must mention the verification prompt');
  assert.ok(/tests/.test(content) && /validate/.test(content));
  assert.ok(/typecheck/.test(content) && /lint/.test(content));
  assert.ok(/skip/i.test(content), 'SKILL.md must document the skip escape');
  assert.ok(/\/fsd:execute-plan/.test(content), 'SKILL.md must cross-reference the executor');
}

// Test 5: End-to-end — engineer-supplied verification lands in PROJECT.md and round-trips.
{
  const root = mkTmpDir();
  const planningDir = path.join(root, 'planning');
  const { code, result } = runBacking({
    planningDir,
    projectData: {
      project: 'V Demo', id: 'v-demo', title: 'V Demo',
      vision: 'show verification round-trip',
      verification: { tests: 'bash run.sh', validate: 'node v.js' },
    },
    roadmapData: {
      project: 'V Demo', id: 'v-demo-roadmap', title: 'V Demo Roadmap',
      version: '0.1', current_milestone: 'v1',
    },
  });
  assert.strictEqual(code, 0, JSON.stringify(result));
  assert.strictEqual(result.ok, true);

  const ctx = loadProjectContext({ planningDir });
  assert.strictEqual(ctx.project.validation.valid, true);
  assert.deepStrictEqual(
    ctx.project.meta.verification,
    { tests: 'bash run.sh', validate: 'node v.js' },
  );

  const contents = fs.readFileSync(path.join(planningDir, 'PROJECT.md'), 'utf-8');
  assert.match(contents, /verification:/);
  assert.match(contents, /  tests: bash run\.sh/);
  fs.rmSync(root, { recursive: true });
}

// Test 6: Engineer skipped the prompt → no verification in output.
{
  const root = mkTmpDir();
  const planningDir = path.join(root, 'planning');
  const { code, result } = runBacking({
    planningDir,
    projectData: { project: 'S', id: 's', title: 'S' },
    roadmapData: { project: 'S', id: 's-r', title: 'S R', version: '0.1', current_milestone: 'v1' },
  });
  assert.strictEqual(code, 0, JSON.stringify(result));
  const contents = fs.readFileSync(path.join(planningDir, 'PROJECT.md'), 'utf-8');
  assert.ok(!/verification:/.test(contents), 'PROJECT.md must not emit verification when omitted');
  fs.rmSync(root, { recursive: true });
}

console.log('  All fsd-new-project integration tests passed');
