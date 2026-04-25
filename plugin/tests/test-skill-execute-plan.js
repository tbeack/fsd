#!/usr/bin/env node
'use strict';

// Integration tests for the `/fsd:execute-plan` skill (FSD-009).
//
// The skill is interactive — it drives the engineer through a phase loop,
// not a single CLI entry. So the tests cover two surfaces:
//   1. SKILL.md sanity: frontmatter, the 6 documented steps, cross-refs,
//      the phase checkbox contract, the verification discovery order, the
//      full pipeline close-out, and the non-negotiable guardrails.
//   2. CLI-level refusal probes: `checkPlanPrecondition` (already covered
//      in test-plan.js) gets one extra round of integration probes here to
//      prove the executor's front door behaves as documented — missing
//      plan, archived plan, no-phases plan, no-AC plan, draft-plan warning,
//      unapproved-spec warning.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pluginRoot = path.resolve(__dirname, '..');
const skillPath = path.join(pluginRoot, 'skills', 'execute-plan', 'SKILL.md');

const { writeProjectFiles } = require(path.join(pluginRoot, 'scripts', 'new-project.js'));
const { writeSpecFile } = require(path.join(pluginRoot, 'scripts', 'spec.js'));
const { writePlanFile, checkPlanPrecondition } = require(path.join(pluginRoot, 'scripts', 'plan.js'));
const { archive: archivePlan } = require(path.join(pluginRoot, 'scripts', 'plan-update.js'));
const { parseYaml } = require(path.join(pluginRoot, 'scripts', 'yaml-parser.js'));

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsd-exec-'));
  const planningDir = path.join(root, 'planning');
  const fsdDir = path.join(root, '.fsd');
  fs.mkdirSync(fsdDir);
  fs.mkdirSync(path.join(fsdDir, 'spec'));
  fs.mkdirSync(path.join(fsdDir, 'plan'));
  writeProjectFiles({
    planningDir,
    projectData: { project: 'Exec Demo', id: 'exec-demo', title: 'Exec Demo' },
    roadmapData: {
      project: 'Exec Demo', id: 'exec-demo-roadmap', title: 'Exec Demo Roadmap',
      version: '0.1', current_milestone: 'v1',
    },
  });
  return { root, fsdDir, planningDir };
}

function seedSpec({ fsdDir, planningDir, id, status = 'active', approved = true }) {
  const r = writeSpecFile({
    projectPath: fsdDir, planningDir,
    specData: { id, title: id.replace(/-/g, ' '), status, approved },
  });
  if (!r.ok) throw new Error(`seed spec failed: ${r.reason}`);
}

function seedPlan({ fsdDir, planningDir, id, specId = null, status = 'active', phases = null, acceptance = null, acknowledgeUnapproved = false }) {
  const sid = specId || `${id}-spec`;
  if (!fs.existsSync(path.join(fsdDir, 'spec', `${sid}.md`))) {
    seedSpec({ fsdDir, planningDir, id: sid });
  }
  const r = writePlanFile({
    projectPath: fsdDir, planningDir,
    planData: {
      id, title: id.replace(/-/g, ' '), status, related: [`spec/${sid}`],
      sections: {
        phases: phases !== null ? phases : '- [ ] **Phase 01** — First phase\n  - Step 1\n- [ ] **Phase 02** — Second phase\n  - Step 2',
        acceptance: acceptance !== null ? acceptance : '- [ ] first verification\n- [ ] second verification',
      },
    },
    acknowledgeUnapproved,
  });
  if (!r.ok) throw new Error(`seed plan failed: ${r.reason}`);
  return r.written[0];
}

// --- SKILL.md frontmatter sanity ---

// Test 1: SKILL.md exists with the expected frontmatter.
{
  assert.ok(fs.existsSync(skillPath), 'plugin/skills/fsd:execute-plan/SKILL.md must exist');
  const content = fs.readFileSync(skillPath, 'utf-8');
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'SKILL.md must have YAML frontmatter');
  const fm = parseYaml(m[1]);
  assert.strictEqual(fm.name, 'execute-plan');
  assert.match(fm['argument-hint'] || '', /plan-id/);
  assert.ok(fm.description && fm.description.length >= 20, 'description must be >= 20 chars');
  // description must name the load-bearing pieces of the skill's contract.
  const d = fm.description;
  assert.ok(/plan/i.test(d));
  assert.ok(/phase/i.test(d) && /checkbox/i.test(d));
  assert.ok(/verification/i.test(d));
  assert.ok(/no auto-commit|no-auto-commit|auto-commit/i.test(d));
}

