#!/usr/bin/env node
'use strict';

// Integration tests for the `/fsd:plan` skill (FSD-008).
// - Exercises scripts/plan.js's CLI entry point via execFileSync against a
//   throwaway fixture project that has a valid PROJECT.md + seeded specs.
// - Covers: happy-path, missing spec, archived spec, unapproved spec with/
//   without acknowledge flag, no spec link, usage error, architecture CLI
//   smoke.
// - Asserts SKILL.md sanity: name, argument-hint, six-step structure,
//   cross-references, ARCHITECTURE.md mechanics documented, spec-hard-require
//   + spec-status rules documented, Guardrails covers plan-mode boundary.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const planScript = path.join(pluginRoot, 'scripts', 'plan.js');
const archScript = path.join(pluginRoot, 'scripts', 'architecture.js');
const skillPath = path.join(pluginRoot, 'skills', 'plan', 'SKILL.md');

const { writeProjectFiles } = require(path.join(pluginRoot, 'scripts', 'new-project.js'));
const { writeSpecFile } = require(path.join(pluginRoot, 'scripts', 'spec.js'));
const { scanArtifacts } = require(path.join(pluginRoot, 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

function mkTmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-plan-cli-'));
  const planningDir = path.join(root, 'planning');
  const fsdDir = path.join(root, '.fsd');
  fs.mkdirSync(planningDir);
  fs.mkdirSync(fsdDir);
  fs.mkdirSync(path.join(fsdDir, 'spec'));
  fs.mkdirSync(path.join(fsdDir, 'plan'));
  writeProjectFiles({
    planningDir,
    projectData: { project: 'CliFix', id: 'cli-fix', title: 'CLI Fixture', vision: 'demo' },
    roadmapData: { project: 'CliFix', id: 'cli-fix-roadmap', title: 'Roadmap', version: '0.1', current_milestone: 'v1' },
  });
  return { root, fsdDir, planningDir };
}

function seedSpec({ fsdDir, planningDir, id, title, status = 'active', approved = true }) {
  const res = writeSpecFile({
    projectPath: fsdDir,
    planningDir,
    specData: { id, title, status, approved },
  });
  if (!res.ok) throw new Error(`seed spec failed: ${res.reason}`);
}

function runPlanCli(fsdDir, args) {
  try {
    const out = execFileSync('node', [planScript, fsdDir, ...args], {
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

function runArchCli(planningDir, opAndArgs) {
  try {
    const out = execFileSync('node', [archScript, planningDir, ...opAndArgs], {
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

// --- CLI happy path ---

// Test 1: CLI writes a plan when the spec hard-require is satisfied.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'auth', title: 'Auth' });
  const payload = path.join(planningDir, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({
    id: 'auth', title: 'Auth Plan', related: ['spec/auth'], task: 'FSD-042',
  }));
  const { code, result } = runPlanCli(fsdDir, ['--json=' + payload, '--planning-dir=' + planningDir]);
  assert.strictEqual(code, 0, JSON.stringify(result));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written.length, 1);
  // Scanner picks it up.
  const plans = scanArtifacts({ fsdDir, kind: 'plan', dirName: 'plan' });
  assert.strictEqual(plans.length, 1);
  assert.strictEqual(plans[0].validation.valid, true);
}

// Test 2: CLI refuses without a spec link.
{
  const { fsdDir, planningDir } = mkTmpProject();
  const { code, result } = runPlanCli(fsdDir, [
    '--id=no-spec', '--title=No Spec', '--planning-dir=' + planningDir,
  ]);
  assert.strictEqual(code, 1);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /hard-requires a spec linkage/);
}

// Test 3: CLI refuses when the linked spec file is missing.
{
  const { fsdDir, planningDir } = mkTmpProject();
  const { code, result } = runPlanCli(fsdDir, [
    '--id=ghost', '--title=Ghost', '--related=spec/ghost', '--planning-dir=' + planningDir,
  ]);
  assert.strictEqual(code, 1);
  assert.match(result.reason, /not found/);
}

// Test 4: CLI refuses when the linked spec is archived.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'dead', title: 'Dead', status: 'archived' });
  const { code, result } = runPlanCli(fsdDir, [
    '--id=dead-plan', '--title=Dead Plan', '--related=spec/dead', '--planning-dir=' + planningDir,
  ]);
  assert.strictEqual(code, 1);
  assert.match(result.reason, /archived/);
}

// Test 5: CLI refuses unapproved spec without the ack flag; succeeds with it.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'draft', title: 'Draft', approved: false });

  const refused = runPlanCli(fsdDir, [
    '--id=draft-plan', '--title=Draft Plan', '--related=spec/draft', '--planning-dir=' + planningDir,
  ]);
  assert.strictEqual(refused.code, 1);
  assert.match(refused.result.reason, /acknowledgeUnapproved/);

  const succeeded = runPlanCli(fsdDir, [
    '--id=draft-plan', '--title=Draft Plan', '--related=spec/draft',
    '--planning-dir=' + planningDir,
    '--acknowledge-unapproved',
  ]);
  assert.strictEqual(succeeded.code, 0, JSON.stringify(succeeded.result));
  assert.strictEqual(succeeded.result.ok, true);
  assert.ok(Array.isArray(succeeded.result.warnings) && succeeded.result.warnings.length > 0);
}

// Test 6: CLI usage error when projectPath is missing.
{
  try {
    execFileSync('node', [planScript], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected usage exit');
  } catch (err) {
    assert.strictEqual(err.status, 2);
    assert.match(err.stderr || '', /usage/);
  }
}

// --- architecture CLI smoke ---

// Test 7: architecture create via CLI, then append-decision, then append-to-section.
{
  const { planningDir } = mkTmpProject();
  const create = runArchCli(planningDir, ['create']);
  assert.strictEqual(create.code, 0, JSON.stringify(create.result));
  assert.strictEqual(create.result.ok, true);

  const append = runArchCli(planningDir, [
    'append-decision',
    '--title=Use tmp+rename',
    '--context=Concurrent readers',
    '--decision=Atomic writes',
    '--consequences=No partial files',
  ]);
  assert.strictEqual(append.code, 0, JSON.stringify(append.result));
  assert.strictEqual(append.result.ok, true);

  const stack = runArchCli(planningDir, [
    'append-to-section',
    '--section-id=stack',
    '--content=Node 20+, zero deps.',
  ]);
  assert.strictEqual(stack.code, 0);
  assert.strictEqual(stack.result.ok, true);

  const content = fs.readFileSync(path.join(planningDir, 'ARCHITECTURE.md'), 'utf-8');
  assert.match(content, /### \d{4}-\d{2}-\d{2} — Use tmp\+rename/);
  assert.ok(content.includes('Node 20+'));
}

// Test 8: architecture CLI usage error on unknown op.
{
  try {
    execFileSync('node', [archScript, '/tmp', 'not-an-op'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('expected usage exit');
  } catch (err) {
    assert.strictEqual(err.status, 2);
    assert.match(err.stderr || '', /usage/);
  }
}

// --- SKILL.md sanity ---

// Test 9: SKILL.md file exists with the right frontmatter.
{
  assert.ok(fs.existsSync(skillPath), 'SKILL.md must exist at plugin/skills/fsd:plan/SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf-8');
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'frontmatter must be present');
  const fm = parseYaml(m[1]);
  assert.strictEqual(fm.name, 'fsd:plan');
  assert.ok(fm.description && fm.description.length >= 20);
  assert.match(fm['argument-hint'] || '', /spec-id/);
}

// Test 10: SKILL.md documents all 6 steps.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  for (let i = 1; i <= 6; i++) {
    assert.ok(
      new RegExp(`Step ${i}`).test(content),
      `SKILL.md must document Step ${i}`,
    );
  }
}

// Test 11: SKILL.md invokes EnterPlanMode and ExitPlanMode.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/EnterPlanMode/.test(content), 'must reference EnterPlanMode');
  assert.ok(/ExitPlanMode/.test(content), 'must reference ExitPlanMode');
}

// Test 12: SKILL.md cross-references /fsd:spec and /fsd:execute-plan.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/\/fsd:spec/.test(content));
  assert.ok(/\/fsd:execute-plan/.test(content));
  assert.ok(/\/fsd:new-project/.test(content));
}

// Test 13: SKILL.md documents spec-hard-require and spec-status rules.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/hard-require/i.test(content));
  assert.ok(/archived/i.test(content));
  assert.ok(/unapproved/i.test(content));
}

// Test 14: SKILL.md documents ARCHITECTURE.md create + append mechanics.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/ARCHITECTURE\.md/.test(content));
  assert.ok(/append-decision/i.test(content));
  assert.ok(/append-to-section/i.test(content) || /appendToSection/i.test(content));
  // Lazy-create path is visibly called out.
  assert.ok(/lazy|Create it now/i.test(content));
}

// Test 15: SKILL.md Guardrails forbid writes-before-approval and dropping spec hard-require.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  const guardrails = content.match(/## Guardrails[\s\S]*$/);
  assert.ok(guardrails, 'Guardrails section must exist');
  const g = guardrails[0];
  assert.ok(/EnterPlanMode|plan mode/i.test(g));
  assert.ok(/ExitPlanMode|approval/i.test(g));
  assert.ok(/overwrite/i.test(g));
  assert.ok(/spec hard-require|spec.*hard/i.test(g));
  assert.ok(/PROJECT\.md/.test(g));
  assert.ok(/auto-commit/i.test(g));
}

