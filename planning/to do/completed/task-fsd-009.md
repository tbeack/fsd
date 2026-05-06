# FSD-009 — `/fsd-execute-plan` skill: stateful plan executor with full-pipeline close-out

## Source

Own backlog. Fifth skill in the FSAD workflow chain established by FSD-005 (`/fsd-new-project` → `/fsd-spec` → `/fsd-plan` → **`/fsd-execute-plan`** → `/fsd-research` → `/fsd-ship`). Direct downstream of FSD-008, which shipped the plan artifact (`.fsd/<structure.plan>/<id>.md`) with a stable 6-section schema and `checkSpecPrecondition` — the executor reads those plans, walks their phases, and closes the loop by writing CHANGELOG, flipping plan/spec status, marking the linked FSD task in `todo.md`, bumping versions, and optionally appending ADRs to `planning/ARCHITECTURE.md`.

## Summary

Add a **guided plan-execution skill** that an engineer invokes as `/fsd-execute-plan <plan-id>` to drive implementation of an approved plan artifact end-to-end. The skill uses an **inline phase checkbox contract** (`- [ ] **Phase 01** — <title>`) in the plan's `## Phases` section, parses phases via a new `parsePhases` helper in `plan-update.js`, flips checkboxes progressively as each phase's verification passes, and walks `## Acceptance` the same way `/fsd-do-task` does. No native plan-mode gate — the plan artifact is already the approved contract; the skill shows a pre-flight summary and a single yes/no prompt before starting.

The skill is **full-pipeline**: on successful completion it flips plan `status → archived`, flips the linked spec's `approved → true` (if still false), marks the linked FSD task `[x]` in `planning/to do/todo.md`, writes the CHANGELOG entry the plan calls for, aligns version sources (`plugin/.claude-plugin/plugin.json` + README header + CHANGELOG heading) to the target version named in the plan body, and — if the engineer surfaced ADR-worthy decisions mid-execution — appends them to `planning/ARCHITECTURE.md`. Every pipeline write is gated behind an explicit final ACK after the engineer sees the verification summary. **No auto-commit and no push** — matches `/fsd-do-task` execute mode; the engineer owns the release boundary.

Verification commands are resolved in order: phase body backtick hints > plan frontmatter `verification:` > PROJECT.md `verification:` > ask engineer. To support that contract, this task introduces an optional `verification:` frontmatter object (shape: `{ tests?, validate?, typecheck?, lint? }`, all strings) on both PROJECT.md and plan artifacts, with a one-prompt retrofit to `/fsd-new-project` and `/fsd-plan`.

Also retrofits `/fsd-plan` minimally to emit phases as checkbox-prefixed entries (`- [ ] **Phase 01** — <title>` + indented steps) so the executor has a deterministic parse target. No migration — `.fsd/plan/` has no real plans today.

## Assessment

**Current state:**

- `plugin/scripts/plan.js` (from FSD-008) exports `renderPlan`, `writePlanFile`, `resolvePlanPath`, `checkSpecPrecondition`, `today`, `SECTION_ORDER`, `SECTION_META`. The six-section body is Context / Approach / Phases / Risks / Acceptance / Open questions. `SECTION_META.phases.placeholder` is a freeform italic string today — no checkbox convention.
- `plugin/scripts/plan-update.js` (from FSD-015) already ships `parsePlan(content)` (line-range-aware section parser), `readPlan`, `writePlanAtomic`, `rewriteFrontmatter`, plus `update / archive / supersede` ops and a CLI. Byte-preservation is honored. The executor reuses `parsePlan` and `writePlanAtomic` — no re-implementation.
- `plugin/scripts/spec-update.js` (from FSD-014) exports `approve({ specPath })` plus `update / archive / supersede`. The executor calls `approve` to flip the linked spec's `approved → true` at completion.
- `plugin/scripts/architecture.js` (from FSD-008) exports `appendDecision({ planningDir, title, context, decision, consequences })`. The executor uses it verbatim for end-of-run ADR appends.
- `plugin/scripts/validator.js` ships `validateProject`, `validatePlan`, `validateSpec`, `validateArchitecture`, `validateRoadmap`, sharing `validateProjectContextCommon`. None currently recognize a `verification:` frontmatter field — validation will reject it today.
- `plugin/scripts/new-project.js` + `plugin/skills/fsd-new-project/SKILL.md` (from FSD-005) own PROJECT.md authoring. No `verification:` prompt exists.
- `plugin/scripts/loader.js` exposes `loadProjectContext`, `scanArtifacts`. `scanArtifacts({ fsdDir, kind: 'plan', dirName })` returns every plan with `validation.valid` — sufficient for the "list plans when arg omitted" flow.
- `plugin/skills/execute/SKILL.md` is the plan-agnostic TDD-discipline skill. `/fsd-execute-plan` does not invoke it — the TDD cadence lives inline in the skill's Step 3 loop. `/fsd-do-task` is the task-level executor and is the structural template for `/fsd-execute-plan` (mode switching → pre-flight summary → per-phase loop → AC walkthrough → CHANGELOG → todo.md flip → handoff).
- `.fsd/plan/` is currently empty — no real plans exist yet. `/fsd-plan` emit retrofit does not need a migration path.
- Current plugin version is `0.11.0` (post-FSD-015). This task bumps to `0.12.0` (minor additive — new skill, new frontmatter field, no breaking changes).

