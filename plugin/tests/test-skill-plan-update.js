#!/usr/bin/env node
'use strict';

// Integration tests for the `/fsd:plan-update` skill.
// - Exercises the scripts/plan-update.js CLI entry point via execFileSync
//   against a throwaway fixture project with seeded plans, one call per op.
// - Asserts SKILL.md exists, declares name: fsd:plan-update, documents all
//   three ops by name, cross-references /fsd:plan, and covers the
//   spec-hard-require footgun warning in Guardrails.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(pluginRoot, 'scripts', 'plan-update.js');
const skillPath = path.join(pluginRoot, 'skills', 'plan-update', 'SKILL.md');

const { writeProjectFiles } = require(path.join(pluginRoot, 'scripts', 'new-project.js'));
const { writeSpecFile } = require(path.join(pluginRoot, 'scripts', 'spec.js'));
const { writePlanFile } = require(path.join(pluginRoot, 'scripts', 'plan.js'));
const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-planupd-cli-'));
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  return m ? parseYaml(m[1]) : {};
}

function seedProject(planningDir) {
  return writeProjectFiles({
    planningDir,
    projectData: { project: 'Fixture', id: 'fixture', title: 'Fixture' },
    roadmapData: { project: 'Fixture', id: 'r', title: 'R', version: '0.1', current_milestone: 'v1' },
  });
}

function seedPlan(projectPath, planningDir, id) {
  // Seed a spec with the same id + "-spec" to satisfy the hard-require.
  const specId = `${id}-spec`;
  const specRes = writeSpecFile({
    projectPath, planningDir,
    specData: { id: specId, title: specId, status: 'active', approved: true },
  });
  assert.strictEqual(specRes.ok, true, specRes.reason);
  const planRes = writePlanFile({
    projectPath, planningDir,
    planData: {
      id,
      title: id.replace(/-/g, ' '),
      related: [`spec/${specId}`],
      sections: { context: 'C.', approach: 'A.' },
    },
  });
  assert.strictEqual(planRes.ok, true, planRes.reason);
  return planRes.written[0];
}

