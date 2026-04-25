#!/usr/bin/env node
'use strict';

// Unit + integration tests for the plan authoring backing module (FSD-008).
// Covers: renderPlan (minimal / full / placeholder preservation);
// resolvePlanPath (default + config override); writePlanFile (happy path,
// refuse-to-overwrite, pre-validation failure, PROJECT.md auto-injection,
// config.structure.plan override); spec-hard-require (no related, empty
// spec link, missing spec, archived spec, unapproved spec without ack,
// unapproved spec WITH ack); checkSpecPrecondition branches; round-trip
// via scanArtifacts.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  renderPlan,
  writePlanFile,
  resolvePlanPath,
  checkSpecPrecondition,
  checkPlanPrecondition,
  today,
  SECTION_ORDER,
  SECTION_META,
} = require(path.join(__dirname, '..', 'scripts', 'plan.js'));
const { archive: archivePlan } = require(path.join(__dirname, '..', 'scripts', 'plan-update.js'));
const { validatePlan } = require(path.join(__dirname, '..', 'scripts', 'validator.js'));
const { scanArtifacts } = require(path.join(__dirname, '..', 'scripts', 'loader.js'));
const { parseYaml } = require(path.join(__dirname, '..', 'scripts', 'yaml-parser.js'));
const { writeSpecFile } = require(path.join(__dirname, '..', 'scripts', 'spec.js'));
const { writeProjectFiles } = require(path.join(__dirname, '..', 'scripts', 'new-project.js'));

function mkTmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-plan-'));
  const planningDir = path.join(root, 'planning');
  const fsdDir = path.join(root, '.fsd');
  fs.mkdirSync(planningDir);
  fs.mkdirSync(fsdDir);
  fs.mkdirSync(path.join(fsdDir, 'spec'));
  fs.mkdirSync(path.join(fsdDir, 'plan'));
  writeProjectFiles({
    planningDir,
    projectData: { project: 'PlanProj', id: 'plan-proj', title: 'Plan Proj', vision: 'demo' },
    roadmapData: { project: 'PlanProj', id: 'plan-proj-roadmap', title: 'Roadmap', version: '0.1', current_milestone: 'v1' },
  });
  return { root, planningDir, fsdDir };
}

function seedSpec({ fsdDir, planningDir, id, title, status = 'active', approved = true }) {
  writeSpecFile({
    projectPath: fsdDir,
    planningDir,
    specData: { id, title, status, approved },
  });
}

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  return parseYaml(m[1]);
}

// --- Exports + constants ---

// Test 1: module exports and section constants are correct.
{
  assert.strictEqual(typeof renderPlan, 'function');
  assert.strictEqual(typeof writePlanFile, 'function');
  assert.strictEqual(typeof resolvePlanPath, 'function');
  assert.strictEqual(typeof checkSpecPrecondition, 'function');
  assert.deepStrictEqual(SECTION_ORDER, [
    'context', 'approach', 'phases', 'risks', 'acceptance', 'open_questions',
  ]);
  for (const id of SECTION_ORDER) {
    assert.ok(SECTION_META[id], `SECTION_META must include ${id}`);
    assert.strictEqual(typeof SECTION_META[id].heading, 'string');
    assert.strictEqual(typeof SECTION_META[id].placeholder, 'string');
  }
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
}

// --- renderPlan ---

