#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  validateSpec,
  validatePlan,
  validateResearch,
  ARTIFACT_STATUSES,
  ARTIFACT_VALIDATORS,
  KEBAB_CASE,
  ISO_DATE,
  CROSS_REF,
  URL_PATTERN,
} = require(path.join(__dirname, '..', 'scripts', 'validator.js'));

// --- Exports / constants sanity ---

// Test 1: Public exports present and shaped correctly
{
  assert.strictEqual(typeof validateSpec, 'function');
  assert.strictEqual(typeof validatePlan, 'function');
  assert.strictEqual(typeof validateResearch, 'function');
  assert.deepStrictEqual(ARTIFACT_STATUSES, ['draft', 'active', 'archived']);
  assert.strictEqual(ARTIFACT_VALIDATORS.spec, validateSpec);
  assert.strictEqual(ARTIFACT_VALIDATORS.plan, validatePlan);
  assert.strictEqual(ARTIFACT_VALIDATORS.research, validateResearch);
  assert.ok(KEBAB_CASE.test('auth-v2'));
  assert.ok(!KEBAB_CASE.test('Auth-V2'));
  assert.ok(ISO_DATE.test('2026-04-22'));
  assert.ok(!ISO_DATE.test('2026/04/22'));
  assert.ok(CROSS_REF.test('plan/auth-v2-migration'));
  assert.ok(!CROSS_REF.test('docs/foo'));
  assert.ok(URL_PATTERN.test('https://example.com/x'));
  assert.ok(!URL_PATTERN.test('example.com'));
}

const minimal = (over = {}) => ({
  project: 'My Project',
  id: 'auth-v2',
  title: 'Auth v2',
  status: 'draft',
  created: '2026-04-22',
  ...over,
});

// --- Common-field validation (shared by all three kinds) ---

// Test 2: Valid minimal artifact passes for each kind
for (const v of [validateSpec, validatePlan, validateResearch]) {
  const r = v(minimal());
  assert.strictEqual(r.valid, true, `expected valid; got ${r.errors.join('; ')}`);
  assert.deepStrictEqual(r.errors, []);
}

// Test 3: Missing each required field produces a specific error
for (const v of [validateSpec, validatePlan, validateResearch]) {
  for (const field of ['project', 'id', 'title', 'status', 'created']) {
    const meta = minimal();
    delete meta[field];
    const r = v(meta);
    assert.strictEqual(r.valid, false);
    assert.ok(
      r.errors.some(e => e.startsWith(`${field}:`)),
      `missing ${field} should produce a "${field}:" error; got ${r.errors.join('; ')}`,
    );
  }
}

// Test 4: project preserves human casing/whitespace (no format constraint beyond non-empty)
{
  const r = validateSpec(minimal({ project: 'Acme Platform — Payments' }));
  assert.strictEqual(r.valid, true);
}

// Test 5: project empty string rejected
{
  const r = validateSpec(minimal({ project: '' }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('project:')));
}

// Test 6: Invalid status rejected with message naming valid values
{
  const r = validateSpec(minimal({ status: 'wip' }));
  assert.strictEqual(r.valid, false);
  const msg = r.errors.find(e => e.startsWith('status:'));
  assert.ok(msg);
  for (const s of ARTIFACT_STATUSES) assert.ok(msg.includes(s));
}

// Test 7: created bad format rejected
{
  const r = validateSpec(minimal({ created: '2026/04/22' }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('created:')));
}

// Test 8: updated optional but format-checked when present
{
  const ok = validateSpec(minimal({ updated: '2026-04-23' }));
  assert.strictEqual(ok.valid, true);
  const bad = validateSpec(minimal({ updated: 'tomorrow' }));
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.errors.some(e => e.startsWith('updated:')));
}

// Test 9: Non-kebab-case id rejected
{
  const r = validateSpec(minimal({ id: 'AuthV2' }));
  assert.strictEqual(r.valid, false);
  const msg = r.errors.find(e => e.startsWith('id:'));
  assert.ok(msg && msg.includes('kebab-case'));
}

