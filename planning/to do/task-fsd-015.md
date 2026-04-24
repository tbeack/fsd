# FSD-015 — `/fsd-plan-update` skill: edit existing plan artifacts

## Source

Own backlog. Deferred from FSD-008 (out-of-scope: "editing existing plans, flipping status, appending phases, adding `depends_on:` entries, archiving stale plans. Separate future FSD"). Captured as FSD-015 the same day FSD-008 shipped so the design context doesn't rot. Pairs with `/fsd-plan` as the "create once, edit many" edit surface, mirroring the `/fsd-spec` + `/fsd-spec-update` pairing that FSD-006/014 established and the `/fsd-new-project` + `/fsd-roadmap` pairing FSD-005/007 established before that.

## Summary

Add the ongoing-edits counterpart to `/fsd-plan`. A subcommand-style skill dispatching three surgical operations — `update`, `archive`, `supersede` — against existing `.fsd/<structure.plan>/<id>.md` artifacts. Each op parses the target plan, applies a single change, re-validates via `validatePlan`, and writes atomically while preserving user-authored prose in untouched sections byte-for-byte (same discipline `/fsd-roadmap`'s and `/fsd-spec-update`'s ops ship). Completion-state (`status: archived`) and cross-plan lineage (`supersedes`) are managed through dedicated idempotent ops; granular edits (title, status draft↔active, related/tags add/remove, `task` set/clear, `depends_on` add/remove, `estimate` set/clear, body-section rewrite) go through `update`. Requires a one-line validator extension to add `supersedes` as an optional kebab-case array on plans (mirrors the existing spec schema).

## Assessment

**Current state:**

- `validatePlan` (`plugin/scripts/validator.js:203`) accepts the full frontmatter surface this skill needs, minus `supersedes`: `project`, `id` (kebab-case), `title` (non-empty), `status` (enum), `created` (ISO date), `updated` (ISO date), `tags` (kebab-case array), `related` (`CROSS_REF` array), `task` (non-empty string), `depends_on` (kebab-case array), `estimate` (non-empty string). Needs a one-line addition: optional `supersedes` array, validated exactly like `validateSpec.supersedes` does (`isStringArrayMatching(v, KEBAB_CASE)`).
- `plugin/scripts/plan.js` (FSD-008, commit `b07fc8b`) has `renderPlan` for create, `writePlanFile` for create-with-spec-hard-require, `resolvePlanPath` for path resolution, `checkSpecPrecondition` for spec-status gating, and `SECTION_ORDER = ['context', 'approach', 'phases', 'risks', 'acceptance', 'open_questions']`. It does NOT have a parser or edit helpers — `writePlanFile` always writes from scratch. The edit path needs its own module.
- The closest architectural analog is `plugin/scripts/spec-update.js` (FSD-014), which implements surgical edits via `parseSpec` + `rewriteFrontmatter` + per-op splice helpers + `writeSpecAtomic` (tmp + rename). That pattern is battle-tested by 32 `test-spec-update.js` tests; this task mirrors it directly for plans. `spec-update.js` also imports `rewriteFrontmatter` and `canonicalSectionId` patterns from `roadmap.js` — same lineage.
- `scanArtifacts({ fsdDir, kind: 'plan', dirName })` in `plugin/scripts/loader.js:210` is the on-demand scanner; `/fsd:validate --artifacts --plans` already surfaces plan files. Post-edit round-trip through this scanner must continue to return `validation.valid === true`.
- No existing plans live in this repo (none created since `/fsd-plan` shipped in the same session). Tests rely on fixtures created via `writePlanFile` at test time — same fixture pattern as `test-fsd-plan.js`.

**What needs to exist:**

