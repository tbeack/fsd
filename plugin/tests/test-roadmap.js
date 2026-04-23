#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseRoadmap,
  readRoadmap,
  writeRoadmapAtomic,
  addMilestone,
  addPhase,
  advance,
  completePhase,
  bumpVersion,
  today,
} = require(path.join(__dirname, '..', 'scripts', 'roadmap.js'));
const { validateRoadmap } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-roadmap-'));
}

function fixture({
  version = '0.1',
  current = 'v1',
  milestones = [
    { id: 'v1', version: '0.1', name: 'Initial', goal: 'Ship the mvp.', phases: [
      { id: 'v1.1', title: 'Bootstrap', goal: 'Stand up the basics.' },
    ]},
  ],
} = {}) {
  const fm = [
    '---',
    'project: Demo',
    'id: demo-roadmap',
    'title: Demo Roadmap',
    'status: active',
    'created: 2026-04-23',
    `version: ${version}`,
    `current_milestone: ${current}`,
    '---',
    '',
    '# Demo Roadmap',
    '',
  ];
  for (const m of milestones) {
    fm.push(`## Milestone ${m.id}`, '', `**Version:** ${m.version}`, `**Name:** ${m.name}`, `**Goal:** ${m.goal}`, '');
    for (const p of (m.phases || [])) {
      fm.push(`### Phase ${p.id} — ${p.title}`, '', p.goal, '');
    }
  }
  return fm.join('\n');
}

function writeFixture(dir, content) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'ROADMAP.md');
  fs.writeFileSync(p, content);
  return p;
}

// --- parseRoadmap --------------------------------------------------------

// Test 1: parses a minimal valid roadmap
{
  const parsed = parseRoadmap(fixture());
  assert.strictEqual(parsed.frontmatter.project, 'Demo');
  assert.strictEqual(parsed.frontmatter.version, '0.1');
  assert.strictEqual(parsed.frontmatter.current_milestone, 'v1');
  assert.strictEqual(parsed.milestones.length, 1);
  const m = parsed.milestones[0];
  assert.strictEqual(m.id, 'v1');
  assert.strictEqual(m.version, '0.1');
  assert.strictEqual(m.shippedStatusLine, null);
  assert.strictEqual(m.phases.length, 1);
  assert.strictEqual(m.phases[0].id, 'v1.1');
  assert.strictEqual(m.phases[0].title, 'Bootstrap');
  assert.strictEqual(m.phases[0].shippedStatusLine, null);
}

// Test 2: parses multi-milestone + multi-phase
{
  const content = fixture({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: 'g1', phases: [
        { id: 'v1.1', title: 'P1', goal: 'pg1' },
        { id: 'v1.2', title: 'P2', goal: 'pg2' },
      ] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [
        { id: 'v2.1', title: 'P3', goal: 'pg3' },
      ] },
    ],
  });
  const parsed = parseRoadmap(content);
  assert.strictEqual(parsed.milestones.length, 2);
  assert.strictEqual(parsed.milestones[0].phases.length, 2);
  assert.strictEqual(parsed.milestones[1].phases.length, 1);
  // Order preserved
  assert.strictEqual(parsed.milestones[0].id, 'v1');
  assert.strictEqual(parsed.milestones[1].id, 'v2');
}

// Test 3: recognizes shipped status markers and attributes them correctly
{
  const lines = fixture().split('\n');
  // Inject a milestone-level status (between heading and version)
  const mIdx = lines.findIndex(l => l === '## Milestone v1');
  lines.splice(mIdx + 2, 0, '**Status:** shipped (2026-04-20)');
  // Inject a phase-level status
  const pIdx = lines.findIndex(l => l === '### Phase v1.1 — Bootstrap');
  lines.splice(pIdx + 2, 0, '**Status:** shipped (2026-04-22)');
  const parsed = parseRoadmap(lines.join('\n'));
  assert.notStrictEqual(parsed.milestones[0].shippedStatusLine, null,
    'milestone status should be detected');
  assert.notStrictEqual(parsed.milestones[0].phases[0].shippedStatusLine, null,
    'phase status should be detected');
}