// Test 10: tags validated as kebab-case array
{
  const ok = validateSpec(minimal({ tags: ['auth', 'security-v2'] }));
  assert.strictEqual(ok.valid, true);
  const bad = validateSpec(minimal({ tags: ['Auth', 'SECURITY'] }));
  assert.strictEqual(bad.valid, false);
  assert.ok(bad.errors.some(e => e.startsWith('tags:')));
}

// Test 11: related cross-refs validated; bad kind / bad id / missing prefix all fail
{
  const ok = validateSpec(minimal({ related: ['plan/auth-v2-migration', 'research/threat-model'] }));
  assert.strictEqual(ok.valid, true);
  for (const ref of ['docs/foo', 'plan/Auth-V2', 'just-an-id']) {
    const r = validateSpec(minimal({ related: [ref] }));
    assert.strictEqual(r.valid, false, `expected invalid for ref="${ref}"`);
    assert.ok(r.errors.some(e => e.startsWith('related:')));
  }
}

// Test 12: Unknown frontmatter keys are passed through (lenient — matches existing skill/agent behavior)
{
  const r = validateSpec(minimal({ random_extra_field: 'whatever', another_one: 42 }));
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(r.errors, []);
}

// --- Spec-specific ---

// Test 13: Valid full spec
{
  const r = validateSpec(minimal({
    updated: '2026-04-23',
    tags: ['auth', 'v2'],
    related: ['plan/auth-v2-migration'],
    approved: true,
    supersedes: ['auth-v1'],
  }));
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 14: spec.approved as YAML-parsed string accepted
{
  for (const v of ['true', 'false']) {
    const r = validateSpec(minimal({ approved: v }));
    assert.strictEqual(r.valid, true, `string "${v}" should be accepted as boolean-ish`);
  }
}

// Test 15: spec.approved non-bool rejected
{
  const r = validateSpec(minimal({ approved: 'maybe' }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('approved:')));
}

// Test 16: spec.supersedes with bad id rejected
{
  const r = validateSpec(minimal({ supersedes: ['Auth-V1'] }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('supersedes:')));
}

// --- Plan-specific ---

// Test 17: Valid full plan
{
  const r = validatePlan(minimal({
    task: 'FSD-004',
    depends_on: ['fsd-013-storage-kinds'],
    estimate: '~2 days',
  }));
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 18: plan.depends_on with bad id rejected
{
  const r = validatePlan(minimal({ depends_on: ['Bad ID'] }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('depends_on:')));
}

// Test 19: plan.task and plan.estimate are non-empty strings if present
{
  const a = validatePlan(minimal({ task: '' }));
  assert.strictEqual(a.valid, false);
  assert.ok(a.errors.some(e => e.startsWith('task:')));

  const b = validatePlan(minimal({ estimate: '' }));
  assert.strictEqual(b.valid, false);
  assert.ok(b.errors.some(e => e.startsWith('estimate:')));
}

// Test 19a: plan.supersedes with valid kebab-case ids accepted
{
  const r = validatePlan(minimal({ supersedes: ['auth-v1', 'session-legacy'] }));
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 19b: plan.supersedes with non-kebab id rejected
{
  const r = validatePlan(minimal({ supersedes: ['Auth-V1'] }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('supersedes:')));
}

// --- Research-specific ---

// Test 20: Valid full research
{
  const r = validateResearch(minimal({
    sources: ['https://example.com/a', 'http://example.org/b'],
    conclusion: 'Use approach X because Y.',
  }));
  assert.strictEqual(r.valid, true, r.errors.join('; '));
}

// Test 21: research.sources non-URL rejected
{
  const r = validateResearch(minimal({ sources: ['example.com', 'ftp://nope'] }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('sources:')));
}

// Test 22: research.conclusion empty string rejected when present
{
  const r = validateResearch(minimal({ conclusion: '' }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.startsWith('conclusion:')));
}

// --- Integration test: /fsd:validate --artifacts end-to-end ---

function mkTmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-artifacts-'));
  const fsdDir = path.join(root, '.fsd');
  for (const k of ['spec', 'plan', 'research']) {
    fs.mkdirSync(path.join(fsdDir, k), { recursive: true });
    fs.writeFileSync(path.join(fsdDir, k, '.gitkeep'), '');
  }
  return { root, fsdDir };
}

function writeArtifact(fsdDir, kind, stem, body) {
  fs.writeFileSync(path.join(fsdDir, kind, `${stem}.md`), body);
}

function runValidate(cwd, args = []) {
  const script = path.join(__dirname, '..', 'scripts', 'validate.js');
  // Pass plugin root as argv[2] so the loader uses the real plugin's scannable
  // content; cwd controls where .fsd/ is found for artifact scanning.
  const pluginRoot = path.resolve(__dirname, '..');
  try {
    const out = execFileSync('node', [script, pluginRoot, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout: out, code: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status };
  }
}

// Test 23: Empty .fsd/ artifact dirs yield zero counts and exit 0
{
  const { root } = mkTmpProject();
  const r = runValidate(root, ['--artifacts']);
  assert.strictEqual(r.code, 0, r.stdout);
  assert.ok(r.stdout.includes('SPECS (0 checked)'));
  assert.ok(r.stdout.includes('PLANS (0 checked)'));
  assert.ok(r.stdout.includes('RESEARCH (0 checked)'));
  fs.rmSync(root, { recursive: true });
}

// Test 24: Mixed valid + invalid across all kinds; exit 1 with specific err lines
{
  const { root, fsdDir } = mkTmpProject();
  writeArtifact(fsdDir, 'spec', 'good-one',
    `---\nproject: T\nid: good-one\ntitle: Good\nstatus: draft\ncreated: 2026-04-22\n---\n`);
  writeArtifact(fsdDir, 'spec', 'bad-status',
    `---\nproject: T\nid: bad-status\ntitle: Bad\nstatus: nope\ncreated: 2026-04-22\n---\n`);
  writeArtifact(fsdDir, 'plan', 'good-plan',
    `---\nproject: T\nid: good-plan\ntitle: Plan\nstatus: active\ncreated: 2026-04-22\n---\n`);
  writeArtifact(fsdDir, 'research', 'mismatched',
    `---\nproject: T\nid: actually-different\ntitle: R\nstatus: draft\ncreated: 2026-04-22\n---\n`);

  const r = runValidate(root, ['--artifacts']);
  assert.strictEqual(r.code, 1, `expected exit 1; got stdout=${r.stdout}`);
  assert.ok(r.stdout.includes('ok    good-one'));
  assert.ok(r.stdout.includes('ERR   bad-status'));
  assert.ok(r.stdout.includes('ok    good-plan'));
  // Mismatch error references the filename stem
  assert.ok(/ERR.*actually-different/.test(r.stdout) || r.stdout.includes('does not match filename stem "mismatched"'),
    `expected mismatch error; got: ${r.stdout}`);
  fs.rmSync(root, { recursive: true });
}

// Test 25: Narrow filter --specs only inspects specs
{
  const { root, fsdDir } = mkTmpProject();
  writeArtifact(fsdDir, 'plan', 'broken',
    `---\nproject: T\nid: broken\ntitle: B\nstatus: weird\ncreated: 2026-04-22\n---\n`);
  // --specs should ignore the broken plan → exit 0
  const r = runValidate(root, ['--specs']);
  assert.strictEqual(r.code, 0, `--specs should ignore plans; got stdout=${r.stdout}`);
  assert.ok(r.stdout.includes('SPECS (0 checked)'));
  assert.ok(!r.stdout.includes('PLANS'));
  fs.rmSync(root, { recursive: true });
}

// Test 26: No-flag invocation does NOT scan artifacts (session-start cost preserved)
{
  const { root, fsdDir } = mkTmpProject();
  writeArtifact(fsdDir, 'spec', 'broken',
    `---\nproject: T\nid: broken\ntitle: B\nstatus: weird\ncreated: 2026-04-22\n---\n`);
  const r = runValidate(root, []);
  assert.strictEqual(r.code, 0, 'no-flag run must not scan artifacts');
  assert.ok(!r.stdout.includes('SPECS'));
  fs.rmSync(root, { recursive: true });
}

console.log('  All artifact-validator tests passed');