// Test 2: SKILL.md documents all 6 steps.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  for (let i = 1; i <= 6; i++) {
    assert.ok(
      new RegExp(`Step ${i}`).test(content),
      `SKILL.md must document Step ${i}`,
    );
  }
}

// Test 3: SKILL.md documents the precondition + argument handling + refuse branches.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/PROJECT\.md/.test(content));
  assert.ok(/checkPlanPrecondition/.test(content));
  assert.ok(/scanArtifacts/.test(content), 'must list-and-ask when plan-id omitted');
  // Refusal reasons enumerated.
  for (const needle of [
    /archived/i,
    /no-phases|Phase NN|- \[ \] \*\*Phase/,
    /acceptance|- \[ \]/,
    /linked spec|spec-side/,
  ]) {
    assert.ok(needle.test(content), `refusal ${needle} must be documented`);
  }
}

// Test 4: SKILL.md documents the pre-flight summary and single yes/no gate.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/pre-flight/i.test(content));
  assert.ok(/yes\/?\s*no/i.test(content));
  assert.ok(/Proceed\?/.test(content));
  // Summary content elements.
  for (const needle of [/verification/i, /version target/i, /linked spec/i, /ARCHITECTURE\.md/i, /CHANGELOG/i]) {
    assert.ok(needle.test(content));
  }
}

// Test 5: SKILL.md documents the phase execution loop primitives.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/TaskCreate/.test(content));
  assert.ok(/verification discovery order|phase[-\s]body.*plan frontmatter.*PROJECT\.md|verify:/i.test(content));
  assert.ok(/flip-phase/.test(content));
  assert.ok(/adr:/.test(content), 'ADR scratch-list prefix mechanic must be documented');
}

// Test 6: SKILL.md documents the AC walkthrough + evidence requirement + flip.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  assert.ok(/flip-ac/.test(content));
  assert.ok(/evidence/i.test(content));
  assert.ok(/All criteria verified/i.test(content));
}

// Test 7: SKILL.md documents all 5 pipeline close-out ops behind a single ACK.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  // Single ACK gate.
  assert.ok(/single ACK|one final ACK|one ACK|Apply the above/i.test(content));
  // Each close-out op named.
  assert.ok(/CHANGELOG/.test(content));
  assert.ok(/version|plugin\.json/i.test(content));
  assert.ok(/todo\.md/.test(content));
  assert.ok(/archive/i.test(content));
  assert.ok(/approve/i.test(content));
  assert.ok(/ARCHITECTURE\.md|append-decision|ADR/.test(content));
}

// Test 8: SKILL.md Step 6 documents no-auto-commit handoff + commit-boundary surface.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  // The Guardrails section ALSO forbids auto-commit; the assertion below
  // targets the handoff step specifically.
  assert.ok(/commit boundary|commit-boundary|commit the current diff|review with `git diff`/i.test(content));
  assert.ok(/git push/i.test(content));
  assert.ok(/auto-commit/i.test(content));
}

// Test 9: SKILL.md Guardrails enumerate every non-negotiable.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  const g = content.match(/## Guardrails[\s\S]*$/);
  assert.ok(g, 'Guardrails section must exist');
  const section = g[0];
  for (const forbidden of [
    /yes\/?\s*no/i,                  // pre-flight gate
    /failing phase verification/i,   // stop on failure
    /phase checkbox/i,               // no flip without verification
    /AC checkbox|evidence/i,         // no flip without evidence
    /plan body/i,                    // no plan-body edits to cheat
    /AC text/i,                      // no AC rewrite to cheat
    /auto-commit/i,                  // no auto-commit
    /auto-push|git push/i,           // no auto-push
    /destructive git/i,              // no destructive git
    /without the final ACK|final ACK/i, // ACK gate
    /version the plan doesn't name/i, // no silent bumps
    /ARCHITECTURE\.md/i,             // no silent ADRs
    /linked-spec|spec check/i,       // no dropping spec check
    /archived plan/i,                // no executing archived plans
  ]) {
    assert.ok(forbidden.test(section), `Guardrails must forbid: ${forbidden}`);
  }
}

// Test 10: SKILL.md cross-references sibling skills.
{
  const content = fs.readFileSync(skillPath, 'utf-8');
  for (const ref of ['/fsd:plan', '/fsd:plan-update', '/fsd:new-project']) {
    assert.ok(content.includes(ref), `SKILL.md must cross-reference ${ref}`);
  }
  // The ADR append path is on ARCHITECTURE.md authored by /fsd:plan.
  assert.ok(/ARCHITECTURE\.md/.test(content));
  assert.ok(/spec-update|approve/.test(content), 'spec approve pipeline op must be visible');
}