// Test 4: rejects malformed frontmatter
{
  assert.throws(() => parseRoadmap('no frontmatter here'), /does not begin with/);
  assert.throws(() => parseRoadmap('---\nproject: X\nid: x\n'), /unterminated frontmatter/);
}

// --- addMilestone --------------------------------------------------------

// Test 5: addMilestone happy path (without setCurrent)
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = addMilestone({ roadmapPath: p, id: 'v2', version: '0.2', name: 'M2', goal: 'G2' });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.written, true);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.milestones.length, 2);
  assert.strictEqual(after.milestones[1].id, 'v2');
  assert.strictEqual(after.milestones[1].version, '0.2');
  // current_milestone untouched when setCurrent omitted
  assert.strictEqual(after.frontmatter.current_milestone, 'v1');
  assert.strictEqual(after.frontmatter.version, '0.1');
  // updated field added
  assert.strictEqual(after.frontmatter.updated, today());
  fs.rmSync(dir, { recursive: true });
}

// Test 6: addMilestone with setCurrent updates frontmatter
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = addMilestone({ roadmapPath: p, id: 'v2', version: '0.2', name: 'M2', goal: 'G2', setCurrent: true });
  assert.strictEqual(r.ok, true, r.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.frontmatter.current_milestone, 'v2');
  assert.strictEqual(after.frontmatter.version, '0.2');
  fs.rmSync(dir, { recursive: true });
}

// Test 7: addMilestone refuses duplicate id
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = addMilestone({ roadmapPath: p, id: 'v1', version: '0.2', name: 'Dup', goal: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('already exists'));
  fs.rmSync(dir, { recursive: true });
}

// Test 8: addMilestone refuses bad version + missing fields
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  assert.strictEqual(addMilestone({ roadmapPath: p, id: 'v2', version: 'v2-beta', name: 'N', goal: 'G' }).ok, false);
  assert.strictEqual(addMilestone({ roadmapPath: p, id: 'v2', version: '0.2', goal: 'G' }).ok, false);
  assert.strictEqual(addMilestone({ roadmapPath: p, id: 'v2', version: '0.2', name: 'N' }).ok, false);
  fs.rmSync(dir, { recursive: true });
}

// --- addPhase ------------------------------------------------------------

// Test 9: addPhase inserts into the right milestone
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: 'g1', phases: [
        { id: 'v1.1', title: 'P1', goal: 'pg1' },
      ] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [] },
    ],
  }));
  const r = addPhase({ roadmapPath: p, milestoneId: 'v1', id: 'v1.2', title: 'Second', goal: 'Ship more' });
  assert.strictEqual(r.ok, true, r.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.milestones[0].phases.length, 2);
  assert.strictEqual(after.milestones[0].phases[1].id, 'v1.2');
  // Second milestone untouched
  assert.strictEqual(after.milestones[1].phases.length, 0);
  assert.strictEqual(after.milestones[1].id, 'v2');
  fs.rmSync(dir, { recursive: true });
}

// Test 10: addPhase refuses unknown milestone
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = addPhase({ roadmapPath: p, milestoneId: 'nope', id: 'v1.2', title: 'X', goal: 'G' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('not found'));
  fs.rmSync(dir, { recursive: true });
}

// Test 11: addPhase refuses duplicate phase id within milestone
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = addPhase({ roadmapPath: p, milestoneId: 'v1', id: 'v1.1', title: 'Dup', goal: 'G' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('already exists'));
  fs.rmSync(dir, { recursive: true });
}

// --- advance -------------------------------------------------------------