1. One-line extension to `validatePlan` adding optional `supersedes` (kebab-case array). Mirror `validateSpec.supersedes` byte-for-byte.
2. A new backing module `plugin/scripts/plan-update.js` with a parser, per-op edit helpers, and a CLI entry point. Separate file (not an extension of `plan.js`) because `plan.js` is the create surface and the edit surface has a different shape — mirrors how `spec-update.js` is its own file rather than part of `spec.js`.
3. A `/fsd-plan-update` skill at `plugin/skills/fsd-plan-update/SKILL.md` dispatching subcommands, asking missing args one at a time, previewing before writing.
4. Tests for the backing module (parser + all 3 ops + round-trip + byte-preservation + idempotency + atomicity) and a thin integration test for the skill + CLI.
5. Docs + CHANGELOG + version bump (0.10.0 → 0.11.0).

**Locked decisions (gathered during plan-mode interview):**

1. **Operation surface (v1):** `update`, `archive`, `supersede`. Three ops. Out of scope for v1 and flagged for follow-up: `unarchive`, `rename-id` (file rename), mass/batch operations, edit history/audit log.
2. **`update` sub-surface:** pick one target — `title` (set), `status` (draft ↔ active; refuses `archived` with pointer to `archive` op), `related` (add/remove one; `CROSS_REF`-validated), `tags` (add/remove one; `KEBAB_CASE`-validated), `task` (set non-empty string / clear removes key), `depends_on` (add/remove one; `KEBAB_CASE`-validated), `estimate` (set non-empty string / clear removes key), or `section` (rewrite one of the six canonical body sections; content must be non-empty). Excluded: `id` (rename), `status: archived` (use `archive`), `supersedes` (use `supersede`), `project` (read-only, auto-injected), `created` (historical).
3. **`supersede` behavior:** requires both plans exist; adds `oldId` to new plan's `supersedes:` array AND flips old plan's `status` to `archived`; bumps `updated:` on both. Preview-both-before-write; best-effort-atomic — if the second rename fails, restore the first from an in-memory backup. Idempotent when both halves are already applied.
4. **Idempotency:** `archive` and `supersede` are idempotent. Re-running returns `{ ok: true, written: false, reason: "…" }`. `update` with an unchanged value is a no-op with the same shape. `update` add-to-array with a duplicate entry is a no-op. `update` remove-from-array on a missing entry is an error (don't silently succeed). `update` clear on an already-absent scalar is a no-op.
5. **Preservation guarantee:** body sections untouched by the op are preserved byte-for-byte — exactly the guarantee `spec-update.js` provides for spec body prose. Tested.
6. **Validator extension:** `validatePlan` gains optional `supersedes` — array of kebab-case plan ids — with the same check `validateSpec` uses (`isStringArrayMatching(v, KEBAB_CASE)`). Additive. No migration.
7. **Version bump:** 0.10.0 → 0.11.0 (minor, additive skill + module + one-line validator extension).

**Out of scope** (flagged for follow-up):

- `rename-id` (physically renames the file + updates frontmatter `id:` + rewrites any other spec/plan/research with a `supersedes:` or `related:` pointing at the old id). Requires cross-file reference rewriting; follow-up FSD.
- `unarchive` (flip `status: archived` → active). Can add later if actual usage demands it; strict one-way op keeps the mental model clean for v1. There is no `unapprove` counterpart on plans because plans have no `approved` field.
- Edit history / audit log — no append-only log of who-edited-what.
- Mass ops — editing many plans at once (e.g., "retag all plans with `legacy`"). Script loop is always available if needed.
- Cross-file reference resolution on `related:`, `depends_on:`, and `supersedes:` — mirrors FSD-004/005/006/007/008 stance: format-only validation.
- Editing the `related:` entry that carries the spec-hard-require (`spec/<id>`). `update remove-related` on the load-bearing spec link would make the plan unauthor-able by `/fsd-plan`, but the hard-require is enforced by `writePlanFile` at create time, not by the updater. v1 does NOT special-case the spec-link entry during `related` edits — engineer takes responsibility. A follow-up FSD could add a "protect spec-link" guard if real usage surfaces footguns.

## Plan

**Phase A — Validator extension**

1. Edit `plugin/scripts/validator.js:203` inside `validatePlan`. Add one block after the existing `estimate` check, modeled on `validateSpec`'s `supersedes` block:
   ```js
   if (meta.supersedes !== undefined && !isStringArrayMatching(meta.supersedes, KEBAB_CASE)) {
     errors.push('supersedes: must be an array of kebab-case plan ids');
   }
   ```
   No other validator changes. `KEBAB_CASE` and `isStringArrayMatching` are already in-scope.

**Phase B — Parser + editor helpers in `plugin/scripts/plan-update.js` (new file)**

2. Create `plugin/scripts/plan-update.js`. Exports (at minimum):
   - `parsePlan(content)` — returns `{ lines, frontmatter, frontmatterLines: [start, end], bodyStart, titleLine, sections: [{ id, heading, headingLine, range: [startLine, endLineExclusive] }] }`. Section ids map to the canonical `SECTION_ORDER` from `plan.js` (`context`, `approach`, `phases`, `risks`, `acceptance`, `open_questions`) via heading normalization (lowercase + underscore); unknown `##` headings are tolerated (captured with `id: null`) so engineer-authored extra blocks survive edits.
   - `readPlan(planPath)` — `fs.readFileSync` + `parsePlan`.
   - `writePlanAtomic(planPath, newContent)` — parse + `validatePlan` on new frontmatter + tmp-write + rename; on any failure returns `{ ok: false, reason }` with the on-disk file unchanged.
   - `rewriteFrontmatter(originalLines, frontmatterRange, updates)` — preserves original key order, inserts/updates `updated:` = today, returns the new line array. Re-uses the same algorithm `spec-update.js` / `roadmap.js` ship. Handles both scalar edits AND block-sequence array replacement (`depends_on:` / `related:` / `tags:` / `supersedes:`) the way `spec-update.js` does.
   - `today()` helper.

3. Parsing rules (identical to `spec-update.js`):
   - Frontmatter is the first `---\n…\n---` block; body starts on the line immediately after.
   - `# <title>` is the first `^#\s+` heading after frontmatter (`titleLine`).
   - Section boundaries: `/^##\s+(.+)\s*$/`. Each section extends until the next `##` heading or EOF.
   - Section id canonicalization: lowercase heading, replace spaces/hyphens with underscore, then match against `SECTION_ORDER`. Everything that doesn't match is kept with `id: null`.

**Phase C — Operation functions in `plugin/scripts/plan-update.js`**

4. Each op takes `{ planPath, ... }` (or `{ projectPath, config, ... }` for `supersede`) and returns `{ ok: boolean, reason?: string, written?: boolean, ... }`. All ops:
   - Read + parse (refuses if the file doesn't exist).
   - Apply the change in-memory.
   - Set frontmatter `updated:` to today.
   - Call `writePlanAtomic` (which re-validates before writing).

5. `update({ planPath, target, ...args })` — dispatch table:
   - `target === 'title'` → `args.value` (non-empty string); rewrite frontmatter `title:` AND the top-level `# <title>` body heading in one edit.
   - `target === 'status'` → `args.value` ∈ `{ 'draft', 'active' }` (refuses `archived` with a pointer to the `archive` op; refuses unknown values with enum error).
   - `target === 'related'` → `args.action` ∈ `{ 'add', 'remove' }`, `args.value` must match `CROSS_REF`. Add dedups (already-present → `{ ok: true, written: false }`); remove errors if the entry isn't present.
   - `target === 'tags'` → same shape as related but validates against `KEBAB_CASE`.
   - `target === 'task'` → `args.action` ∈ `{ 'set', 'clear' }`. Set requires `args.value` to be a non-empty string. Clear removes the key from frontmatter; if already absent → no-op.
   - `target === 'depends_on'` → `args.action` ∈ `{ 'add', 'remove' }`, `args.value` must match `KEBAB_CASE`. Add dedups; remove errors if the entry isn't present.
   - `target === 'estimate'` → same shape as `task` (set non-empty string / clear removes key).
   - `target === 'section'` → `args.sectionId` ∈ `plan.SECTION_ORDER`; `args.content` is the new body content (trimmed, must be non-empty; placeholder revert is a separate "reset" affordance — not in v1). Rewrites only that section's body; heading + other sections + frontmatter preserved byte-for-byte.
   - Any unchanged edit returns `{ ok: true, written: false, reason: "no change" }`.

6. `archive({ planPath })`:
   - If frontmatter `status === 'archived'` → return `{ ok: true, written: false, reason: "already archived" }`.
   - Otherwise flip `status:` to `archived`.

7. `supersede({ projectPath, config, newId, oldId })`:
   - Resolve both paths via `resolvePlanPath` (imported from `plan.js`). Refuses if either file doesn't exist.
   - Refuses `newId === oldId` with a clear error.
   - Parse both. Compute both updated contents in memory:
     - New plan: add `oldId` to `supersedes:` (create the array if absent; dedup if already present — mark as "no-op on that half"); bump `updated:`.
     - Old plan: flip `status: archived` if not already; bump `updated:`.
   - If BOTH halves are no-ops (already superseded + already archived) → return `{ ok: true, written: false, reason: "already superseded + archived" }`.
   - Validate both via `validatePlan` before touching disk. On either failure → return `{ ok: false, reason }` and abort.
   - Write new plan first (tmp + rename). If that fails → `{ ok: false, reason }` with no disk changes.
   - Keep a string backup of new plan's original content in memory. Write old plan second.
   - If the second write fails, restore new plan from the in-memory backup (best-effort atomicity) and return `{ ok: false, reason: "supersede half-failed; restored new plan" }`.

8. CLI entry point at the bottom of `plan-update.js`:
   ```
   node scripts/plan-update.js <projectPath> <op> --id=<plan-id> [--key=value ...]
   ```
   where `op` ∈ `update | archive | supersede`. For `supersede`, the args are `--new-id=<new-id> --old-id=<old-id>` (no top-level `--id`). Prints a single line of JSON and exits 0 on success, 1 on op failure, 2 on usage error. Mirrors `spec-update.js`'s CLI shape.

**Phase D — `/fsd-plan-update` skill at `plugin/skills/fsd-plan-update/SKILL.md`**

9. SKILL.md structure (mirror `fsd-spec-update` style — subcommand dispatch):
   - **Step 1: Locate the plan.** Parse `$ARGUMENTS` — first token is the op name; subsequent tokens are `--key=value` pairs. Default plan location: `<cwd>/.fsd/<structure.plan>/<id>.md`. Refuse with a pointer to `/fsd-plan` if the target file is missing.
   - **Step 2: Parse the subcommand.** Accept exactly one of `update | archive | supersede`. Show a usage table if the token is missing or unrecognized.
   - **Step 3: Gather missing args — one question at a time.** Per op:
     - `update`: `--id=<plan-id>` plus one of the 8 targets (title / status / related / tags / task / depends_on / estimate / section) and its action/value args.
     - `archive`: `--id=<plan-id>` only.
     - `supersede`: `--new-id=<new-plan-id> --old-id=<old-plan-id>`.
   - **Step 4: Preview before applying.** Show frontmatter diff + any body-section diff for rewrite ops. For `supersede`, show BOTH plans' diffs. Ask "apply? (yes/no)".
   - **Step 5: Apply via the backing script.** Only after explicit `yes`, invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-update.js" "$(pwd)/.fsd" <op> --id=<…> [...]`. Relay the `{ ok, reason?, written? }` result verbatim.
   - **Step 6: Do not auto-commit.** Print a one-line confirmation and stop. Engineer owns the release boundary.
   - **Guardrails section** — non-negotiable rules:
     - Never create a new plan (that's `/fsd-plan`'s territory). Refuse if the target plan doesn't exist.
     - Never overwrite the file without re-validating — the backing module re-runs `validatePlan` on every write.
     - Never rewrite user-authored body prose except in the explicit `update section` op.
     - Never touch PROJECT.md, ROADMAP.md, ARCHITECTURE.md, or the linked spec.
     - Never auto-unarchive or auto-un-supersede (strict one-way ops in v1).
     - Never commit or push.
     - `update remove-related` does NOT special-case the spec-hard-require link — engineer takes responsibility for keeping the plan authorable.

**Phase E — Tests**

10. New `plugin/tests/test-plan-update.js` — target ~30 tests:
    - Parser: minimal file, all 6 canonical sections, unknown-heading tolerance, malformed frontmatter rejection.
    - `update` per target — happy path + idempotent no-op + error on missing-entry-remove. Must cover all 8 targets (title, status, related, tags, task, depends_on, estimate, section).
    - `update status` refuses `archived` with pointer to `archive` op.
    - `update task clear` / `update estimate clear` — removes key; clear on already-absent is a no-op.
    - `update depends_on add` / `update depends_on remove` — dedup on add; error on missing remove.
    - `update section` — rewrite body section, byte-preserve others, refuse unknown sectionId.
    - `archive` — happy path + idempotent when already archived.
    - `supersede` — happy path; refuses missing new or old plan; refuses `newId === oldId`; idempotent when both halves already applied; deterministic rollback test that corrupts the old plan to force second-write failure and verifies the new plan is restored from backup.
    - Every op bumps frontmatter `updated:` to today.
    - Round-trip: after every op, `scanArtifacts({ kind: 'plan' })` returns the plan with `validation.valid === true`.
    - Atomicity: on injected validation failure mid-op, the file on disk is byte-unchanged.

11. New `plugin/tests/test-fsd-plan-update.js` — target ~8 integration tests:
    - CLI update-title happy path + idempotency check.
    - CLI update-related add/remove round-trip.
    - CLI update-depends_on add/remove round-trip.
    - CLI update-task set/clear round-trip.
    - CLI archive against a missing plan (refusal).
    - CLI supersede happy path + idempotency check.
    - CLI usage error exit code (missing op or missing required args → exit 2).
    - SKILL.md sanity: frontmatter has `name: fsd-plan-update`; argument-hint documented; all three op names (`update`, `archive`, `supersede`) appear in the body; Guardrails section forbids auto-commit + spec-hard-require footgun warning present + cross-reference to `/fsd-plan` as the create surface.

12. Extend `plugin/tests/test-artifact-validator.js` — +1 test: `validatePlan` accepts valid `supersedes` array, +1 test: rejects non-kebab entries. Mirrors the existing spec supersedes tests.

**Phase F — Docs + release**

13. README:
    - **Commands section:** add `### /fsd-plan-update` with a per-op table (same shape as the `/fsd-spec-update` entry). One-liner explaining update/archive/supersede + a note that `/fsd-plan` is the create surface.
    - **Project Context section:** no changes (plan authoring already documented).
    - **Artifact Schemas section:** update the Plan-only optional fields line to mention `supersedes` alongside `task` / `depends_on` / `estimate`.
    - Version header bumped to 0.11.0.

14. CHANGELOG: new `[0.11.0] - YYYY-MM-DD` entry under Added / Changed / Compatibility / Out-of-scope. Mirror the shape of the `[0.9.0]` entry (the spec-update release).

15. `plugin/.claude-plugin/plugin.json` → `0.11.0`. README header → `0.11.0`. CHANGELOG `[0.11.0]` entry. All three version sources aligned.

16. Commit boundaries — five logical commits (mirror FSD-014's shape):
    - `feat(validator): supersedes field on validatePlan`
    - `feat(plan-update): parser + 3 ops (update, archive, supersede) + CLI`
    - `feat: /fsd-plan-update skill for editing plan artifacts`
    - `chore(release): v0.11.0 — /fsd-plan-update skill + plan update ops`

   (Four commits, not five — the validator change is tiny enough to stand alone cleanly.)

17. Push to `origin/main` is NOT part of this task — hand off to user per skill guardrails.

## Acceptance Criteria

All criteria verified 2026-04-24 before commit.

- [x] `validatePlan` in `plugin/scripts/validator.js` accepts optional `supersedes` array of kebab-case plan ids; rejects non-array, non-kebab entries (covered by new tests in `test-artifact-validator.js`)
- [x] `plugin/scripts/plan-update.js` exists and exports `parsePlan`, `readPlan`, `writePlanAtomic`, `rewriteFrontmatter`, `update`, `archive`, `supersede`, `today`
- [x] `parsePlan` recognizes all six canonical plan sections (context / approach / phases / risks / acceptance / open_questions), tolerates unknown `##` headings (captured with `id: null`), and rejects malformed frontmatter (unterminated or missing)
- [x] `rewriteFrontmatter` handles scalar edits AND block-sequence array replacement (related, tags, depends_on, supersedes) while preserving original key order; new keys append before the closing fence
- [x] `update target=title` rewrites frontmatter `title:` AND the top-level `# <title>` body heading in one edit; unchanged value → `{ ok: true, written: false }`
- [x] `update target=status` accepts only `draft` or `active`; refuses `archived` with a pointer to the `archive` op; unchanged value → `{ ok: true, written: false }`
- [x] `update target=related` with `action=add` dedups (no-op on duplicate), with `action=remove` errors when the entry is not present; value must match `CROSS_REF`
- [x] `update target=tags` has the same shape as `related` but validates against `KEBAB_CASE`
- [x] `update target=task action=set` requires a non-empty string value; `update target=task action=clear` removes the key from frontmatter; clear on already-absent → no-op
- [x] `update target=depends_on` with `action=add/remove` dedups on add and errors on missing remove; value must match `KEBAB_CASE`
- [x] `update target=estimate` has the same set/clear semantics as `task`
- [x] `update target=section` rewrites one of the six canonical plan body sections; refuses unknown `sectionId`; requires non-empty `content`; preserves other sections byte-for-byte
- [x] `archive` flips frontmatter `status: archived`; idempotent when already archived (returns `{ ok: true, written: false, reason: /already archived/ }`)
- [x] `supersede` adds `oldId` to the new plan's `supersedes:` array AND flips the old plan's `status: archived`; bumps `updated:` on both; refuses when either plan is missing; refuses `newId === oldId`; idempotent when both halves already applied
- [x] `supersede` rollback path: when the second write fails mid-op, the new plan is restored from an in-memory backup to its pre-op content (deterministic test via a file-corruption injection)
- [x] Every op bumps frontmatter `updated:` to today's date
- [x] Every op re-validates the rendered frontmatter via `validatePlan` before writing; on failure the file on disk is unchanged (atomicity via tmp + rename)
- [x] Body sections untouched by the op are preserved byte-for-byte (covered by round-trip + byte-preservation tests)
- [x] CLI entry point at the bottom of `plan-update.js` accepts `<projectPath> <update|archive|supersede> --id=<plan-id> [--key=value ...]`; prints a single-line JSON result; exits 0 on success, 1 on op failure, 2 on usage error
- [x] `/fsd-plan-update` skill at `plugin/skills/fsd-plan-update/SKILL.md` passes `/fsd:validate --skills`; frontmatter has `name: fsd-plan-update`, `argument-hint` documented, description ≥20 chars
- [x] Skill Step 1 refuses if the target plan doesn't exist and points the user at `/fsd-plan` as the create surface
- [x] Skill Step 2 documents the three ops (`update`, `archive`, `supersede`) with a usage table; unknown ops surface the table
- [x] Skill Step 3 gathers missing args one at a time — never dumps a multi-field form
- [x] Skill Step 4 shows a preview (frontmatter diff + section-body diff for `update section`; both-file diffs for `supersede`) and asks "apply? (yes/no)" before writing
- [x] Skill Step 5 delegates to the CLI via a stable shell invocation and relays `{ ok, reason?, written? }` verbatim
- [x] Skill Guardrails section explicitly forbids: creating new plans, overwriting without re-validation, rewriting body prose outside `update section`, touching PROJECT.md / ROADMAP.md / ARCHITECTURE.md / the linked spec, auto-unarchive or auto-un-supersede, auto-commit, silent special-casing of the spec-hard-require link
- [x] Round-trip: after every op, `scanArtifacts({ fsdDir, kind: 'plan', dirName })` returns the edited plan with `validation.valid === true` (covered in `test-plan-update.js`)
- [x] New `plugin/tests/test-plan-update.js` covers parser + all 3 ops (every `update` sub-target + archive + supersede happy path + supersede rollback) + round-trip + byte-preservation + idempotency + atomicity (~30 tests)
- [x] New `plugin/tests/test-fsd-plan-update.js` covers CLI-entrypoint integration for each op + CLI usage error + SKILL.md sanity (name, argument-hint, ops coverage, cross-reference to `/fsd-plan`) (~8 tests)
- [x] `plugin/tests/test-artifact-validator.js` extended with +2 tests for `validatePlan.supersedes` (accept valid, reject non-kebab)
- [x] README Commands section documents `/fsd-plan-update` with a per-op table; Artifact Schemas section lists `supersedes` alongside the other plan-only optional fields
- [x] CHANGELOG `[0.11.0]` entry added under Added / Changed / Compatibility / Out-of-scope
- [x] Version sources aligned at 0.11.0: `plugin/.claude-plugin/plugin.json`, README header, CHANGELOG `[0.11.0]` entry
- [x] No regression: full test suite stays green (≥23 test files passing — previously 21 after FSD-008)

## Decisions locked by user (pre-execution)

1. **Operation surface — 3 ops.** `update`, `archive`, `supersede`. No `unarchive` in v1. No `approve` (plans have no `approved` field).
2. **`update` sub-surface — 8 targets.** title / status / related / tags / task / depends_on / estimate / section. Excludes `id` (rename), `supersedes` (use `supersede` op), `status: archived` (use `archive` op), `project` (read-only), `created` (historical).
3. **Idempotency contract.** Unchanged edits → `{ ok: true, written: false }`. Add-with-duplicate → no-op. Remove-of-missing → error. Clear-of-absent-scalar → no-op. `archive` and `supersede` idempotent.
4. **Validator extension — one line.** `validatePlan` gains optional `supersedes` (kebab-case array). Mirrors `validateSpec.supersedes` byte-for-byte.
5. **`supersede` atomicity.** Best-effort two-phase: write new plan first, keep in-memory backup, write old plan second, rollback from backup on failure.
6. **Preservation guarantee.** Body sections untouched by the op are byte-preserved. Tested.
7. **Version bump — 0.10.0 → 0.11.0.** Minor additive.

## Relationship to other tasks

- **Builds on FSD-004** — reuses the artifact schema primitives (`KEBAB_CASE`, `isStringArrayMatching`) and `scanArtifacts` round-trip.
- **Builds on FSD-006 + FSD-014** — `spec-update.js` is the direct architectural analog; this module mirrors its parser + op + CLI shape. Every pattern is battle-tested in the spec side; the plan side reuses the same discipline.
- **Builds on FSD-008** — edits plans authored by `/fsd-plan`; reuses `plan.js`'s `SECTION_ORDER` and `resolvePlanPath`; does NOT re-enforce the spec-hard-require (that's a create-time invariant on `writePlanFile`).
- **Builds on FSD-003 + FSD-013** — honors config-driven `structure.plan` directory; `/fsd-restructure` can rename it later without breaking this skill.
- **Paired with FSD-008** — `/fsd-plan` + `/fsd-plan-update` form the create-once/edit-many pair, completing the trio with `/fsd-spec` + `/fsd-spec-update` (FSD-006/014) and `/fsd-new-project` + `/fsd-roadmap` (FSD-005/007).
- **Future follow-ups** — `rename-id` op for plans (cross-file reference rewriting), `unarchive` op if real usage demands flipping archived plans back, a "protect spec-link" guard on `update remove-related`, and the analogous `/fsd-research-update` if `/fsd-research` (FSD-010) ships with a create-only surface first.