// Test 2: minimal data produces a full 6-section doc with placeholders.
{
  const out = renderPlan({ project: 'PlanProj', id: 'user-auth', title: 'User Auth', related: ['spec/user-auth'] });
  const fm = extractFrontmatter(out);
  const v = validatePlan(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  assert.strictEqual(fm.status, 'draft');
  assert.deepStrictEqual(fm.related, ['spec/user-auth']);
  for (const id of SECTION_ORDER) {
    assert.ok(out.includes(`## ${SECTION_META[id].heading}`));
    assert.ok(out.includes(SECTION_META[id].placeholder));
  }
}

// Test 3: user-provided section content replaces placeholders.
{
  const out = renderPlan({
    project: 'PlanProj', id: 'p', title: 'P',
    related: ['spec/foo'],
    sections: { approach: 'Use TDD.' },
  });
  assert.ok(out.includes('Use TDD.'));
  assert.ok(!out.includes(SECTION_META.approach.placeholder));
  assert.ok(out.includes(SECTION_META.context.placeholder)); // skipped → placeholder stays
}

// Test 4: optional fields (task, depends_on, estimate, tags) serialize only when set.
{
  const minimal = renderPlan({ project: 'PP', id: 'p', title: 'P', related: ['spec/x'] });
  assert.ok(!minimal.includes('task:'));
  assert.ok(!minimal.includes('depends_on:'));
  assert.ok(!minimal.includes('estimate:'));

  const full = renderPlan({
    project: 'PP', id: 'p', title: 'P',
    related: ['spec/x'],
    task: 'FSD-099',
    depends_on: ['other-plan'],
    estimate: '~2 days',
    tags: ['auth'],
  });
  assert.ok(full.includes('task: FSD-099'));
  assert.ok(full.includes('depends_on:'));
  assert.ok(full.includes('  - other-plan'));
  assert.ok(full.includes('estimate: ~2 days'));
  assert.ok(full.includes('tags:'));
}

// --- resolvePlanPath ---

// Test 5: default resolves to <projectPath>/plan/<id>.md.
{
  const p = resolvePlanPath({ projectPath: '/tmp/proj', id: 'foo' });
  assert.strictEqual(p, path.join('/tmp/proj', 'plan', 'foo.md'));
}

// Test 6: config.structure.plan override is honored.
{
  const p = resolvePlanPath({
    projectPath: '/tmp/proj',
    config: { structure: { plan: 'plans' } },
    id: 'foo',
  });
  assert.strictEqual(p, path.join('/tmp/proj', 'plans', 'foo.md'));
}

// --- checkSpecPrecondition ---

// Test 7: missing spec → ok: false.
{
  const { fsdDir } = mkTmpProject();
  const res = checkSpecPrecondition({ fsdDir, specId: 'nope' });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /not found/);
}

// Test 8: archived spec → ok: false with archived flag.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'old', title: 'Old', status: 'archived' });
  const res = checkSpecPrecondition({ fsdDir, specId: 'old' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.archived, true);
  assert.match(res.reason, /archived/);
}

// Test 9: active + approved spec → ok: true, no warnings.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'good', title: 'Good', approved: true });
  const res = checkSpecPrecondition({ fsdDir, specId: 'good' });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.warnings, []);
}

// Test 10: active + unapproved spec → ok: true, non-empty warnings.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'draft', title: 'Draft', approved: false });
  const res = checkSpecPrecondition({ fsdDir, specId: 'draft' });
  assert.strictEqual(res.ok, true);
  assert.ok(res.warnings.length > 0);
  assert.match(res.warnings[0], /approved: false/);
}

// --- writePlanFile happy path ---

// Test 11: writes to <fsdDir>/<structure.plan>/<id>.md with auto-injected project.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'auth', title: 'Auth' });

  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'auth', title: 'Auth Plan', related: ['spec/auth'] },
  });
  assert.strictEqual(res.ok, true, res.reason);
  const target = path.join(fsdDir, 'plan', 'auth.md');
  assert.deepStrictEqual(res.written, [target]);
  const fm = extractFrontmatter(fs.readFileSync(target, 'utf-8'));
  assert.strictEqual(fm.project, 'PlanProj'); // auto-injected
  assert.deepStrictEqual(fm.related, ['spec/auth']);
}

// Test 12: config.structure.plan override routes the write correctly.
{
  const { fsdDir, planningDir } = mkTmpProject();
  fs.mkdirSync(path.join(fsdDir, 'plans'));
  seedSpec({ fsdDir, planningDir, id: 'auth', title: 'Auth' });

  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    config: { structure: { plan: 'plans' } },
    planData: { id: 'auth', title: 'Auth Plan', related: ['spec/auth'] },
  });
  assert.strictEqual(res.ok, true, res.reason);
  assert.ok(fs.existsSync(path.join(fsdDir, 'plans', 'auth.md')));
  assert.ok(!fs.existsSync(path.join(fsdDir, 'plan', 'auth.md')));
}

// Test 13: refuses to overwrite — existing file byte-preserved.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'auth', title: 'Auth' });
  writePlanFile({ projectPath: fsdDir, planningDir, planData: { id: 'auth', title: 'Auth', related: ['spec/auth'] } });
  const target = path.join(fsdDir, 'plan', 'auth.md');
  const before = fs.readFileSync(target, 'utf-8');

  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'auth', title: 'Different', related: ['spec/auth'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /refusing to overwrite/);
  assert.strictEqual(fs.readFileSync(target, 'utf-8'), before);
}

