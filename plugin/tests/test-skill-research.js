#!/usr/bin/env node
'use strict';

// Integration tests for the `/fsd:research` skill (FSD-010).
// - Exercises scripts/research.js CLI via execFileSync against throwaway fixtures.
// - Asserts SKILL.md exists, declares name: fsd:research, and documents
//   the create-only contract, PROJECT.md precondition, all six body sections,
//   sources/conclusion prompts, and guardrails.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(pluginRoot, 'scripts', 'research.js');
const skillPath = path.join(pluginRoot, 'skills', 'research', 'SKILL.md');

const { writeProjectFiles } = require(path.join(pluginRoot, 'scripts', 'new-project.js'));
const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-research-cli-'));
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

// Test 1: CLI happy path via --json payload — file lands, content validated.
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  assert.strictEqual(seedProject(planningDir).ok, true);

  const payload = path.join(root, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({
    id: 'cli-research',
    title: 'CLI Research',
    sources: ['https://example.com'],
    conclusion: 'It works.',
    sections: { question: 'Does the CLI work?', findings: 'Yes.' },
  }));

  const { code, result } = runCli(projectPath, [`--json=${payload}`, `--planning-dir=${planningDir}`]);
  assert.strictEqual(code, 0, `expected exit 0; got ${code}; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.written.length, 1);
  const expected = path.join(projectPath, 'research', 'cli-research.md');
  assert.strictEqual(result.written[0], expected);

  const fm = extractFrontmatter(fs.readFileSync(expected, 'utf-8'));
  assert.strictEqual(fm.project, 'Fixture Project');
  assert.strictEqual(fm.id, 'cli-research');
  assert.deepStrictEqual(fm.sources, ['https://example.com']);
  assert.strictEqual(fm.conclusion, 'It works.');

  fs.rmSync(root, { recursive: true });
}

// Test 2: CLI happy path via flag-style args (no JSON file).
{
  const root = mkTmpDir();
  const projectPath = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  seedProject(planningDir);

  const { code, result } = runCli(projectPath, [
    '--id=flag-research',
    '--title=Flag Research',
    '--status=active',
    '--tags=auth,security',
    '--conclusion=Prefer OAuth2.',
    `--planning-dir=${planningDir}`,
  ]);
  assert.strictEqual(code, 0, `expected exit 0; result=${JSON.stringify(result)}`);
  assert.strictEqual(result.ok, true, result.reason);

  const fm = extractFrontmatter(fs.readFileSync(result.written[0], 'utf-8'));
  assert.strictEqual(fm.status, 'active');
  assert.deepStrictEqual(fm.tags, ['auth', 'security']);
  assert.strictEqual(fm.conclusion, 'Prefer OAuth2.');
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

// Test 6: SKILL.md exists, declares correct frontmatter, documents the full contract.
{
  assert.ok(fs.existsSync(skillPath), 'research SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');

  // Frontmatter
  assert.match(content, /^---\s*\nname: fsd:research/m, 'frontmatter must declare name: fsd:research');
  assert.match(content, /argument-hint:/m, 'frontmatter must include argument-hint');
  const descMatch = content.match(/description:\s*(.+)/);
  assert.ok(descMatch && descMatch[1].trim().length >= 20, 'description must be at least 20 chars');

  // All six steps documented
  for (let i = 1; i <= 6; i++) {
    assert.ok(content.includes(`## Step ${i}:`), `SKILL.md must document Step ${i}`);
  }

  // PROJECT.md precondition + chain-invoke documented
  assert.ok(content.includes('PROJECT.md'), 'skill must reference PROJECT.md');
  assert.ok(content.includes('/fsd:new-project'), 'skill must reference /fsd:new-project chain-invocation');

  // Sources and conclusion prompts documented
  assert.ok(content.includes('Sources'), 'skill must document Sources prompt');
  assert.ok(content.includes('Conclusion'), 'skill must document Conclusion prompt');
  assert.ok(content.includes("'skip'") || content.includes("skip"), 'skill must document skip escape for conclusion');

  // All six body sections named
  for (const heading of ['Question', 'Context', 'Method', 'Findings', 'Conclusion', 'Open questions']) {
    assert.ok(content.includes(heading), `skill must mention the ${heading} section`);
  }

  // Guardrails documented
  assert.match(content, /Guardrails/i, 'skill must have a Guardrails section');
  assert.match(content, /refuse.*overwrite|overwrite.*refuse|Never overwrite/i,
    'guardrails must document no-overwrite');
  assert.ok(content.includes("project:") || content.includes('project:'),
    'guardrails must address project: auto-injection');
  assert.match(content, /auto-commit|push/i, 'guardrails must forbid auto-commit/push');
}

console.log('  All fsd-research integration tests passed');
