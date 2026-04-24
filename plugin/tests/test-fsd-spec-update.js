#!/usr/bin/env node
'use strict';

// Integration tests for the `/fsd-spec-update` skill.
// - Exercises the scripts/spec-update.js CLI entry point via execFileSync
//   against a throwaway fixture project with seeded specs, one call per op.
// - Asserts SKILL.md exists, declares name: fsd-spec-update, documents all
//   four ops by name, and cross-references /fsd-spec as the creation path.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(pluginRoot, 'scripts', 'spec-update.js');
const skillPath = path.join(pluginRoot, 'skills', 'fsd-spec-update', 'SKILL.md');

const { writeProjectFiles } = require(path.join(pluginRoot, 'scripts', 'new-project.js'));
const { writeSpecFile, resolveSpecPath } = require(path.join(pluginRoot, 'scripts', 'spec.js'));
const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-specupd-cli-'));
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

function seedSpec(projectPath, planningDir, id) {
  const res = writeSpecFile({
    projectPath, planningDir,
    specData: { id, title: id.replace(/-/g, ' '), sections: { problem: 'P.', goals: 'G.' } },
  });
  assert.strictEqual(res.ok, true, res.reason);
  return res.written[0];
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
  const sp = seedSpec(projectPath, planningDir, 'cli-title');

  const { code, result } = runCli(projectPath, 'update', [
    '--id=cli-title', '--target=title', '--value=Brand New Title',
  ]);
  assert.strictEqual(code, 0, `expected 0; got ${code}; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);

  const after = fs.readFileSync(sp, 'utf-8');
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
  const sp = seedSpec(projectPath, planningDir, 'cli-related');

  const add = runCli(projectPath, 'update', [
    '--id=cli-related', '--target=related', '--action=add', '--value=plan/auth',
  ]);
  assert.strictEqual(add.code, 0); assert.strictEqual(add.result.ok, true);
  assert.deepStrictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).related, ['plan/auth']);

  const rm = runCli(projectPath, 'update', [
    '--id=cli-related', '--target=related', '--action=remove', '--value=plan/auth',
  ]);
  assert.strictEqual(rm.code, 0); assert.strictEqual(rm.result.ok, true);
  // empty array removed from frontmatter
  assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).related, undefined);

  fs.rmSync(root, { recursive: true });
}

// Test 3: CLI approve + idempotency.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const sp = seedSpec(projectPath, planningDir, 'cli-approve');

  const first = runCli(projectPath, 'approve', ['--id=cli-approve']);
  assert.strictEqual(first.code, 0); assert.strictEqual(first.result.ok, true);
  assert.strictEqual(first.result.written, true);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(sp, 'utf-8')).approved, 'true');

  const again = runCli(projectPath, 'approve', ['--id=cli-approve']);
  assert.strictEqual(again.code, 0); assert.strictEqual(again.result.ok, true);
  assert.strictEqual(again.result.written, false);

  fs.rmSync(root, { recursive: true });
}

// Test 4: CLI archive on a nonexistent spec exits 1 with reason.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);

  const { code, result } = runCli(projectPath, 'archive', ['--id=ghost']);
  assert.strictEqual(code, 1);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /not found/i);

  fs.rmSync(root, { recursive: true });
}

// Test 5: CLI supersede — new gets supersedes entry, old becomes archived.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);
  const spOld = seedSpec(projectPath, planningDir, 'v1');
  const spNew = seedSpec(projectPath, planningDir, 'v2');

  const { code, result } = runCli(projectPath, 'supersede', ['--new-id=v2', '--old-id=v1']);
  assert.strictEqual(code, 0, `expected 0; got ${code}; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true);

  assert.deepStrictEqual(extractFrontmatter(fs.readFileSync(spNew, 'utf-8')).supersedes, ['v1']);
  assert.strictEqual(extractFrontmatter(fs.readFileSync(spOld, 'utf-8')).status, 'archived');

  fs.rmSync(root, { recursive: true });
}

// Test 6: CLI usage error (missing op) exits 2.
{
  try {
    execFileSync('node', [scriptPath], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected non-zero exit');
  } catch (err) {
    assert.strictEqual(err.status, 2);
    assert.match(err.stderr || '', /usage:/i);
  }
}

// Test 7: SKILL.md exists, declares name + all four ops + cross-references /fsd-spec.
{
  assert.ok(fs.existsSync(skillPath), 'fsd-spec-update SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');

  assert.match(content, /^---\s*\nname: fsd-spec-update/m, 'frontmatter must declare name: fsd-spec-update');
  for (const op of ['update', 'approve', 'archive', 'supersede']) {
    assert.ok(content.includes(op), `SKILL.md must mention op "${op}"`);
  }
  assert.ok(content.includes('/fsd-spec'), 'SKILL.md must cross-reference /fsd-spec as the creation path');
  // Documents the refusal-when-missing guarantee
  assert.match(content, /not exist|doesn't exist|not found/i);
  // Mentions the preview-before-write discipline
  assert.match(content, /preview|Apply\?/i);
}

console.log('  All fsd-spec-update integration tests passed');