// Test 14: pre-validation failure on bad id — file not written.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'auth', title: 'Auth' });
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'Not_Kebab', title: 'X', related: ['spec/auth'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /invalid frontmatter/i);
  assert.ok(!fs.existsSync(path.join(fsdDir, 'plan', 'Not_Kebab.md')));
}

// Test 15: missing PROJECT.md when auto-injecting → refuse.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-plan-nopkg-'));
  const fsdDir = path.join(root, '.fsd');
  const planningDir = path.join(root, 'planning');
  fs.mkdirSync(fsdDir);
  fs.mkdirSync(path.join(fsdDir, 'spec'));
  fs.mkdirSync(planningDir);
  // Seed spec directly (no PROJECT.md auto-inject for the spec write — use explicit project).
  fs.writeFileSync(path.join(fsdDir, 'spec', 'orphan.md'), [
    '---',
    'project: Orphan', 'id: orphan', 'title: Orphan',
    'status: active', 'created: 2026-04-24', 'approved: true',
    '---', '', '# Orphan',
  ].join('\n'));

  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'orphan', title: 'Orphan Plan', related: ['spec/orphan'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /PROJECT\.md not found/);
}

// --- spec-hard-require refusals ---

// Test 16: refuses when related is absent.
{
  const { fsdDir, planningDir } = mkTmpProject();
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'no-spec', title: 'X' },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /hard-requires a spec linkage/);
}

// Test 17: refuses when related has no spec/ entry.
{
  const { fsdDir, planningDir } = mkTmpProject();
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'no-spec', title: 'X', related: ['plan/other'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /hard-requires a spec linkage/);
}

// Test 18: refuses when linked spec is missing.
{
  const { fsdDir, planningDir } = mkTmpProject();
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'missing', title: 'X', related: ['spec/nonexistent'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /not found/);
}

// Test 19: refuses when linked spec is archived.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'dead', title: 'Dead', status: 'archived' });
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'dead-plan', title: 'X', related: ['spec/dead'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /archived/);
}

// Test 20: refuses when linked spec is unapproved AND acknowledgeUnapproved=false.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'draft', title: 'Draft', approved: false });
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'draft-plan', title: 'X', related: ['spec/draft'] },
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /acknowledgeUnapproved/);
  assert.ok(Array.isArray(res.warnings) && res.warnings.length > 0);
}

// Test 21: succeeds when linked spec is unapproved AND acknowledgeUnapproved=true, surfacing warnings.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'draft', title: 'Draft', approved: false });
  const res = writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'draft-plan', title: 'X', related: ['spec/draft'] },
    acknowledgeUnapproved: true,
  });
  assert.strictEqual(res.ok, true, res.reason);
  assert.ok(Array.isArray(res.warnings) && res.warnings.length > 0);
}

// --- round-trip via scanArtifacts ---

// Test 22: after write, scanArtifacts picks up the plan with valid=true.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'auth', title: 'Auth' });
  writePlanFile({
    projectPath: fsdDir,
    planningDir,
    planData: { id: 'auth', title: 'Auth Plan', related: ['spec/auth'], task: 'FSD-042' },
  });
  const plans = scanArtifacts({ fsdDir, kind: 'plan', dirName: 'plan' });
  assert.strictEqual(plans.length, 1);
  assert.strictEqual(plans[0].id, 'auth');
  assert.strictEqual(plans[0].validation.valid, true, plans[0].validation.errors.join('; '));
}

// --- phases placeholder is the checkbox convention (FSD-009) ---

// Test 23: SECTION_META.phases.placeholder emits the Phase NN checkbox lines.
{
  const p = SECTION_META.phases.placeholder;
  assert.match(p, /- \[ \] \*\*Phase 01\*\*/, 'phases placeholder must seed Phase 01 checkbox');
  assert.match(p, /- \[ \] \*\*Phase 02\*\*/, 'phases placeholder must seed Phase 02 checkbox');
  // Indented step entries.
  assert.match(p, /\n  - /);
}

// Test 24: renderPlan emits the new placeholder verbatim when phases is skipped.
{
  const out = renderPlan({ project: 'P', id: 'p', title: 'P', related: ['spec/x'] });
  assert.ok(out.includes('- [ ] **Phase 01** — _Phase title_'));
  assert.ok(out.includes('- [ ] **Phase 02** — _..._'));
}

// --- verification frontmatter emit (FSD-009) ---