// Test 16: SKILL.md references the six plan body sections.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  for (const heading of ['Context', 'Approach', 'Phases', 'Risks', 'Acceptance', 'Open questions']) {
    assert.ok(new RegExp(heading).test(content), `body section "${heading}" must be mentioned`);
  }
}

// --- Phase-checkbox contract + verification override (FSD-009) ---

// Test 17: SKILL.md Step 4 documents the phase checkbox convention.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/\- \[ \] \*\*Phase/.test(content),
    'SKILL.md must show the `- [ ] **Phase NN**` checkbox convention');
  assert.ok(/parsePhases/.test(content),
    'SKILL.md must name parsePhases as the parser for the convention');
  assert.ok(/two-digit/.test(content));
}

// Test 18: SKILL.md frontmatter interview includes the optional plan-level verification prompt.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/verification/i.test(content), 'SKILL.md must mention plan-level verification');
  assert.ok(/override/i.test(content), 'SKILL.md must frame it as a PROJECT.md override');
  assert.ok(/skip/i.test(content), 'SKILL.md must document the skip escape');
  assert.ok(/\/fsd:execute-plan/.test(content), 'SKILL.md must cross-reference the executor');
}

// Test 19: renderPlan emits the new phases placeholder verbatim (snapshot).
{
  const { renderPlan, SECTION_META } = require(path.join(pluginRoot, 'scripts', 'plan.js'));
  const out = renderPlan({ project: 'P', id: 'p', title: 'P', related: ['spec/x'] });
  const expected = SECTION_META.phases.placeholder;
  assert.ok(out.includes(expected), 'rendered plan body must include the phases placeholder');
  // Spot-check both phase lines.
  assert.ok(expected.includes('- [ ] **Phase 01** — _Phase title_'));
  assert.ok(expected.includes('- [ ] **Phase 02** — _..._'));
}

console.log('  All fsd-plan integration tests passed');
