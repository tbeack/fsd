#!/usr/bin/env node
'use strict';

// Integration tests for the `/fsd:spec` skill.
// - Exercises scripts/spec.js's CLI entry point via execFileSync against a
//   throwaway fixture project that has a valid PROJECT.md seeded by
//   writeProjectFiles (same path the skill uses at runtime).
// - Asserts SKILL.md exists, declares name: spec, and documents the
//   create-only contract and PROJECT.md precondition behavior.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(pluginRoot, 'scripts', 'spec.js');
const skillPath = path.join(pluginRoot, 'skills', 'spec', 'SKILL.md');

const { writeProjectFiles } = require(path.join(pluginRoot, 'scripts', 'new-project.js'));
const { scanArtifacts } = require(path.join(pluginRoot, 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-spec-cli-'));
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  return parseYaml(m[1]);
}

function seedProject(planningDir, projectName = 'Fixture Project') {
  return writeProjectFiles({
    planningDir,
    projectData: { project: projectName, id: 'fixture', title: projectName, vision: 'fixture' },
    roadmapData: {
      project: projectName, id: 'fixture-roadmap', title: `${projectName} Roadmap`,
      version: '0.1', current_milestone: 'v1',
    },
  });
}

function runCli(projectPath, args) {
  try {
    const out = execFileSync('node', [scriptPath, projectPath, ...args], {
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

// Test 1: CLI happy path via --json payload — file lands, scanner picks it up.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  assert.strictEqual(seedProject(planningDir).ok, true);

  const payload = path.join(root, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({
    id: 'cli-spec',
    title: 'CLI Spec',
    sections: { problem: 'Spec via CLI', acceptance: '- [ ] file exists' },
  }));

  const { code, result } = runCli(projectPath, [`--json=${payload}`, `--planning-dir=${planningDir}`]);
  assert.strictEqual(code, 0, `expected exit 0; got ${code}; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.written.length, 1);
  const expected = path.join(projectPath, 'spec', 'cli-spec.md');
  assert.strictEqual(result.written[0], expected);

  // The CLI picks up specData.project from PROJECT.md (loaded via planningDir)
  const fm = extractFrontmatter(fs.readFileSync(expected, 'utf-8'));
  assert.strictEqual(fm.project, 'Fixture Project');
  assert.strictEqual(fm.id, 'cli-spec');

  // Round-trip through scanArtifacts — the scanner the artifact-validate path uses
  const scanned = scanArtifacts({ fsdDir: projectPath, kind: 'spec', dirName: 'spec' });
  assert.strictEqual(scanned.length, 1);
  assert.strictEqual(scanned[0].validation.valid, true, scanned[0].validation.errors.join('; '));

  fs.rmSync(root, { recursive: true });
}

// Test 2: CLI happy path via flag-style args (no JSON payload file).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);

  const { code, result } = runCli(projectPath, [
    '--id=flag-spec',
    '--title=Flag Spec',
    '--status=active',
    '--tags=feature,cli',
    `--planning-dir=${planningDir}`,
  ]);
  assert.strictEqual(code, 0, `expected exit 0; got ${code}; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true, result.reason);

  const fm = extractFrontmatter(fs.readFileSync(result.written[0], 'utf-8'));
  assert.strictEqual(fm.status, 'active');
  assert.deepStrictEqual(fm.tags, ['feature', 'cli']);
  assert.strictEqual(fm.project, 'Fixture Project');

  fs.rmSync(root, { recursive: true });
}

// Test 3: CLI refuses to overwrite; exits 1 with reason.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);

  const first = runCli(projectPath, ['--id=once', '--title=Once', `--planning-dir=${planningDir}`]);
  assert.strictEqual(first.code, 0);

  const second = runCli(projectPath, ['--id=once', '--title=Again', `--planning-dir=${planningDir}`]);
  assert.strictEqual(second.code, 1);
  assert.strictEqual(second.result.ok, false);
  assert.match(second.result.reason, /refusing to overwrite/i);

  fs.rmSync(root, { recursive: true });
}

// Test 4: CLI aborts when PROJECT.md is missing and no --project flag passed.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning'); // not created

  const { code, result } = runCli(projectPath, [
    '--id=no-proj', '--title=No Proj', `--planning-dir=${planningDir}`,
  ]);
  assert.strictEqual(code, 1);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /PROJECT\.md not found/i);

  fs.rmSync(root, { recursive: true });
}

// Test 5: No projectPath argument → usage error (exit 2).
{
  try {
    execFileSync('node', [scriptPath], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected non-zero exit');
  } catch (err) {
    assert.strictEqual(err.status, 2);
    assert.match(err.stderr || '', /usage:/i);
  }
}

// Test 6: SKILL.md exists, declares name: spec, and documents the contract.
{
  assert.ok(fs.existsSync(skillPath), 'fsd-spec SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');

  assert.match(content, /^---\s*\nname: spec/m, 'frontmatter must declare name: spec');
  // PROJECT.md precondition path referenced
  assert.ok(content.includes('PROJECT.md'), 'skill must reference PROJECT.md');
  assert.ok(content.includes('/fsd:new-project'), 'skill must reference /fsd:new-project chain-invocation');
  // Refusal / create-only contract documented
  assert.match(content, /refuse.*overwrite|overwrite.*refuse|create-only/i);
  // All six body sections named (spot-check)
  for (const heading of ['Problem', 'Goals', 'Non-goals', 'Requirements', 'Acceptance', 'Open questions']) {
    assert.ok(content.includes(heading), `skill must mention the ${heading} section`);
  }
  // Forward pointer to /fsd:plan (the downstream consumer)
  assert.ok(content.includes('/fsd:plan'), 'skill must point forward at /fsd:plan as the downstream consumer');
}

console.log('  All fsd-spec integration tests passed');