// Test 25: plan-level `verification:` object is emitted and validated.
{
  const out = renderPlan({
    project: 'P', id: 'p', title: 'P', related: ['spec/x'],
    verification: { tests: 'bash tests.sh', validate: 'node v.js' },
  });
  assert.ok(out.includes('verification:'));
  assert.ok(/  tests: bash tests\.sh/.test(out));
  assert.ok(/  validate: node v\.js/.test(out));
  const fm = extractFrontmatter(out);
  const v = validatePlan(fm);
  assert.strictEqual(v.valid, true, v.errors.join('; '));
  assert.deepStrictEqual(fm.verification, { tests: 'bash tests.sh', validate: 'node v.js' });
}

// Test 26: empty/omitted verification does not land in output.
{
  const absent = renderPlan({ project: 'P', id: 'p', title: 'P', related: ['spec/x'] });
  assert.ok(!absent.includes('verification:'));
  const emptySubs = renderPlan({ project: 'P', id: 'p', title: 'P', related: ['spec/x'], verification: { tests: '' } });
  assert.ok(!emptySubs.includes('verification:'));
}

// --- checkPlanPrecondition (FSD-009) ---

function seedPlanForPre({ fsdDir, planningDir, id, specId = null, status = 'active', phases, acceptance, acknowledgeUnapproved = false }) {
  const sid = specId || `${id}-spec`;
  if (!fs.existsSync(path.join(fsdDir, 'spec', `${sid}.md`))) {
    seedSpec({ fsdDir, planningDir, id: sid, title: sid });
  }
  const res = writePlanFile({
    projectPath: fsdDir, planningDir,
    planData: {
      id, title: id, status, related: [`spec/${sid}`],
      sections: {
        phases: phases !== undefined ? phases : '- [ ] **Phase 01** — First\n- [ ] **Phase 02** — Second',
        acceptance: acceptance !== undefined ? acceptance : '- [ ] first\n- [ ] second',
      },
    },
    acknowledgeUnapproved,
  });
  assert.strictEqual(res.ok, true, res.reason);
  return res.written[0];
}

// Test 27: happy path — ok: true, plan populated with parsed phases, warnings empty.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedPlanForPre({ fsdDir, planningDir, id: 'p1' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p1' });
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(r.plan && typeof r.plan.meta === 'object');
  assert.ok(typeof r.plan.body === 'string' && r.plan.body.length > 0);
  assert.strictEqual(r.plan.phases.length, 2);
  assert.deepStrictEqual(r.warnings, []);
}

// Test 28: refuse when plan file missing.
{
  const { fsdDir } = mkTmpProject();
  const r = checkPlanPrecondition({ fsdDir, planId: 'none' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not found/);
}

// Test 29: refuse when plan is archived.
{
  const { fsdDir, planningDir } = mkTmpProject();
  const planPath = seedPlanForPre({ fsdDir, planningDir, id: 'p2' });
  archivePlan({ planPath });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p2' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /archived/);
  assert.match(r.reason, /\/fsd:plan-update/);
}

// Test 30: refuse when plan has no Phase NN checkboxes.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedPlanForPre({ fsdDir, planningDir, id: 'p3',
    phases: 'Freeform prose with no checkbox entries.' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p3' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Phase NN|## Phases/);
}

// Test 31: refuse when acceptance has no open `- [ ]` entries.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedPlanForPre({ fsdDir, planningDir, id: 'p4',
    acceptance: 'All criteria shipped pre-flight.' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p4' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /acceptance/i);
}

// Test 32: warn (not refuse) when plan status is draft.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedPlanForPre({ fsdDir, planningDir, id: 'p5', status: 'draft' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p5' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some(w => /draft/i.test(w)));
}

// Test 33: warn (not refuse) when linked spec is unapproved.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedSpec({ fsdDir, planningDir, id: 'unapp', title: 'Unapp', approved: false });
  seedPlanForPre({ fsdDir, planningDir, id: 'p6', specId: 'unapp', acknowledgeUnapproved: true });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p6' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some(w => /approved: false/.test(w)));
}

// Test 34: refuse when linked spec is archived.
{
  const { fsdDir, planningDir } = mkTmpProject();
  seedPlanForPre({ fsdDir, planningDir, id: 'p7', specId: 'dies' });
  const { archive: archiveSpec } = require(path.join(__dirname, '..', 'scripts', 'spec-update.js'));
  archiveSpec({ specPath: path.join(fsdDir, 'spec', 'dies.md') });
  const r = checkPlanPrecondition({ fsdDir, planId: 'p7' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /archived/);
}

console.log('  All plan tests passed');