**What needs to exist:**

1. **Validator extension.** `validateProject` and `validatePlan` accept an optional `verification:` object frontmatter field with optional string subfields `tests`, `validate`, `typecheck`, `lint`. No required subfields. Shared schema check for both.
2. **`/fsd-new-project` retrofit.** One optional prompt in the interview flow; emitter writes the field if provided.
3. **`/fsd-plan` retrofit — minimal.** `SECTION_META.phases.placeholder` emits `- [ ] **Phase 01** — _Phase title_\n  - _First step_\n  - _Second step_\n- [ ] **Phase 02** — _..._` so downstream parsing is deterministic. Socratic-flow nudge to structure phases this way. One optional frontmatter prompt for plan-level `verification:` override.
4. **Plan parser/mutator extensions in `plugin/scripts/plan-update.js`.** Three new exports: `parsePhases(content)` (scans `## Phases` for `- [ ] **Phase NN**` entries, returns `[{ number, title, completed, lineIndex }]`), `flipPhase({ planPath, phaseNumber })` (flips `- [ ]` → `- [x]` on the matched phase line, bumps `updated:`, byte-preserves rest), `flipAcceptance({ planPath, lineMatcher })` (same for a specific AC line). Plus CLI ops.
5. **Plan precondition helper in `plugin/scripts/plan.js`.** `checkPlanPrecondition({ fsdDir, config, planId })` returns `{ ok, plan?, reason?, warnings }` — parallel in shape to `checkSpecPrecondition`. Verifies: plan file exists, `status !== archived`, `## Phases` has at least one `- [ ] **Phase NN**` entry, `## Acceptance` has at least one `- [ ]` entry, linked spec is present and not archived (via `checkSpecPrecondition`).
6. **`/fsd-execute-plan` skill.** `plugin/skills/fsd-execute-plan/SKILL.md` orchestrates: preconditions → pre-flight summary + yes/no → phase execution loop with per-phase verification + progressive checkbox flips → AC walkthrough with progressive checkbox flips → pipeline writes (CHANGELOG, version align, todo.md flip, plan archive, spec approve, optional ARCHITECTURE.md ADR append) behind one ACK gate → handoff with commit suggestions.
7. **Tests.** New `plugin/tests/test-fsd-execute-plan.js` (skill frontmatter + SKILL.md sanity + CLI-entry smoke tests for the new helpers). Extensions to `test-plan.js`, `test-plan-update.js`, `test-validator.js`, `test-project-context.js`, `test-fsd-new-project.js`, `test-fsd-plan.js`.
8. **Docs + release.** README Commands section, README Project Context section (document `verification:` field shape), README Artifact Schemas section (document phase checkbox contract + new `verification:` field on plans). CHANGELOG `[0.12.0]`. Version bump across `plugin/.claude-plugin/plugin.json` + README header + CHANGELOG.

**Locked decisions (gathered during this plan-mode session):**

1. **Scope = (c) full-pipeline.** Skill flips plan status, flips spec `approved`, marks linked FSD task in todo.md, writes CHANGELOG, aligns version sources, optionally appends ADRs. Every pipeline write is gated by one final ACK.
2. **Phase tracking = (i) inline checkboxes.** Convention: `- [ ] **Phase 01** — <title>` at top level, steps indented beneath. Two-digit zero-padded, matches `FSD-NNN`. Retrofit `/fsd-plan` to emit this format. No schema change to `validatePlan`.
3. **Pre-execution gate = (a) dive straight in.** No `EnterPlanMode`. Skill prints a pre-flight summary (plan title, N phases, verification commands it will run, pipeline write list) and a single `yes/no` prompt. On yes, start Phase 01.
4. **Verification cadence = (b) per-phase + final full-suite.** Run verification commands after each phase before flipping its checkbox. Run the full verification surface (tests + `/fsd:validate`) once more at end before AC walkthrough. Regressions surface within one phase.
5. **Commit boundary = (c) no auto-commit.** Skill prints suggested commit boundaries from the plan body at handoff; engineer commits manually. Matches `/fsd-do-task`.
6. **Pipeline close-out ops (all five enabled, all gated by one final ACK):**
   - Plan `status → archived`, bump `updated:` — via `plan-update.update({ target: 'status', value: 'archived' })`.
   - Linked spec `approved → true` (if still false), bump `updated:` — via `spec-update.approve`.
   - Linked FSD task `- [ ] → - [x]` in `planning/to do/todo.md` — via direct `Edit` with unique surrounding context (mirrors `/fsd-do-task`).
   - Version bump — scan plan body for `v\d+\.\d+\.\d+` in Phase G-style section; align three sources (`plugin.json`, README header, CHANGELOG heading). If absent, ask.
   - ARCHITECTURE.md ADR append — collect engineer-surfaced ADR notes into an in-memory scratch list during execution; at final ACK, present list and ask "record these? (yes/no/edit)". Never auto-append silently. Via `architecture.appendDecision` per entry.