// --- checkPlanPrecondition integration probes (the executor's front door) ---

// Test 11: happy path — non-archived plan with phases + ACs + approved spec → ok: true.
{
  const { fsdDir, planningDir } = mkFixture();
  seedPlan({ fsdDir, planningDir, id: 'execute-me' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'execute-me' });
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(r.plan.phases.length, 2);
  assert.deepStrictEqual(r.warnings, []);
}

// Test 12: missing plan → ok: false with file-not-found reason.
{
  const { fsdDir } = mkFixture();
  const r = checkPlanPrecondition({ fsdDir, planId: 'nowhere' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not found/);
}

// Test 13: archived plan → ok: false with unarchive pointer.
{
  const { fsdDir, planningDir } = mkFixture();
  const planPath = seedPlan({ fsdDir, planningDir, id: 'old' });
  archivePlan({ planPath });
  const r = checkPlanPrecondition({ fsdDir, planId: 'old' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /archived/);
  assert.match(r.reason, /\/fsd:plan-update/);
}

// Test 14: plan with zero phase checkboxes → ok: false.
{
  const { fsdDir, planningDir } = mkFixture();
  seedPlan({ fsdDir, planningDir, id: 'incomplete',
    phases: 'Freeform prose here. No checkbox entries.' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'incomplete' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Phase NN|no .* phase|## Phases/i);
}

// Test 15: plan with zero open acceptance entries → ok: false.
{
  const { fsdDir, planningDir } = mkFixture();
  seedPlan({ fsdDir, planningDir, id: 'ac-less',
    acceptance: 'All criteria shipped.' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'ac-less' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /acceptance/i);
}

// Test 16: draft plan → ok: true + a warning.
{
  const { fsdDir, planningDir } = mkFixture();
  seedPlan({ fsdDir, planningDir, id: 'draftish', status: 'draft' });
  const r = checkPlanPrecondition({ fsdDir, planId: 'draftish' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some(w => /draft/i.test(w)));
}

// Test 17: unapproved linked spec → ok: true + a warning.
{
  const { fsdDir, planningDir } = mkFixture();
  seedSpec({ fsdDir, planningDir, id: 'unapp-spec', approved: false });
  seedPlan({ fsdDir, planningDir, id: 'against-unapproved', specId: 'unapp-spec', acknowledgeUnapproved: true });
  const r = checkPlanPrecondition({ fsdDir, planId: 'against-unapproved' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some(w => /approved: false/.test(w)));
}

// Test 18: archived linked spec → ok: false.
// Approach: author plan against approved spec, then archive the spec to simulate drift.
{
  const { fsdDir, planningDir } = mkFixture();
  seedPlan({ fsdDir, planningDir, id: 'stranded', specId: 'stranded-spec' });
  // Archive the linked spec post-hoc.
  const { archive: archiveSpec } = require(path.join(pluginRoot, 'scripts', 'spec-update.js'));
  const specPath = path.join(fsdDir, 'spec', 'stranded-spec.md');
  const r1 = archiveSpec({ specPath });
  assert.strictEqual(r1.ok, true, r1.reason);
  const r = checkPlanPrecondition({ fsdDir, planId: 'stranded' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /archived/);
}

// Test 19: two-plan fixture — list-and-ask surface (scanArtifacts).
// The skill's Step 1b lists non-archived plans when $ARGUMENTS omits the
// plan id. Verify scanArtifacts returns every `.fsd/plan/*.md` entry so the
// skill can render the list for the engineer to pick from.
{
  const { fsdDir, planningDir } = mkFixture();
  const planPathA = seedPlan({ fsdDir, planningDir, id: 'alpha' });
  const planPathB = seedPlan({ fsdDir, planningDir, id: 'beta' });
  // Archive the second — the skill excludes archived ones from the list.
  const { archive: archivePlan2 } = require(path.join(pluginRoot, 'scripts', 'plan-update.js'));
  archivePlan2({ planPath: planPathB });

  const { scanArtifacts } = require(path.join(pluginRoot, 'scripts', 'loader.js'));
  const all = scanArtifacts({ fsdDir, kind: 'plan', dirName: 'plan' });
  assert.strictEqual(all.length, 2);
  const activeOnly = all.filter(p => p.status !== 'archived');
  assert.strictEqual(activeOnly.length, 1);
  assert.strictEqual(activeOnly[0].id, 'alpha');
}

console.log('  All fsd-execute-plan integration tests passed');