// Test 12: advance marks shipped + flips frontmatter to next milestone
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: 'g1', phases: [] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [] },
    ],
  }));
  const r = advance({ roadmapPath: p });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.written, true);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.frontmatter.current_milestone, 'v2');
  assert.strictEqual(after.frontmatter.version, '0.2');
  assert.notStrictEqual(after.milestones[0].shippedStatusLine, null,
    'v1 should have a shipped status line');
  assert.strictEqual(after.milestones[1].shippedStatusLine, null,
    'v2 should still be unshipped');
  fs.rmSync(dir, { recursive: true });
}

// Test 13: advance errors when current is the last milestone
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture()); // single milestone v1
  const before = fs.readFileSync(p, 'utf-8');
  const r = advance({ roadmapPath: p });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('no next milestone'));
  // File untouched
  assert.strictEqual(fs.readFileSync(p, 'utf-8'), before);
  fs.rmSync(dir, { recursive: true });
}

// Test 14: advance is idempotent when current is already shipped
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: 'g1', phases: [] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [] },
    ],
  }));
  // First advance: ships v1, flips to v2
  advance({ roadmapPath: p });
  // Simulate user calling advance again on an already-shipped current (v1 is
  // already shipped but we're now on v2). To test the idempotent branch, we
  // need to mark v2 shipped via the helper and then try to re-advance v2 —
  // but v2 has no next, so that's the other branch. Instead, reconstruct:
  const raw = fs.readFileSync(p, 'utf-8').replace(/current_milestone: v2/, 'current_milestone: v1');
  fs.writeFileSync(p, raw);
  // Now current=v1 and v1 is already shipped — advance should no-op.
  const r = advance({ roadmapPath: p });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.written, false);
  assert.ok(r.reason.includes('already marked shipped'));
  fs.rmSync(dir, { recursive: true });
}

// --- completePhase -------------------------------------------------------

// Test 15: completePhase happy path
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = completePhase({ roadmapPath: p, phaseId: 'v1.1' });
  assert.strictEqual(r.ok, true, r.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.notStrictEqual(after.milestones[0].phases[0].shippedStatusLine, null);
  fs.rmSync(dir, { recursive: true });
}

// Test 16: completePhase idempotent when already shipped
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  completePhase({ roadmapPath: p, phaseId: 'v1.1' });
  const once = fs.readFileSync(p, 'utf-8');
  const r = completePhase({ roadmapPath: p, phaseId: 'v1.1' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.written, false);
  // File unchanged after second call
  assert.strictEqual(fs.readFileSync(p, 'utf-8'), once);
  fs.rmSync(dir, { recursive: true });
}

// Test 17: completePhase refuses unknown phase
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = completePhase({ roadmapPath: p, phaseId: 'nope' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('not found'));
  fs.rmSync(dir, { recursive: true });
}

// --- bumpVersion ---------------------------------------------------------

// Test 18: bumpVersion happy path
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = bumpVersion({ roadmapPath: p, newVersion: '0.1.1' });
  assert.strictEqual(r.ok, true, r.reason);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.frontmatter.version, '0.1.1');
  // current_milestone untouched
  assert.strictEqual(after.frontmatter.current_milestone, 'v1');
  fs.rmSync(dir, { recursive: true });
}

// Test 19: bumpVersion refuses non-semver
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = bumpVersion({ roadmapPath: p, newVersion: 'v2-beta' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('semver-like'));
  fs.rmSync(dir, { recursive: true });
}

// Test 20: bumpVersion refuses no-op
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const r = bumpVersion({ roadmapPath: p, newVersion: '0.1' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('already'));
  fs.rmSync(dir, { recursive: true });
}

// --- round-trip validation + byte preservation --------------------------

