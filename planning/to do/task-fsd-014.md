# FSD-014 — `/fsd-spec-update` skill: edit existing spec artifacts

## Source
Own backlog. Deferred from FSD-006 (out-of-scope: "editing existing specs, flipping `approved`, archiving, superseding — future `/fsd-spec-update`"). Captured as FSD-014 immediately after FSD-006 shipped so the design context doesn't rot. Pairs with `/fsd-spec` as the "create once, edit many" edit surface, mirroring the `/fsd-new-project` + `/fsd-roadmap` pairing that FSD-005/007 established.

## Summary

Add the ongoing-edits counterpart to `/fsd-spec`. A subcommand-style skill dispatching four surgical operations — `update`, `approve`, `archive`, `supersede` — against existing `.fsd/<structure.spec>/<id>.md` artifacts. Each op parses the target spec, applies a single change, re-validates via `validateSpec`, and writes atomically while preserving user-authored prose in untouched sections byte-for-byte (same discipline `/fsd-roadmap`'s ops ship). Completion-state fields (`approved`, `status: archived`) and cross-spec lineage (`supersedes`) are managed through dedicated idempotent ops; granular edits (title, status draft↔active, related/tags add/remove, body-section rewrite) go through `update`. Schema is unchanged — FSD-004's `validateSpec` already supports every field this skill edits.

## Assessment

**Current state:**
- `validateSpec` (`plugin/scripts/validator.js:184`) already accepts the full frontmatter surface this skill needs to edit: `status` (enum), `approved` (boolean via `isBooleanish`), `supersedes` (array of kebab-case), `related` (array of `CROSS_REF`), `tags` (array of kebab-case), `title` (non-empty string), `updated` (ISO date). No validator changes are required.
- `plugin/scripts/spec.js` (FSD-006) has `renderSpec` for create and `resolveSpecPath` for path resolution. It does NOT have a parser or edit helpers — `writeSpecFile` always writes from scratch. The edit path needs its own module.
- The closest architectural analog is `plugin/scripts/roadmap.js` (FSD-007), which implements surgical edits via `parseRoadmap` + `rewriteFrontmatter` + per-op splice helpers + `writeRoadmapAtomic` (tmp + rename). That pattern is battle-tested by 25 tests; this task mirrors it for specs.
- `scanArtifacts({ fsdDir, kind: 'spec', dirName })` in `plugin/scripts/loader.js:210` is the on-demand scanner; `/fsd:validate --artifacts --specs` already surfaces spec files. Post-edit round-trip through this scanner must continue to return `validation.valid === true`.
- No existing specs live in this repo (none created since `/fsd-spec` shipped today). Tests therefore rely on fixtures created via `writeSpecFile` at test time — same fixture pattern as `test-fsd-spec.js`.

**What needs to exist:**
- A new backing module `plugin/scripts/spec-update.js` with a parser, per-op edit helpers, and a CLI entry point. Separate file (not an extension of `spec.js`) because `spec.js` is the create surface and the edit surface has a different shape — mirrors how `roadmap.js` is its own file rather than part of `new-project.js`.
- A `/fsd-spec-update` skill at `plugin/skills/fsd-spec-update/SKILL.md` dispatching subcommands, asking missing args one at a time, previewing before writing.
- Tests for the backing module (parser + all 4 ops + round-trip + byte-preservation + idempotency + atomicity) and a thin integration test for the skill + CLI.
- Docs + CHANGELOG + version bump (0.8.0 → 0.9.0).

**Locked decisions (gathered during plan-mode interview):**
- **Operation surface (v1):** `update`, `approve`, `archive`, `supersede`. Four ops only. Out of scope for v1 and flagged for follow-up: `unapprove`, `unarchive`, `rename-id` (file rename), mass/batch operations, edit history/audit log.
- **`update` sub-surface:** pick one target from — `title`, `status` (draft ↔ active, NOT archived), `related` (add/remove one entry), `tags` (add/remove one entry), or one of the six body sections (Problem / Goals / Non-goals / Requirements / Acceptance / Open questions). Excluded from `update`: `id` (rename), `approved` (use `approve`), `status: archived` (use `archive`), `project` (read-only, auto-injected), `created` (historical).
- **`supersede` behavior:** requires both specs exist; adds `old-id` to new spec's `supersedes:` array AND flips old spec's `status` to `archived`; bumps `updated:` on both. Preview-both-before-write; best-effort-atomic — if the second rename fails, restore the first from an in-memory backup.
- **Idempotency:** `approve` / `archive` / `supersede` are idempotent. Re-running returns `{ ok: true, written: false, reason: "…" }`. `update` with an unchanged value is a no-op with the same shape. `update` add-to-array with a duplicate entry is a no-op. `update` remove-from-array on a missing entry is an error (don't silently succeed).
- **Preservation guarantee:** body sections untouched by the op are preserved byte-for-byte — exactly the guarantee `roadmap.js` provides for goal prose. Tested.
- **Version bump:** 0.8.0 → 0.9.0 (minor, additive skill + module).

**Out of scope** (flagged for follow-up):
- `rename-id` (physically renames the file + updates frontmatter `id:` + rewrites any other spec/plan/research with a `supersedes:` or `related:` pointing at the old id). Requires cross-file reference rewriting; follow-up FSD.
- `unapprove` (flip `approved: true` → false) and `unarchive` (flip `status: archived` → active). Can add later if actual usage demands them; strict one-way ops keep the mental model clean for v1.
- Edit history / audit log — no append-only log of who-edited-what.
- Mass ops — editing many specs at once (e.g., "retag all specs with `legacy`"). Script loop is always available if needed.
- Cross-file reference resolution on `related:` and `supersedes:` — mirrors FSD-004/005/006/007 stance: format-only validation.

## Plan

**Phase A — Parser + editor helpers in `plugin/scripts/spec-update.js` (new file)**

1. Create `plugin/scripts/spec-update.js`. Exports (at minimum):
   - `parseSpec(content)` — returns `{ lines, frontmatter, frontmatterLines: [start, end], bodyStart, titleLine, sections: [{ id, heading, headingLine, range: [startLine, endLineExclusive], bodyContent }] }`. Section ids map to the canonical SECTION_ORDER from `spec.js` (`problem`, `goals`, `non_goals`, `requirements`, `acceptance`, `open_questions`) via heading normalization (lowercase + underscore); unknown headings are tolerated (captured as sections with `id: null`) so user-authored extra `##` blocks survive edits.
   - `readSpec(specPath)` — `fs.readFileSync` + `parseSpec`.
   - `writeSpecAtomic(specPath, newContent)` — parse + `validateSpec` on new frontmatter + tmp-write + rename; on any failure returns `{ ok: false, reason }` with the on-disk file unchanged.
   - `rewriteFrontmatter(originalLines, frontmatterRange, updates)` — preserves original key order, inserts/updates `updated:` = today, returns the new line array. Re-uses the same algorithm `roadmap.js` ships.
   - `today()` helper (same shape as `spec.js` / `roadmap.js`).

2. Parsing rules:
   - Frontmatter is the first `---\n…\n---` block; body starts on the line immediately after.
   - `# <title>` is the title line (first `^#\s+` heading after frontmatter).
   - Section boundaries: `/^##\s+(.+)\s*$/`. Each section extends until the next `##` heading or EOF.
   - Section id canonicalization: lowercase heading, replace spaces/hyphens with underscore, then match against `SECTION_ORDER`. Everything that doesn't match is kept with `id: null` (still spliceable by heading name, just not by canonical id).

**Phase B — Operation functions in `plugin/scripts/spec-update.js`**

3. Each op takes `{ specPath, ... }` (or `{ projectPath, config, ... }` for cross-file ops) and returns `{ ok: boolean, reason?: string, written?: boolean, ... }`. All ops:
   - Read + parse (refuses if the file doesn't exist).
   - Apply the change in-memory.
   - Set frontmatter `updated:` to today.
   - Call `writeSpecAtomic` (which re-validates before writing).

4. `update({ specPath, target, ...args })` — dispatch table:
   - `target === 'title'` → `args.value` (non-empty string); rewrite frontmatter `title:` and the top-level `# <title>` body heading in one edit.
   - `target === 'status'` → `args.value` ∈ `{ 'draft', 'active' }` (refuses `archived` with a pointer to the `archive` op; refuses unknown values with enum error).
   - `target === 'related'` → `args.action` ∈ `{ 'add', 'remove' }`, `args.value` must match `CROSS_REF`. Add dedups (already-present → `{ ok: true, written: false }`); remove errors if the entry isn't present.
   - `target === 'tags'` → same shape as related but validates against `KEBAB_CASE`.
   - `target === 'section'` → `args.sectionId` ∈ `SECTION_ORDER`; `args.content` is the new body content (trimmed, must be non-empty; placeholder revert is a separate "reset" affordance — not in v1). Rewrites only that section's body; heading + other sections + frontmatter preserved byte-for-byte.
   - Any unchanged edit (e.g., setting status to the same value, rewriting a section to identical content) returns `{ ok: true, written: false, reason: "no change" }`.

5. `approve({ specPath })`:
   - If frontmatter already has `approved: true` → return `{ ok: true, written: false, reason: "already approved" }` (idempotent).
   - Otherwise set `approved: true` (insert the key if absent, preserving key order around it).

6. `archive({ specPath })`:
   - If frontmatter `status === 'archived'` → return `{ ok: true, written: false, reason: "already archived" }`.
   - Otherwise flip `status:` to `archived`.

7. `supersede({ projectPath, config, newId, oldId })`:
   - Resolve both paths via `resolveSpecPath` (imported from `spec.js`). Refuses if either file doesn't exist.
   - Parse both. Compute both updated contents in memory:
     - New spec: add `oldId` to `supersedes:` (create the array if absent; dedup if already present — mark as "no-op on that half"); bump `updated:`.
     - Old spec: flip `status: archived` if not already; bump `updated:`.
   - If BOTH halves are no-ops (already superseded + already archived) → return `{ ok: true, written: false, reason: "already superseded + archived" }`.
   - Validate both via `validateSpec` before touching disk. On either failure → return `{ ok: false, reason }` and abort.
   - Write new spec first (tmp + rename). If that fails → `{ ok: false, reason }` with no disk changes.
   - Keep a string backup of new spec's original content in memory. Write old spec second.
   - If the second write fails, restore new spec from the in-memory backup (best-effort atomicity) and return `{ ok: false, reason: "supersede half-failed; restored new spec" }`.

8. CLI entry point at the bottom of `spec-update.js`:
   ```
   node scripts/spec-update.js <projectPath> <op> --id=<spec-id> [--key=value ...]
   ```
   where `op` ∈ `update | approve | archive | supersede`. For `supersede`, the args are `--new-id=<new-id> --old-id=<old-id>` (no top-level `--id`). Prints a single line of JSON and exits 0 on success, 1 on op failure, 2 on usage error. Mirrors `roadmap.js`'s CLI shape.

**Phase C — `/fsd-spec-update` skill at `plugin/skills/fsd-spec-update/SKILL.md`**

9. SKILL.md structure (mirror `fsd-roadmap` style — subcommand dispatch):
   - **Step 1: Parse the op from `$ARGUMENTS`.** Accept `update | approve | archive | supersede`. Show a usage block if the token is missing or unrecognized. Resolve `projectPath` = `<cwd>/.fsd`.
   - **Step 2: Gather missing args one question at a time. Per op:**
     - `update`: id → target (menu: title/status/related/tags/section) → per-target follow-up (new value; for related/tags: action + value; for section: which of the six + new content).
     - `approve`: id.
     - `archive`: id.
     - `supersede`: new-id → old-id.
   - **Step 3: Show a preview of the change.** For frontmatter edits, show the before/after of the affected fields. For section rewrites, show the new section content in a fenced block. For `supersede`, show both specs' diffs. Ask "apply? (yes/no)".
   - **Step 4: On confirmation, invoke `spec-update.js` via `node -e` or the CLI entry point.**
   - **Step 5: On success, print a one-line confirmation (op + id + what changed). On failure, relay the reason verbatim.**
   - **Guardrails section** — never touch PROJECT.md/ROADMAP.md, always re-validate, one question at a time, never auto-commit, never rename the file (no `rename-id` op in v1), always show preview before writing.

**Phase D — Tests**

10. New `plugin/tests/test-spec-update.js` (unit/integration of the backing module, target ≥30 tests):
    - **Parser:** minimal spec, spec with all 6 standard sections, spec with a user-authored extra `##` section (unknown id tolerance), malformed frontmatter rejection.
    - **`update` title:** rewrites both frontmatter `title:` and body `# <title>` heading in one edit; preserves sections byte-for-byte.
    - **`update` status:** draft ↔ active happy paths; refuses `archived` with a pointer to `archive`; refuses unknown enum.
    - **`update` related:** add dedups; remove errors on missing; validates `CROSS_REF` on add.
    - **`update` tags:** same shape as related but validates `KEBAB_CASE`.
    - **`update` section:** rewrites target section; other 5 sections + frontmatter byte-preserved (dedicated byte-preservation test).
    - **`approve`:** happy path; idempotent (`written: false`) on already-approved.
    - **`archive`:** happy path; idempotent on already-archived.
    - **`supersede`:** happy path (adds to `supersedes:` + archives old); refuses if either id doesn't exist; idempotent if already superseded + already archived; half-idempotent paths (already-in-supersedes but old-not-archived; old-archived but not-in-supersedes); rollback test (inject failure on second write → first write restored from backup).
    - **Round-trip:** after each op the result passes `validateSpec` AND `scanArtifacts({ kind: 'spec' })` returns `validation.valid === true`.
    - **Atomicity:** on injected validation failure (e.g. setting title to an empty string), the file on disk is byte-unchanged.
    - **Every op updates `updated:`.**
    - **CLI entry:** two integration tests via `execFileSync` against a fixture — one happy path per op; usage/failure exit codes.

11. New `plugin/tests/test-fsd-spec-update.js` (integration + SKILL.md sanity, ~6 tests):
    - Exercise each op through the CLI entry point via `execFileSync` against a throwaway fixture.
    - Assert SKILL.md exists, advertises `name: fsd-spec-update`, cross-references `/fsd-spec` as the creation path, and documents all four ops by name.

**Phase E — Docs + release**

12. README:
    - Commands section: add `### /fsd-spec-update` with a per-op table (mirror `/fsd-roadmap`'s format) and a one-line "edits existing specs; refuses if the spec doesn't exist".
    - Project Context / "create once, edit many" framing: point out that the spec pair is now `/fsd-spec` (create) + `/fsd-spec-update` (edit), matching the `/fsd-new-project` + `/fsd-roadmap` pairing.
13. CHANGELOG: new `[0.9.0] - YYYY-MM-DD` entry under `Added` (backing module + 4 ops + skill + tests + docs), `Compatibility` (additive; no schema change; all existing `/fsd-spec` output works unmodified), and `Out of scope` (unapprove/unarchive, rename-id, mass ops, audit log).
14. `plugin/.claude-plugin/plugin.json` → `0.9.0`. README header → `0.9.0`.
15. Three logical commits (mirror FSD-006/007 pattern):
    - `feat(spec-update): parser + 4 ops (update, approve, archive, supersede)`
    - `feat: /fsd-spec-update skill for editing spec artifacts`
    - `chore(release): v0.9.0 — /fsd-spec-update skill + spec update ops`
16. Push to `origin/main` is **NOT** part of this task — hand off to user per skill guardrails.

## Acceptance Criteria

All criteria verified 2026-04-24 before commit.

- [x] `plugin/scripts/spec-update.js` exists and exports `parseSpec`, `readSpec`, `writeSpecAtomic`, `rewriteFrontmatter`, `update`, `approve`, `archive`, `supersede`, `today`
- [x] `parseSpec` records line ranges for frontmatter, title, and each body section; tolerates user-authored extra `##` headings (captured as sections with `id: null`, still spliceable)
- [x] Each op returns `{ ok: boolean, reason?, written? }` and either writes the file atomically or leaves it unchanged
- [x] `update` target `title` rewrites frontmatter `title:` AND the body `# <title>` heading in one edit; other sections + frontmatter preserved byte-for-byte
- [x] `update` target `status` accepts `draft` and `active`; refuses `archived` with a pointer to the `archive` op; refuses any other value
- [x] `update` target `related` adds a new entry (dedupped) or removes an existing entry; rejects non-`CROSS_REF` values on add; errors on remove of a missing entry
- [x] `update` target `tags` accepts the same add/remove shape as related but validates against `KEBAB_CASE`
- [x] `update` target `section` rewrites one of the six canonical sections (Problem / Goals / Non-goals / Requirements / Acceptance / Open questions); other 5 sections + frontmatter preserved byte-for-byte (covered by a dedicated byte-preservation test)
- [x] `update` with an unchanged value returns `{ ok: true, written: false, reason: "no change" }`
- [x] `approve` flips frontmatter `approved: true`; is idempotent — re-running on an already-approved spec returns `{ ok: true, written: false, reason: /already approved/i }` and does not touch disk
- [x] `archive` flips frontmatter `status: archived`; idempotent when already archived
- [x] `supersede` adds `oldId` to new spec's `supersedes:` array AND flips old spec's `status: archived`; bumps `updated:` on both
- [x] `supersede` refuses cleanly if either spec doesn't exist (no partial writes)
- [x] `supersede` is idempotent when the new spec already lists the old id in `supersedes:` AND the old spec is already archived; returns `{ ok: true, written: false, reason: /already superseded/i }`
- [x] `supersede` best-effort rollback: on injected failure during the second write, the first write is restored from an in-memory backup (covered by a rollback test)
- [x] Every op updates frontmatter `updated:` to today's date
- [x] Every op re-validates the rendered frontmatter via `validateSpec` before writing; on failure the file on disk is byte-unchanged (atomicity test)
- [x] After every op, `scanArtifacts({ fsdDir, kind: 'spec', dirName })` returns the target spec with `validation.valid === true` (round-trip verified in tests)
- [x] `/fsd-spec-update` skill at `plugin/skills/fsd-spec-update/SKILL.md` passes `/fsd:validate --skills`, dispatches 4 subcommands, gathers missing args one question at a time, shows a preview before writing
- [x] Skill refuses to run an op on a spec that doesn't exist; points at `/fsd-spec` as the creation path
- [x] Skill supports CLI entry point for scripted invocation; exit code 0 on success, 1 on op failure, 2 on usage error (mirrors `roadmap.js`'s shape)
- [x] New `plugin/tests/test-spec-update.js` covers parser + all 4 ops + round-trip validation + byte-preservation + idempotency + atomicity (≥30 tests)
- [x] New `plugin/tests/test-fsd-spec-update.js` covers CLI integration for each op + SKILL.md sanity (name, cross-reference to `/fsd-spec`, all 4 ops named)
- [x] README Commands section documents `/fsd-spec-update <op>` with a per-op table; Project Context framing updated to call out the create+edit pair for specs
- [x] CHANGELOG `[0.9.0]` entry added under Added + Compatibility + Out-of-scope; `plugin.json` and README header both at `0.9.0`
- [x] No regression: full test suite stays green (≥18 test files passing — previously 16 after FSD-006)

## Decisions locked by user (pre-execution)

1. **Operation surface** — `update`, `approve`, `archive`, `supersede`. `unapprove` / `unarchive` / `rename-id` / mass ops / audit log are all out of scope for v1.
2. **`update` sub-surface** — surgical: pick one target from `title`, `status` (draft ↔ active), `related` (add/remove one), `tags` (add/remove one), or one of the six body sections. Excluded: `id`, `approved`, `status: archived`, `project`, `created`.
3. **`supersede` behavior** — adds to new spec's `supersedes:` + archives old spec + bumps `updated:` on both. Preview-both-before-write; best-effort rollback on second-write failure.
4. **Idempotency** — `approve` / `archive` / `supersede` and `update` with unchanged values all return `{ ok: true, written: false }` on re-run. Array-remove on a missing entry errors (not silent-success).
5. **Preservation guarantee** — sections untouched by an op are preserved byte-for-byte (dedicated test).
6. **Version bump** — 0.8.0 → 0.9.0 (minor, additive).

## Relationship to other tasks

- **Pairs with FSD-006** — that task shipped `/fsd-spec` (create-only, refuses to overwrite). This task supplies the ongoing-edits surface FSD-006 explicitly deferred.
- **Mirrors FSD-005 + FSD-007** — those established the "create once, edit many" pattern for project context (`/fsd-new-project` + `/fsd-roadmap`). This task extends the same pattern to specs.
- **Reuses FSD-007's edit discipline** — `spec-update.js`'s parser + edit helpers + `writeSpecAtomic` mirror `roadmap.js`'s `parseRoadmap` + `rewriteFrontmatter` + `writeRoadmapAtomic`. The byte-preservation + atomicity + idempotency guarantees are copied verbatim from that playbook.
- **No schema change from FSD-004** — `validateSpec` already supports every frontmatter field this skill edits (`status`, `approved`, `supersedes`, `related`, `tags`, `title`, `updated`). This is an additive skill and scripts module.
- **Unblocks future `/fsd-plan` + `/fsd-research` editors** — `plan-update` and `research-update` are natural follow-ups (separate FSDs) that will mirror this skill's shape for their respective storage kinds.
