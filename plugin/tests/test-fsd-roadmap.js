#!/usr/bin/env node
'use strict';

// Integration test for the `/fsd-roadmap` skill. The skill delegates all
// writes to `plugin/scripts/roadmap.js` via its CLI entry point. This test
// exercises each op through execFileSync against throwaway fixtures — the
// same command shape the skill's Step 5 uses — and sanity-checks the
// SKILL.md file.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(pluginRoot, 'scripts', 'roadmap.js');
const { parseRoadmap } = require(path.join(pluginRoot, 'scripts', 'roadmap.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-skill-roadmap-'));
}

function baseRoadmap({ milestones = [
  { id: 'v1', version: '0.1', name: 'Initial', goal: 'Ship the mvp.', phases: [
    { id: 'v1.1', title: 'Bootstrap', goal: 'Stand up the basics.' },
  ]},
] } = {}) {
  const lines = [
    '---',
    'project: Demo',
    'id: demo-roadmap',
    'title: Demo Roadmap',
    'status: active',
    'created: 2026-04-23',
    'version: 0.1',
    'current_milestone: v1',
    '---',
    '',
    '# Demo Roadmap',
    '',
  ];
  for (const m of milestones) {
    lines.push(`## Milestone ${m.id}`, '', `**Version:** ${m.version}`, `**Name:** ${m.name}`, `**Goal:** ${m.goal}`, '');
    for (const p of (m.phases || [])) {
      lines.push(`### Phase ${p.id} — ${p.title}`, '', p.goal, '');
    }
  }
  return lines.join('\n');
}

function writeFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ROADMAP.md');
  fs.writeFileSync(p, baseRoadmap());
  return p;
}

function run(args, expectFail = false) {
  try {
    const out = execFileSync('node', [scriptPath, ...args], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, result: JSON.parse(out.trim()) };
  } catch (err) {
    if (!expectFail) throw err;
    return { code: err.status, result: JSON.parse((err.stdout || '').trim() || '{}') };
  }
}

// Test 1: CLI add-milestone
{
  const dir = mkTmpDir();
  const p = writeFixture(dir);
  const { code, result } = run([p, 'add-milestone', '--id=v2', '--version=0.2', '--name=Second', '--goal=Ship again', '--setCurrent=true']);
  assert.strictEqual(code, 0);
  assert.strictEqual(result.ok, true, result.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.milestones.length, 2);
  assert.strictEqual(after.frontmatter.current_milestone, 'v2');
  assert.strictEqual(after.frontmatter.version, '0.2');
  fs.rmSync(dir, { recursive: true });
}

// Test 2: CLI add-phase
{
  const dir = mkTmpDir();
  const p = writeFixture(dir);
  const { result } = run([p, 'add-phase', '--milestoneId=v1', '--id=v1.2', '--title=Second Phase', '--goal=More work']);
  assert.strictEqual(result.ok, true, result.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.milestones[0].phases.length, 2);
  assert.strictEqual(after.milestones[0].phases[1].id, 'v1.2');
  fs.rmSync(dir, { recursive: true });
}

// Test 3: CLI advance (happy path with 2 milestones)
{
  const dir = mkTmpDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ROADMAP.md');
  fs.writeFileSync(p, baseRoadmap({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: 'g1', phases: [] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [] },
    ],
  }));
  const { result } = run([p, 'advance']);
  assert.strictEqual(result.ok, true, result.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.frontmatter.current_milestone, 'v2');
  assert.strictEqual(after.frontmatter.version, '0.2');
  assert.notStrictEqual(after.milestones[0].shippedStatusLine, null);
  fs.rmSync(dir, { recursive: true });
}

// Test 4: CLI complete-phase
{
  const dir = mkTmpDir();
  const p = writeFixture(dir);
  const { result } = run([p, 'complete-phase', '--phaseId=v1.1']);
  assert.strictEqual(result.ok, true, result.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.notStrictEqual(after.milestones[0].phases[0].shippedStatusLine, null);
  fs.rmSync(dir, { recursive: true });
}

// Test 5: CLI bump-version
{
  const dir = mkTmpDir();
  const p = writeFixture(dir);
  const { result } = run([p, 'bump-version', '--newVersion=0.1.1']);
  assert.strictEqual(result.ok, true, result.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.frontmatter.version, '0.1.1');
  fs.rmSync(dir, { recursive: true });
}

// Test 6: CLI exits 1 on operation error with structured reason
{
  const dir = mkTmpDir();
  const p = writeFixture(dir);
  const before = fs.readFileSync(p, 'utf-8');
  const { code, result } = run([p, 'advance'], true); // no next milestone
  assert.strictEqual(code, 1);
  assert.strictEqual(result.ok, false);
  assert.ok(result.reason.includes('no next milestone'));
  // File unchanged
  assert.strictEqual(fs.readFileSync(p, 'utf-8'), before);
  fs.rmSync(dir, { recursive: true });
}

// Test 7: CLI exits 2 on unknown op name
{
  const dir = mkTmpDir();
  const p = writeFixture(dir);
  let threw = false;
  try {
    execFileSync('node', [scriptPath, p, 'unknown-op'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    threw = true;
    assert.strictEqual(err.status, 2);
    assert.ok(err.stderr.includes('usage'));
  }
  assert.ok(threw);
  fs.rmSync(dir, { recursive: true });
}

// Test 8: SKILL.md file sanity
{
  const skillPath = path.join(pluginRoot, 'skills', 'fsd-roadmap', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'fsd-roadmap SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/^---\s*\nname: fsd-roadmap/m.test(content), 'frontmatter must declare name: fsd-roadmap');
  // Mentions creation-path partner (for users hitting a missing ROADMAP.md)
  assert.ok(content.includes('/fsd-new-project'), 'skill must point users at /fsd-new-project for creation');
  // Lists all 5 op names
  for (const op of ['add-milestone', 'add-phase', 'advance', 'complete-phase', 'bump-version']) {
    assert.ok(content.includes(op), `skill must document the ${op} op`);
  }
  // Documents the refusal when ROADMAP.md is missing
  assert.ok(/ROADMAP\.md/.test(content));
  assert.ok(/missing|does not exist|not found/i.test(content),
    'skill must document the refuse-when-missing behavior');
}

console.log('  All fsd-roadmap integration tests passed');