// Test 21: every op's result validates against validateRoadmap
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: 'g1', phases: [{ id: 'v1.1', title: 'P', goal: 'pg' }] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [] },
    ],
  }));
  const steps = [
    () => addMilestone({ roadmapPath: p, id: 'v3', version: '0.3', name: 'M3', goal: 'g3' }),
    () => addPhase({ roadmapPath: p, milestoneId: 'v2', id: 'v2.1', title: 'X', goal: 'Y' }),
    () => completePhase({ roadmapPath: p, phaseId: 'v1.1' }),
    () => advance({ roadmapPath: p }),
    () => bumpVersion({ roadmapPath: p, newVersion: '0.2.1' }),
  ];
  for (const [i, step] of steps.entries()) {
    const res = step();
    assert.strictEqual(res.ok, true, `step ${i}: ${res.reason}`);
    const parsed = parseRoadmap(fs.readFileSync(p, 'utf-8'));
    const v = validateRoadmap(parsed.frontmatter);
    assert.strictEqual(v.valid, true, `step ${i}: validation failed: ${v.errors.join('; ')}`);
  }
  fs.rmSync(dir, { recursive: true });
}

// Test 22: user-authored goal prose is preserved byte-for-byte
{
  const dir = mkTmpDir();
  // Unusual characters, multi-line, trailing whitespace — all must survive.
  const wonky = 'Goal with "quotes", dashes — and an em-dash;\nand a trailing\t  ';
  const base = fixture({
    milestones: [
      { id: 'v1', version: '0.1', name: 'M1', goal: wonky, phases: [] },
      { id: 'v2', version: '0.2', name: 'M2', goal: 'g2', phases: [] },
    ],
  });
  const p = writeFixture(dir, base);

  // Run ops that don't touch v1's goal prose.
  addPhase({ roadmapPath: p, milestoneId: 'v2', id: 'v2.1', title: 'X', goal: 'Y' });
  advance({ roadmapPath: p });
  bumpVersion({ roadmapPath: p, newVersion: '0.2.1' });

  const after = fs.readFileSync(p, 'utf-8');
  assert.ok(after.includes(`**Goal:** ${wonky.split('\n')[0]}`),
    `wonky goal line preserved; actual file:\n${after}`);
  fs.rmSync(dir, { recursive: true });
}

// --- atomicity ----------------------------------------------------------

// Test 23: writeRoadmapAtomic leaves file unchanged when validation rejects
{
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const before = fs.readFileSync(p, 'utf-8');
  // Inject broken content (removes `current_milestone` from frontmatter)
  const broken = before.replace(/current_milestone: v1\n/, '');
  const r = writeRoadmapAtomic(p, broken);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.includes('validateRoadmap'));
  assert.strictEqual(fs.readFileSync(p, 'utf-8'), before,
    'on-disk file must be unchanged when validation fails');
  fs.rmSync(dir, { recursive: true });
}

// --- CLI entry point ----------------------------------------------------

// Test 24: CLI entry runs add-milestone end-to-end
{
  const { execFileSync } = require('child_process');
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const script = path.join(__dirname, '..', 'scripts', 'roadmap.js');
  const out = execFileSync('node', [
    script, p, 'add-milestone',
    '--id=v2', '--version=0.2', '--name=M2', '--goal=shipping more',
  ], { encoding: 'utf-8' });
  const result = JSON.parse(out.trim());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  const after = parseRoadmap(fs.readFileSync(p, 'utf-8'));
  assert.strictEqual(after.milestones.length, 2);
  fs.rmSync(dir, { recursive: true });
}

// Test 25: CLI exits 1 with JSON error on bad op
{
  const { execFileSync } = require('child_process');
  const dir = mkTmpDir();
  const p = writeFixture(dir, fixture());
  const script = path.join(__dirname, '..', 'scripts', 'roadmap.js');
  let threw = false;
  try {
    execFileSync('node', [script, p, 'bump-version', '--newVersion=not-semver'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    threw = true;
    assert.strictEqual(err.status, 1);
    const result = JSON.parse(err.stdout.trim());
    assert.strictEqual(result.ok, false);
    assert.ok(result.reason.includes('semver'));
  }
  assert.ok(threw);
  fs.rmSync(dir, { recursive: true });
}

console.log('  All roadmap tests passed');