function runCli(projectPath, op, args) {
  try {
    const out = execFileSync('node', [scriptPath, projectPath, op, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, result: JSON.parse(out) };
  } catch (err) {
    let parsed = {};
    try { parsed = JSON.parse(err.stdout || '{}'); } catch (_) { /* keep empty */ }
    return { code: err.status, result: parsed, stderr: err.stderr };
  }
}

// Test 1: CLI update title — exit 0, file updated, frontmatter re-validates.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'cli-title');

  const { code, result } = runCli(projectPath, 'update', [
    '--id=cli-title', '--target=title', '--value=Brand New Title',
  ]);
  assert.strictEqual(code, 0, `expected 0; got ${code}; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);

  const after = fs.readFileSync(pp, 'utf-8');
  assert.strictEqual(extractFrontmatter(after).title, 'Brand New Title');
  assert.match(after, /^# Brand New Title$/m);

  fs.rmSync(root, { recursive: true });
}

// Test 2: CLI update related add/remove roundtrip.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'cli-related');

  const add = runCli(projectPath, 'update', [
    '--id=cli-related', '--target=related', '--action=add', '--value=plan/other',
  ]);
  assert.strictEqual(add.code, 0); assert.strictEqual(add.result.ok, true);
  const fmAfterAdd = extractFrontmatter(fs.readFileSync(pp, 'utf-8'));
  assert.ok(fmAfterAdd.related.includes('plan/other'));

  const rm = runCli(projectPath, 'update', [
    '--id=cli-related', '--target=related', '--action=remove', '--value=plan/other',
  ]);
  assert.strictEqual(rm.code, 0); assert.strictEqual(rm.result.ok, true);
  const fmAfterRm = extractFrontmatter(fs.readFileSync(pp, 'utf-8'));
  assert.ok(!fmAfterRm.related.includes('plan/other'));

  fs.rmSync(root, { recursive: true });
}

// Test 3: CLI update depends_on add/remove roundtrip.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'cli-deps');

  const add = runCli(projectPath, 'update', [
    '--id=cli-deps', '--target=depends_on', '--action=add', '--value=infra-bootstrap',
  ]);
  assert.strictEqual(add.code, 0); assert.strictEqual(add.result.ok, true);
  assert.deepStrictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).depends_on, ['infra-bootstrap']);

  const rm = runCli(projectPath, 'update', [
    '--id=cli-deps', '--target=depends_on', '--action=remove', '--value=infra-bootstrap',
  ]);
  assert.strictEqual(rm.code, 0); assert.strictEqual(rm.result.ok, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).depends_on, undefined);

  fs.rmSync(root, { recursive: true });
}

// Test 4: CLI update task set/clear roundtrip.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const pp = seedPlan(projectPath, planningDir, 'cli-task');

  const set = runCli(projectPath, 'update', [
    '--id=cli-task', '--target=task', '--action=set', '--value=FSD-042',
  ]);
  assert.strictEqual(set.code, 0); assert.strictEqual(set.result.ok, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).task, 'FSD-042');

  const clear = runCli(projectPath, 'update', [
    '--id=cli-task', '--target=task', '--action=clear',
  ]);
  assert.strictEqual(clear.code, 0); assert.strictEqual(clear.result.ok, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(pp, 'utf-8')).task, undefined);

  fs.rmSync(root, { recursive: true });
}

// Test 5: CLI archive on a nonexistent plan exits 1 with a reason.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  fs.mkdirSync(path.join(projectPath, 'plan'), { recursive: true });

  const { code, result } = runCli(projectPath, 'archive', ['--id=ghost']);
  assert.strictEqual(code, 1);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /not found/i);

  fs.rmSync(root, { recursive: true });
}

// Test 6: CLI supersede happy path + idempotency check.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const ppOld = seedPlan(projectPath, planningDir, 'v1');
  const ppNew = seedPlan(projectPath, planningDir, 'v2');

  const first = runCli(projectPath, 'supersede', ['--new-id=v2', '--old-id=v1']);
  assert.strictEqual(first.code, 0, `expected 0; got ${first.code}; result=${JSON.stringify(first.result)}`);
  assert.strictEqual(first.result.ok, true);

  assert.deepStrictEqual(extractFrontmatter(fs.readFileSync(ppNew, 'utf-8')).supersedes, ['v1']);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(ppOld, 'utf-8')).status, 'archived');

  // Idempotency — re-running is a no-op with written: false.
  const again = runCli(projectPath, 'supersede', ['--new-id=v2', '--old-id=v1']);
  assert.strictEqual(again.code, 0);
  assert.strictEqual(again.result.ok, true);
  assert.strictEqual(again.result.written, false);

  fs.rmSync(root, { recursive: true });
}

// Test 7: CLI usage error (missing op) exits 2.
{
  try {
    execFileSync('node', [scriptPath], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected non-zero exit');
  } catch (err) {
    assert.strictEqual(err.status, 2);
    assert.match(err.stderr || '', /usage:/i);
  }
}

// Test 8: SKILL.md sanity — name, all three op names, cross-reference to
// /fsd:plan, refuse-when-missing documentation, and Guardrails coverage of
// the spec-hard-require footgun warning.
{
  assert.ok(fs.existsSync(skillPath), 'fsd-plan-update SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');

  assert.match(content, /^---\s*\nname: fsd:plan-update/m, 'frontmatter must declare name: fsd:plan-update');
  assert.match(content, /argument-hint:/i, 'frontmatter must document argument-hint');
  for (const op of ['update', 'archive', 'supersede']) {
    assert.ok(content.includes(op), `SKILL.md must mention op "${op}"`);
  }
  assert.ok(content.includes('/fsd:plan'), 'SKILL.md must cross-reference /fsd:plan as the creation path');
  assert.match(content, /not exist|doesn't exist|not found/i, 'SKILL.md must document refuse-when-missing');
  assert.match(content, /preview|Apply\?/i, 'SKILL.md must mention preview-before-write discipline');
  assert.match(content, /spec-hard-require|hard-require/i, 'Guardrails must flag the spec-hard-require footgun');
  assert.match(content, /auto-commit|commit/i, 'Guardrails must forbid auto-commit');
  // All 8 update sub-targets surface in the skill.
  for (const target of ['title', 'status', 'related', 'tags', 'depends_on', 'task', 'estimate', 'section']) {
    assert.ok(content.includes(target), `SKILL.md must document update target "${target}"`);
  }
}

console.log('  All fsd-plan-update integration tests passed');