7. **Verification discovery order.** Phase body hint (first backtick-wrapped shell command in the phase body) > plan frontmatter `verification:` > PROJECT.md `verification:` > ask engineer. Skill prints which source it picked.
8. **PROJECT.md schema extension — additive.** Optional `verification:` frontmatter object. `validateProject` accepts it if present. No breaking change. `/fsd-new-project` retrofit adds one optional prompt (engineer can skip).
9. **Plan schema extension — additive.** Optional `verification:` frontmatter object (same shape as PROJECT.md's). `validatePlan` accepts it. `/fsd-plan` retrofit adds one optional prompt in the frontmatter interview.
10. **Argument handling.** `/fsd-execute-plan <plan-id>` required positional; if omitted, list non-archived plans in `.fsd/<structure.plan>/*.md` with title + status, ask engineer to pick. No default.
11. **Refuse conditions (hard aborts):**
    - Plan file missing → abort with `/fsd-plan` pointer.
    - Plan `status: archived` → abort ("unarchive via `/fsd-plan-update` or pick another plan").
    - Plan has zero `- [ ] **Phase NN**` entries in `## Phases` → abort ("plan is incomplete — finish authoring via `/fsd-plan-update`").
    - Plan has zero `- [ ]` entries in `## Acceptance` → abort (same pointer).
    - Linked spec missing or `status: archived` → abort with spec-side pointer.
    - PROJECT.md missing or invalid → abort with `/fsd-new-project` pointer (do not chain-invoke — unlike `/fsd-plan`, the executor does not bootstrap project scaffolding).
12. **Soft warnings (proceed with explicit yes):**
    - Plan `status: draft` (executable, but surfaces "plan not yet marked active; proceed anyway?").
    - Linked spec `approved: false` (surfaces "spec not approved; proceed anyway? pipeline close-out will flip it to approved on success").
13. **Mid-execution ADR collection mechanic.** Engineer surfaces ADRs by prefacing a chat message with `adr:` followed by a one-line title. Skill captures the title and asks for Context/Decision/Consequences at end-of-run during the final ACK flow. No mid-phase writes to ARCHITECTURE.md.
14. **Version bump — 0.11.0 → 0.12.0.** Minor additive.
15. **`checkPlanPrecondition` placement.** In `plan.js` next to `checkSpecPrecondition`. Keeps precondition helpers colocated and testable in isolation.
16. **Plan status semantics.** On successful completion: flip to `archived` (terminal state). The intermediate `active` (from FSD-008 "engineer flips once phases are locked and execution is imminent") is NOT auto-applied by the executor — it remains the engineer's manual flip via `/fsd-plan-update`. Draft plans execute directly to archived with a soft warning.

**Out of scope** (flagged for follow-up):

- `/fsd-plan-update unarchive` op. Engineer archives a plan by running it through `/fsd-execute-plan`; there's no auto-unarchive route yet.
- Mid-execution architecture.md sub-section appends beyond ADRs (stack/code_examples/references/standards/glossary/open_questions). Those remain `/fsd-plan`'s territory.
- Auto-detect of test commands from `package.json` / `Makefile` / etc. The `verification:` field is the explicit contract; auto-detect would re-introduce the (c) fragility from Q7.
- Multi-plan batch execution. One plan per invocation.
- Parallel phase execution.
- Rollback on phase failure (skill stops and surfaces; engineer decides next steps). No `git reset` or `git stash` semantics.
- `depends_on:` resolution — if a plan declares `depends_on: [other-plan]`, the executor warns but doesn't block. Chain-execution is a future FSD.
- Surfacing plan-execution state in the session-start header. Loader stays as-is.
- CLI surface for scripted end-to-end plan execution without user interaction (the skill is interactive-only; test-facing CLI entries on `plan.js` / `plan-update.js` cover automation for tests).

## Plan

**Phase A — Validator extension for `verification:` on PROJECT.md and plans**

1. Add `validateVerificationField(meta)` helper to `plugin/scripts/validator.js`:
   - If `meta.verification` is absent → pass (optional field).
   - If present → must be a plain object. Each of `tests`, `validate`, `typecheck`, `lint` is optional; when present, must be a non-empty string. Unknown subfields accepted (forward-compatible) but flagged as warnings.
   - Returns `{ errors: [], warnings: [] }`.
2. Wire the helper into `validateProject` and `validatePlan` — called after `validateProjectContextCommon` / plan-specific checks. No changes to `validateSpec`, `validateRoadmap`, `validateArchitecture`.
3. Export `validateVerificationField` for direct testing.

**Phase B — `/fsd-new-project` retrofit for `verification:` prompt**

4. Extend `plugin/scripts/new-project.js`:
   - Add `verification` as an optional field in the project data shape.
   - `renderProject` emits it as a YAML sub-object when present:
     ```
     verification:
       tests: bash plugin/tests/run-tests.sh
       validate: node plugin/scripts/validate.js plugin
     ```
   - No auto-injection; purely user-supplied.
5. Extend `plugin/skills/fsd-new-project/SKILL.md`:
   - Add one interview question after the existing project-metadata prompts: "Any repo-wide verification commands? These get run by `/fsd-execute-plan` after each plan phase. Reply like `tests: bash ..., validate: node ...` or 'skip'."
   - Parse the comma-separated reply into the verification object; on 'skip' omit the field.
6. No changes to `loadProjectContext` — `meta` already carries whatever validates.

**Phase C — `/fsd-plan` retrofit: phase checkbox emit + optional `verification:` frontmatter**

7. Update `SECTION_META.phases.placeholder` in `plugin/scripts/plan.js` to seed the inline-checkbox convention. New placeholder:
   ```
   - [ ] **Phase 01** — _Phase title_
     - _First step_
     - _Second step_
   - [ ] **Phase 02** — _..._
   ```
8. Add a one-line nudge to `plugin/skills/fsd-plan/SKILL.md` Step 4 Socratic discussion: "Structure phases as `- [ ] **Phase 01** — <title>` with two-digit numbering. `/fsd-execute-plan` parses this format to track progress."
9. Add an optional frontmatter prompt in `fsd-plan/SKILL.md` Step 4's frontmatter interview: "Plan-specific verification commands that override PROJECT.md? (typically 'skip'). Reply like `tests: ..., validate: ...` or 'skip'."
10. `writePlanFile` already calls `validatePlan`; Phase A's extension to `validatePlan` is all the server-side check that's needed.

**Phase D — Plan parser/mutator extensions in `plugin/scripts/plan-update.js`**

11. Add `parsePhases(planContent)`:
    - Uses the existing `parsePlan(content)` to locate the `## Phases` section range.
    - Scans the section lines for entries matching `/^-\s+\[([ xX])\]\s+\*\*Phase\s+(\d{2,})\*\*\s+—\s+(.+?)\s*$/`.
    - Returns `[{ number: "01", title: "Foo", completed: false, lineIndex: 17 }, ...]`.
    - Unknown line formats in `## Phases` are ignored (tolerates freeform prose alongside checkboxes).
12. Add `flipPhase({ planPath, phaseNumber })`:
    - Reads plan via existing `readPlan`, calls `parsePhases`, finds the matching entry (reject if `phaseNumber` not found, reject if already `completed: true`).
    - Replaces `- [ ]` with `- [x]` on that line; preserves indentation, title, and trailing whitespace byte-for-byte.
    - Bumps `updated:` to today via existing `rewriteFrontmatter` + `withUpdatedDate` + `applyFrontmatterUpdates`.
    - Writes atomically via existing `writePlanAtomic`.
    - Returns `{ ok: true, written: planPath }` or `{ ok: false, reason }`.
13. Add `flipAcceptance({ planPath, lineMatcher })`:
    - Locates `## Acceptance` section via `parsePlan`.
    - Scans for the first `- [ ]` line whose text contains `lineMatcher` (substring match, case-sensitive).
    - Flips `- [ ]` to `- [x]`; same byte-preservation + frontmatter bump as `flipPhase`.
    - Returns same shape. Reject if no match found or line already `[x]`.
14. CLI additions to `plugin/scripts/plan-update.js`:
    - `node plan-update.js <planPath> flip-phase --phase-number=01`
    - `node plan-update.js <planPath> flip-ac --line-matcher="<substring>"`
    - Both print `{ ok, written?, reason? }` JSON.
15. Export `parsePhases`, `flipPhase`, `flipAcceptance` alongside existing exports.

**Phase E — `checkPlanPrecondition` in `plugin/scripts/plan.js`**

16. Add `checkPlanPrecondition({ fsdDir, config, planId })`:
    - Resolve plan path via existing `resolvePlanPath`.
    - Read + parse via `plan-update.parsePlan` (require it lazily to avoid circular import; or factor `parsePlan` out to a shared util — prefer the lazy require to keep the FSD-015 module boundary).
    - Checks (return `{ ok: false, reason }` on first fail):
      - File missing.
      - Frontmatter `status === 'archived'`.
      - Less than one `- [ ] **Phase NN**` entry in `## Phases` (via `plan-update.parsePhases`).
      - Less than one `- [ ]` entry in `## Acceptance`.
    - For the linked spec: extract first `spec/<id>` from `meta.related`, call existing `checkSpecPrecondition({ fsdDir, specId })`. Propagate its `reason` on refusal; propagate its `warnings` on unapproved-spec.
    - On status `draft`, add warning `"plan status is draft, not active — execute anyway?"`.
    - Return shape: `{ ok, plan?: { meta, body, path, phases }, reason?, warnings: [] }` where `phases` is the parsePhases output for downstream reuse.
17. Export alongside `checkSpecPrecondition`.

**Phase F — `/fsd-execute-plan` skill `plugin/skills/fsd-execute-plan/SKILL.md`**

18. SKILL.md structure — 6 steps:

    **Step 1: Preconditions.**
    - Read `planning/PROJECT.md` via `loadProjectContext`. Missing or invalid → abort with pointer to `/fsd-new-project` (do NOT chain-invoke).
    - Parse `$ARGUMENTS`. Missing → list non-archived plans via `scanArtifacts({ fsdDir, kind: 'plan', dirName })` with id + title + status; ask engineer to pick one.
    - Call `checkPlanPrecondition({ fsdDir, config, planId: <picked> })`. Abort on `ok: false` with the reason verbatim. Surface warnings verbatim and ask "proceed anyway? (yes/no)" — abort on no.

    **Step 2: Pre-flight summary + yes/no gate.**
    - Read the plan body in full (already in `checkPlanPrecondition` return).
    - Read `planning/ARCHITECTURE.md` if present (for the ADR append end-path).
    - Resolve verification commands per the discovery order (phase hint < plan FM < PROJECT.md < ask). Ask the engineer ONLY if no source provides at least `tests:` — prompt: "No verification commands found. What should I run after each phase?"
    - Print a summary message: plan title, N phases (list them with titles), verification commands with source, version target (from plan body scan, or "none"), linked spec id, linked FSD task id (from plan `task:` frontmatter, if any), whether CHANGELOG is expected, whether ARCHITECTURE.md exists.
    - Ask: "Proceed? (yes/no)". Abort on no.

    **Step 3: Phase execution loop.**
    - Create one `TaskCreate` item per phase, titled `Phase NN — <title>`.
    - For each phase `NN` in order:
      - Mark task `in_progress`.
      - Print "Entering Phase NN — <title>".
      - Read phase body from the plan. Implement the phase's steps. Apply plan-specified file changes. If the plan's step is ambiguous, STOP and ask the engineer — never silently deviate (mirrors `/fsd-do-task` execute mode 5c).
      - Resolve per-phase verification override: scan phase body for backtick-wrapped shell commands marked with `verify:` prefix; if any, use those; else fall back to the Step 2 resolution.
      - Run verification commands in order, capture output.
      - On any failure: STOP the loop. Print the failing command + last ~40 lines of output. Do NOT flip the phase checkbox. Do NOT proceed to the next phase. The engineer decides whether to fix + re-invoke or abandon.
      - On all pass: call `node plan-update.js <planPath> flip-phase --phase-number=<NN>`. Verify `{ ok: true }`. Mark `TaskCreate` item `completed`.
      - Listen for `adr:` prefixed chat messages from the engineer during the phase — capture the title into an in-memory scratch list for Step 5.
    - After the last phase passes: run the full verification suite once more (every resolved command, not just the phase's subset) as a final regression check. Abort on failure.

    **Step 4: Acceptance criteria walkthrough.**
    - Read the plan's `## Acceptance` section. For each `- [ ]` line:
      - Print the AC text.
      - Produce evidence: a test command output, a file path + grep, or a direct probe. Evidence must be concrete — not "I believe this works".
      - On pass: call `node plan-update.js <planPath> flip-ac --line-matcher="<unique AC substring>"`. Verify `{ ok: true }`. Print "PASS — <evidence>".
      - On fail: STOP. Print "FAIL — <what broke>". Do not flip. Do not continue to Step 5. Never edit the AC text to make it pass.
    - After all ACs are `[x]`: insert `All criteria verified YYYY-MM-DD before commit.` as a line immediately above the AC list (mirrors `/fsd-do-task`). Use a single `Edit` call.

    **Step 5: Pipeline close-out — ACK gate.**
    - Assemble the close-out summary message:
      - Version target (from plan body scan); which three files will be aligned.
      - CHANGELOG entry preview (synthesized from plan body if plan names one, or ask engineer for a one-paragraph version).
      - Plan status flip: `<current> → archived`.
      - Spec approve flip: yes/no (only if spec currently `approved: false`).
      - todo.md flip: `FSD-NNN` → `[x]` if plan `task:` frontmatter set.
      - ADR append list: titles collected mid-flow; prompt engineer to fill Context/Decision/Consequences per entry now, or skip.
    - Ask: "Apply all of the above? (yes/no/edit <field>)". On no, stop — skill leaves nothing partially applied beyond the phase/AC checkbox flips from Steps 3-4.
    - On yes, execute in order (each write is independent; failures print but don't cascade):
      1. Write CHANGELOG entry (append above most-recent version block, Keep-a-Changelog format).
      2. Version bump — update `plugin/.claude-plugin/plugin.json`, README header line, CHANGELOG heading to the target.
      3. Mark linked FSD task `[x]` in `planning/to do/todo.md` via `Edit` with unique context.
      4. Flip plan `status → archived` via `node plan-update.js <planPath> update --target=status --value=archived`.
      5. Flip linked spec `approved → true` via `node spec-update.js <specPath> approve` (only if currently false).
      6. For each ADR entry: `node architecture.js <planningDir> append-decision --title=... --context=... --decision=... --consequences=...`.
    - Print a single post-flight summary: what landed + what was skipped.

    **Step 6: Handoff.**
    - Print the plan's commit-boundary list (from the plan body's Phase G-style section, if present; otherwise a single "commit the current diff" suggestion).
    - Explicit reminder: "Review with `git diff`, commit at your discretion, then `git push origin main` when ready."
    - Do NOT run any git command beyond read-only `git status` / `git diff` sanity checks.

19. Skill frontmatter:
    - `name: fsd-execute-plan`
    - `argument-hint: [plan-id]`
    - `description:` ≥ 20 chars, mentions plan artifact consumption, phase checkbox contract, per-phase verification, full-pipeline close-out (archive, approve, todo.md flip, version align, CHANGELOG, optional ADR append), no-auto-commit.

20. **Guardrails section — non-negotiable:**
    - Never skip the pre-flight summary or the yes/no gate. No silent execution.
    - Never proceed past a failing phase verification. Stop immediately.
    - Never flip a phase checkbox without its verification passing.
    - Never flip an AC checkbox without evidence.
    - Never edit the plan body to make verification easier.
    - Never edit AC text to make it pass.
    - Never auto-commit, auto-push, or run destructive git operations.
    - Never apply pipeline close-out ops without the final ACK.
    - Never bump a version the plan doesn't name — ask the engineer if the plan is silent.
    - Never append to ARCHITECTURE.md without the engineer confirming the ADR content.
    - Never drop the linked-spec check — archived or missing spec → stop.
    - Never execute an archived plan.

**Phase G — Tests**

21. New `plugin/tests/test-fsd-execute-plan.js` — ~12 tests:
    - SKILL.md sanity: `name: fsd-execute-plan`, `argument-hint: [plan-id]`, description ≥ 20 chars, cross-references `/fsd-plan`, `/fsd-plan-update`, `/fsd-spec-update approve`, `ARCHITECTURE.md`.
    - SKILL.md documents all 6 steps, the phase checkbox contract, the verification discovery order, all 5 pipeline close-out ops.
    - Guardrails section enumerates all the non-negotiables above.
    - Skill refuses missing plan / archived plan / no-phases plan / no-ACs plan (CLI-level probes against fixtures).
    - Skill surfaces warnings for `status: draft` plans and `approved: false` specs.
    - No production-side orchestration tests (the skill is interactive; orchestration is covered via inspection of SKILL.md body).

22. Extend `plugin/tests/test-plan.js` — ~5 tests:
    - `checkPlanPrecondition` happy path returns `{ ok: true, plan: { ..., phases: [...] } }`.
    - `checkPlanPrecondition` refuses missing / archived / no-phases / no-ACs / missing-spec / archived-spec.
    - `checkPlanPrecondition` warns on draft / unapproved-spec.
    - `renderPlan`'s phases placeholder matches the new checkbox format.

23. Extend `plugin/tests/test-plan-update.js` — ~8 tests:
    - `parsePhases` — minimal valid (one phase), multi-phase, mixed completed/uncompleted, tolerates freeform prose alongside checkboxes, rejects malformed phase lines silently (returns empty for none matched).
    - `flipPhase` happy path + byte-preservation of other content + `updated:` bump + refuse-if-already-complete + refuse-if-phase-not-found.
    - `flipAcceptance` happy path + unique-substring matching + refuse-if-not-found + refuse-if-already-complete.
    - CLI ops `flip-phase` and `flip-ac` return `{ ok, written?, reason? }`.

24. Extend `plugin/tests/test-validator.js` — ~4 tests:
    - `validateVerificationField` happy path (all subfields, partial subfields, absent).
    - Rejects non-object `verification`.
    - Rejects empty-string subfields.
    - `validateProject` + `validatePlan` honor the field (integration).

25. Extend `plugin/tests/test-project-context.js` — ~2 tests:
    - `loadProjectContext` surfaces `verification:` in `meta` when present.
    - Invalid `verification:` (non-object) propagates as a validation error.

26. Extend `plugin/tests/test-fsd-new-project.js` — ~2 tests:
    - Interview flow captures `verification:` when engineer provides it.
    - Engineer can skip; emitted PROJECT.md has no `verification:` field.

27. Extend `plugin/tests/test-fsd-plan.js` — ~2 tests:
    - SKILL.md documents the phase checkbox convention and the plan-level `verification:` override prompt.
    - `renderPlan` emits the new phases placeholder verbatim (snapshot).

28. Verify `plugin/tests/run-tests.sh` picks up `test-fsd-execute-plan.js` automatically (globs `test-*.js`).

**Phase H — Docs + release**

29. README:
    - **Commands section**: add `/fsd-execute-plan [plan-id]` with a one-liner explaining the executor flow + phase checkbox contract + full-pipeline close-out + no-auto-commit. Cross-reference `/fsd-plan` as the upstream and `/fsd-plan-update` as the editor.
    - **Project Context section**: document the new optional `verification:` frontmatter field on PROJECT.md — shape `{ tests?, validate?, typecheck?, lint? }`, worked example showing both PROJECT.md-level and plan-level overrides.
    - **Artifact Schemas section**: document the phase checkbox convention (`- [ ] **Phase NN** — <title>`, two-digit numbering), the optional `verification:` field on plans, and the mid-execution ADR `adr:` chat-prefix mechanic.

30. CHANGELOG new `[0.12.0] - YYYY-MM-DD` entry:
    - **Added**: `/fsd-execute-plan` skill (full description: 6 steps, phase checkbox contract, per-phase verification, full-pipeline close-out, no auto-commit); `parsePhases` / `flipPhase` / `flipAcceptance` in `plan-update.js` + CLI ops; `checkPlanPrecondition` in `plan.js`; `validateVerificationField` in `validator.js`; optional `verification:` frontmatter on PROJECT.md and plans.
    - **Changed**: `/fsd-new-project` prompts for optional `verification:` field (skippable); `/fsd-plan` emits phases as `- [ ] **Phase NN** — <title>` and prompts for optional plan-level `verification:` override; README Commands + Project Context + Artifact Schemas sections updated.
    - **Compatibility**: fully backward-compatible. Existing PROJECT.md / plans without `verification:` continue to validate. `/fsd-plan` retrofit's phase placeholder change only affects newly-authored plans; no real plans exist in `.fsd/plan/` today.
    - **Out of scope**: plan unarchive op, auto-detect verification commands, multi-plan batch execution, parallel phase execution, rollback on phase failure, `depends_on:` chain resolution, session-start header extension.

31. Version source alignment: `plugin/.claude-plugin/plugin.json` → `0.12.0`, README header → `0.12.0`, CHANGELOG `[0.12.0]` entry.

32. Commit boundaries — six logical commits:
    - `feat(validator): verification field on validateProject + validatePlan`
    - `feat(new-project): /fsd-new-project prompts for optional verification commands`
    - `feat(plan): phase checkbox render format + checkPlanPrecondition helper`
    - `feat(plan-update): parsePhases + flipPhase + flipAcceptance + CLI ops`
    - `feat: /fsd-execute-plan skill — stateful plan executor with full-pipeline close-out`
    - `chore(release): v0.12.0 — /fsd-execute-plan skill`

33. Push to `origin/main` is NOT part of this task — hand off to user per skill guardrails.

## Acceptance Criteria

All criteria verified 2026-04-24 before commit.

- [x] `plugin/scripts/validator.js` exports `validateVerificationField`; it returns `{ errors, warnings }` and accepts absent / object / partial-subfields
- [x] `validateProject` + `validatePlan` integrate `validateVerificationField`; integration reject cases (non-object, empty-string subfield) surface as errors
- [x] `plugin/scripts/new-project.js` accepts optional `verification` in its data shape; `renderProject` emits it as a YAML sub-object when present; skipping leaves the field absent in the output
- [x] `plugin/skills/fsd-new-project/SKILL.md` documents the new optional `verification:` prompt, format (`tests: ..., validate: ...`), and 'skip' escape
- [x] `plugin/scripts/plan.js` `SECTION_META.phases.placeholder` emits the checkbox convention `- [ ] **Phase 01** — _Phase title_` with two-digit numbering and indented steps
- [x] `plugin/skills/fsd-plan/SKILL.md` Step 4 documents the phase checkbox convention and the optional plan-level `verification:` frontmatter prompt
- [x] `plugin/scripts/plan.js` exports `checkPlanPrecondition`; returns `{ ok: true, plan: { meta, body, path, phases }, warnings }` on happy path
- [x] `checkPlanPrecondition` refuses missing plan file, archived plan, zero `- [ ] **Phase NN**` entries, zero `- [ ]` acceptance entries, missing linked spec, archived linked spec
- [x] `checkPlanPrecondition` surfaces warnings (does not refuse) when plan `status: draft` or linked spec `approved: false`
- [x] `plugin/scripts/plan-update.js` exports `parsePhases(content)` returning `[{ number, title, completed, lineIndex }]`; matches `- [ ] **Phase NN** — <title>` only; tolerates freeform prose
- [x] `plugin/scripts/plan-update.js` exports `flipPhase({ planPath, phaseNumber })`; byte-preserves non-matching lines; bumps frontmatter `updated:`; refuses when phase absent or already `[x]`
- [x] `plugin/scripts/plan-update.js` exports `flipAcceptance({ planPath, lineMatcher })`; substring-matches in `## Acceptance`; byte-preserves other lines; bumps `updated:`; refuses on no match or already `[x]`
- [x] `plan-update.js` CLI accepts `flip-phase --phase-number=NN` and `flip-ac --line-matcher=...`, returning `{ ok, written?, reason? }` JSON
- [x] `plugin/skills/fsd-execute-plan/SKILL.md` exists with frontmatter `name: fsd-execute-plan`, `argument-hint: [plan-id]`, and a description ≥ 20 chars mentioning plan consumption, phase checkboxes, per-phase verification, full-pipeline close-out, no auto-commit
- [x] Skill Step 1 documents the PROJECT.md precondition (abort, no chain-invoke), argument handling (required positional; list-and-ask when omitted), and the `checkPlanPrecondition` branch handling (refuse vs warn)
- [x] Skill Step 2 documents the pre-flight summary content (title, phases list, verification commands + source, version target, linked spec, linked FSD task, CHANGELOG flag, ARCHITECTURE.md presence) and the single yes/no gate
- [x] Skill Step 3 documents the phase execution loop: `TaskCreate` per phase, verification discovery order (phase hint > plan FM > PROJECT.md > ask), stop-on-failure, progressive checkbox flips via `flip-phase`, ADR scratch-list capture
- [x] Skill Step 4 documents AC walkthrough: evidence requirement, progressive checkbox flips via `flip-ac`, the "All criteria verified YYYY-MM-DD" header insertion
- [x] Skill Step 5 documents the single ACK gate covering all five close-out ops (CHANGELOG, version align, todo.md flip, plan archive, spec approve) plus the ADR append sub-flow; no silent application
- [x] Skill Step 6 documents the no-auto-commit handoff and the commit-boundary surface from the plan body
- [x] Skill Guardrails section forbids: skipping the yes/no gate, proceeding past failed verification, flipping checkboxes without evidence, editing plan body / AC text, auto-committing, auto-pushing, destructive git ops, applying close-out without ACK, bumping unnamed versions, silent ADR writes, dropping the spec check, executing archived plans
- [x] Engineer invoking `/fsd-execute-plan` with no arg sees a list of non-archived plans (CLI-level verification via fixture with two plans)
- [x] Skill with an arg resolving to an archived plan aborts with the "unarchive via `/fsd-plan-update`" pointer
- [x] `plugin/tests/test-fsd-execute-plan.js` covers SKILL.md sanity, all 6 steps documented, guardrails enumerated, all four refusal paths
- [x] `plugin/tests/test-plan.js` covers `checkPlanPrecondition` happy path + all refuse paths + both warning paths + the phases placeholder render
- [x] `plugin/tests/test-plan-update.js` covers `parsePhases`, `flipPhase`, `flipAcceptance`, plus their CLI ops
- [x] `plugin/tests/test-validator.js` covers `validateVerificationField` and its integration into `validateProject` / `validatePlan`
- [x] `plugin/tests/test-project-context.js` covers `verification:` propagation through `loadProjectContext.meta` + invalid-shape rejection
- [x] `plugin/tests/test-fsd-new-project.js` covers the interview flow capturing and skipping `verification:`
- [x] `plugin/tests/test-fsd-plan.js` covers the phase checkbox placeholder and the documented frontmatter prompt
- [x] `README.md` Commands section documents `/fsd-execute-plan [plan-id]` with cross-refs to `/fsd-plan` and `/fsd-plan-update`
- [x] `README.md` Project Context section documents the `verification:` frontmatter field on PROJECT.md with a worked example including plan-level override
- [x] `README.md` Artifact Schemas section documents the phase checkbox convention and the `adr:` chat-prefix mid-execution mechanic
- [x] `CHANGELOG.md` has a `[0.12.0] - YYYY-MM-DD` entry with Added / Changed / Compatibility / Out-of-scope subsections
- [x] Version sources aligned at 0.12.0: `plugin/.claude-plugin/plugin.json`, README header, CHANGELOG `[0.12.0]` entry
- [x] Full test suite stays green after the task (test file count increases by 1: `test-fsd-execute-plan.js`; existing files extended not replaced)

## Decisions locked by user (pre-execution)

1. **Scope — (c) full-pipeline.** Status flip, spec approve, todo.md flip, version bump, CHANGELOG, optional ARCHITECTURE.md ADR append. All behind one final ACK.
2. **Phase tracking — (i) inline `- [ ] **Phase NN**` checkboxes.** Two-digit zero-padded. `/fsd-plan` retrofit to emit this format.
3. **Execution gate — (a) dive straight in.** No `EnterPlanMode`. One pre-flight summary + yes/no prompt.
4. **Verification cadence — (b) per-phase + final full-suite.** Regression check once more at end.
5. **Commit boundary — (c) no auto-commit.** Engineer owns the release boundary. Matches `/fsd-do-task`.
6. **Pipeline close-out — all five ops enabled, single ACK gate.** ADR append is opt-in; mid-execution notes collected via `adr:` chat prefix.
7. **Verification discovery — (d) hybrid.** Phase body hint > plan frontmatter > PROJECT.md > ask engineer. `/fsd-new-project` retrofit in-scope for this task.
8. **PROJECT.md + plan schema — additive `verification:` frontmatter object.** Optional subfields `tests?, validate?, typecheck?, lint?`. No breaking change.
9. **Argument handling.** `/fsd-execute-plan <plan-id>` required positional; list-and-ask when omitted.
10. **Refuse conditions.** Plan missing / archived / no-phases / no-ACs / missing-spec / archived-spec all hard-abort. Draft plan / unapproved spec are soft warnings.
11. **ADR collection mechanic.** Engineer surfaces ADRs mid-execution with `adr: <title>` chat prefix. Context/Decision/Consequences gathered at end-of-run.
12. **`checkPlanPrecondition` placement.** In `plan.js` next to `checkSpecPrecondition`.
13. **Plan status semantics.** Successful completion → `archived`. Intermediate `active` not auto-applied.
14. **Version bump — 0.11.0 → 0.12.0.** Minor additive.
