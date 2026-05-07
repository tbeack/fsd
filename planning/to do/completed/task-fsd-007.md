# FSD-007 — `/fsd-roadmap` skill: mid-project ROADMAP.md maintenance

## Source
Own backlog. Explicit follow-up from FSD-005 (out-of-scope: "A `/fsd-roadmap` authoring skill for editing the roadmap mid-project — covered by FSD-007").

## Summary

Add the maintenance counterpart to `/fsd-new-project`. That skill writes `planning/ROADMAP.md` once and refuses to overwrite; `/fsd-roadmap` is the ongoing-edits surface. Supports five operations — add-milestone, add-phase, advance, complete-phase, bump-version — that surgically edit the file while preserving user-authored goal paragraphs. Completion is tracked via `**Status:** shipped (YYYY-MM-DD)` body markers (no schema change). Version bumps on `advance` auto-adopt the next milestone's `**Version:**` value to keep the frontmatter `version:` invariant FSD-005 established.

## Assessment

**Current state:**
- `planning/ROADMAP.md` is created by `/fsd-new-project` via `writeProjectFiles` in `plugin/scripts/new-project.js`. The render shape (see `renderRoadmap` there):
  ```
  ---
  project: ...
  id: ...
  title: ...
  status: active
  created: YYYY-MM-DD
  version: X.Y
  current_milestone: <id>
  ---

  # <title>

  ## Milestone <id>

  **Version:** X.Y
  **Name:** <name>
  **Goal:** <goal>

  ### Phase <id> — <title>

  <goal>
  ```
- `validateRoadmap` in `plugin/scripts/validator.js` enforces frontmatter: `project`, `id`, `title`, `status`, `created`, `version` (semver-like via `SEMVER_LIKE`), `current_milestone`.
- `loadProjectContext` in `plugin/scripts/loader.js` surfaces the parsed pair `{ project, roadmap, validation }` and drives the session-start header.
- No mid-project editing surface exists yet. There is no parser for the roadmap body — only the one-shot renderer in `renderRoadmap`.

**What needs to exist:**
- A parser that recognizes frontmatter + milestone/phase section boundaries without losing user prose.
- Five surgical edit operations, each of which re-validates before writing and updates the frontmatter `updated:` field.
- A subcommand-style skill that dispatches to those operations (and asks for missing args one at a time).

**Locked decisions (gathered during plan-mode interview):**
- **Operation scope:** add-milestone, add-phase, advance, complete-phase, bump-version. Out of scope for v1: rename/reorder (flagged for follow-up).
- **Completion tracking:** body markers — insert `**Status:** shipped (YYYY-MM-DD)` inside the target milestone/phase section. No schema change; `validateRoadmap` unchanged.
- **`advance` version semantics:** auto-adopt the next milestone's `**Version:**` line into frontmatter `version`. Preserves the "frontmatter tracks the currently-active milestone" invariant FSD-005 established.
- **`advance` precondition:** errors when `current_milestone` is the last one in source order. User must add the next milestone first.
- **Idempotency:** `advance` and `complete-phase` must be safe to re-run — second call detects the existing `**Status:** shipped` line and no-ops with a message instead of double-inserting.

**Out of scope** (flagged for follow-up):
- Renaming or reordering existing milestones/phases.
- Editing milestone/phase *goal* prose (users edit the file directly; the skill only adds status/structure).
- Cross-file reference resolution — e.g., checking that a phase id matches a real plan in `.fsd/plan/`. Mirrors the FSD-004/005 stance: format-only validation.
- Multi-roadmap support (still one `planning/ROADMAP.md` per repo).

## Plan

**Phase A — Parser + editor helpers in `plugin/scripts/roadmap.js` (new file)**

1. Create `plugin/scripts/roadmap.js`. Exports (at minimum):
   - `parseRoadmap(content)` — returns `{ frontmatter, frontmatterLines: [start, end], body, milestones: [{ id, range: [startLine, endLine], version, name, goalLines, shippedStatusLine | null, phases: [{ id, title, range: [startLine, endLine], shippedStatusLine | null }] }] }`. Line ranges are inclusive/exclusive pairs addressing the raw file, so every op can do surgical splices without re-rendering untouched regions.
   - `readRoadmap(roadmapPath)` — `fs.readFileSync` + `parseRoadmap`.
   - `writeRoadmapAtomic(roadmapPath, newContent)` — validates via `validateRoadmap` (extracted from the new content's frontmatter); throws before writing if validation fails; writes via `fs.writeFileSync` to a sibling `.tmp` then `fs.renameSync` for atomicity.
   - `serializeFrontmatter(meta, originalFrontmatterText)` — preserves key order from the parsed source; inserts/updates `updated:` = today.
   - `today()` — local helper (same shape as `new-project.js`).
2. Parsing rules:
   - Frontmatter is the first `---\n…\n---` block; body starts immediately after.
   - Milestone boundaries: any line matching `/^## Milestone (\S+)\s*$/`. Milestone extends until the next `## Milestone ` or EOF.
   - Phase boundaries within a milestone: `/^### Phase (\S+)(?: — (.*))?\s*$/`. Phase extends until next `### Phase ` or next `## Milestone ` or EOF.
   - `**Version:** X.Y` inside a milestone body: first match wins.
   - `**Status:** shipped (YYYY-MM-DD)` line: first match inside a milestone/phase body sets `shippedStatusLine`.

**Phase B — Operation functions in `plugin/scripts/roadmap.js`**

3. Each op takes `{ roadmapPath, ...args }` and returns `{ ok: boolean, reason?: string, written?: boolean }`. All ops:
   - Read + parse.
   - Apply the operation in-memory.
   - Set frontmatter `updated:` to today.
   - Run `validateRoadmap` on the new frontmatter; abort with `{ ok: false, reason }` on failure.
   - Call `writeRoadmapAtomic`.

4. `addMilestone({ roadmapPath, id, version, name, goal, setCurrent })`:
   - Append `## Milestone <id>` block at end of file (preserves source order: newest last).
   - Validates `id` is kebab-case or simple alphanumeric; `version` matches `SEMVER_LIKE`.
   - If `setCurrent === true`: update frontmatter `current_milestone` = id AND `version` = new milestone's version.
   - Refuses if `id` already exists.

5. `addPhase({ roadmapPath, milestoneId, id, title, goal })`:
   - Finds target milestone; refuses if not found or if a phase with `id` already exists inside it.
   - Inserts `### Phase <id> — <title>\n\n<goal>\n\n` before the first line of the next milestone (or EOF).

6. `advance({ roadmapPath })`:
   - Find the milestone matching frontmatter `current_milestone`.
   - Find the *next* milestone by source order. Error `{ ok: false, reason: "no next milestone — add one first with /fsd-roadmap add-milestone" }` if none.
   - If the current milestone already has a `**Status:** shipped (…)` line, return `{ ok: true, written: false, reason: "current milestone already marked shipped; running advance again would double-advance — no-op" }`. (Idempotent.)
   - Insert `**Status:** shipped (YYYY-MM-DD)` on the line immediately after the `## Milestone <id>` heading (conventional placement; readable at a glance).
   - Read the next milestone's `**Version:**` value; abort if absent / unparseable.
   - Update frontmatter: `current_milestone` = next milestone id, `version` = next milestone's version.

7. `completePhase({ roadmapPath, phaseId })`:
   - Locate phase across all milestones; refuses if not found.
   - If already shipped (existing `**Status:** shipped`): `{ ok: true, written: false, reason: "phase already marked shipped" }`.
   - Insert `**Status:** shipped (YYYY-MM-DD)` immediately after the `### Phase <id> — <title>` heading.

8. `bumpVersion({ roadmapPath, newVersion })`:
   - Validate `newVersion` against `SEMVER_LIKE`; refuses otherwise.
   - Refuses if the current `version` equals `newVersion` (no-op).
   - Updates frontmatter `version` only. Does NOT touch `current_milestone` or milestone body `**Version:**` lines (that's `advance`'s job; `bumpVersion` is for patch-style bumps mid-milestone).

9. CLI entry point at the bottom of `roadmap.js`:
   ```
   node scripts/roadmap.js <roadmapPath> <op> [--key=value ...]
   ```
   So the SKILL.md can delegate via a stable shell invocation. `op` ∈ `add-milestone | add-phase | advance | complete-phase | bump-version`.

**Phase C — `/fsd-roadmap` skill at `plugin/skills/fsd-roadmap/SKILL.md`**

10. SKILL.md structure (mirror `fsd-new-project` + `fsd-add-task` style):
    - **Step 1:** Resolve the roadmap path. Default `<cwd>/planning/ROADMAP.md`. Refuse with a pointer to `/fsd-new-project` if missing.
    - **Step 2:** Parse `$ARGUMENTS` first token as the subcommand. Accept `add-milestone | add-phase | advance | complete-phase | bump-version`. Show a usage block if the token is missing or unrecognized.
    - **Step 3:** Gather missing args one question at a time. Per op:
      - `add-milestone`: id, version, name, goal, setCurrent? (yes/no)
      - `add-phase`: milestoneId, id, title, goal
      - `advance`: no args
      - `complete-phase`: phaseId
      - `bump-version`: newVersion
    - **Step 4:** Show a preview of the change (frontmatter diff + new section content) and ask "apply? (yes/no)".
    - **Step 5:** On confirmation, invoke `roadmap.js` via a `node -e` call or the CLI entry point.
    - **Step 6:** On success, print a one-line confirmation and the updated frontmatter. On failure, relay the reason verbatim.
    - **Guardrails section** — never touch PROJECT.md, never rewrite goal prose, always re-validate, one question at a time, never auto-commit.

**Phase D — Tests**

11. New `plugin/tests/test-roadmap.js` (unit/integration of the backing module):
    - Parser: minimal roadmap, multi-milestone, multi-phase, shipped markers, malformed frontmatter.
    - `addMilestone`: appends; frontmatter updated when `setCurrent`; refuses duplicate id; refuses bad version.
    - `addPhase`: inserts into the right milestone without disturbing siblings; refuses duplicate phase id within milestone.
    - `advance`: happy path (marks shipped + flips frontmatter); errors when current is last; idempotent when already shipped.
    - `completePhase`: happy path; idempotent; refuses unknown phase.
    - `bumpVersion`: happy path; refuses non-semver; refuses no-op.
    - Round-trip: after each op the result passes `validateRoadmap`.
    - Byte-preservation: user-authored goal prose (including unusual whitespace) is unchanged across all ops.
    - Atomicity: on injected validation failure, the file on disk is unchanged.

12. New `plugin/tests/test-fsd-roadmap.js` (integration mirroring `test-fsd-new-project.js`):
    - Exercise each op through the CLI entry point via `execFileSync` against a throwaway fixture.
    - Assert SKILL.md exists, advertises `name: fsd-roadmap`, and references `/fsd-new-project` as the creation path.

**Phase E — Docs + release**

13. README:
    - Commands section: add `/fsd-roadmap <op>` entries (one-liner per op).
    - Project Context section: add a pointer that `/fsd-roadmap` is the maintenance path (the pair of files is now create-once + edit-many).
14. CHANGELOG: new `[0.7.0] - YYYY-MM-DD` entry under `Added` (backing module, 5 ops, skill, tests, docs) and `Compatibility` (additive; no schema change; `fsd-new-project`'s render output unchanged).
15. `plugin/.claude-plugin/plugin.json` → `0.7.0`. README header → `0.7.0`.
16. Three logical commits (mirror FSD-005 pattern):
    - `feat(roadmap): parser + 5 ops (add-milestone, add-phase, advance, complete-phase, bump-version)`
    - `feat: /fsd-roadmap skill for mid-project ROADMAP.md maintenance`
    - `chore(release): v0.7.0 — /fsd-roadmap skill + roadmap ops`
17. Push to `origin/main`.

## Acceptance Criteria

All criteria verified 2026-04-23 before commit.

- [x] `plugin/scripts/roadmap.js` exists and exports `parseRoadmap`, `readRoadmap`, `writeRoadmapAtomic`, `addMilestone`, `addPhase`, `advance`, `completePhase`, `bumpVersion`
- [x] Each op returns `{ ok: boolean, reason?, written? }` and either writes the file atomically or leaves it unchanged
- [x] `addMilestone` appends a `## Milestone <id>` block; with `setCurrent: true` it updates frontmatter `current_milestone` AND `version` (adopting the new milestone's version)
- [x] `addPhase` inserts a `### Phase <id> — <title>` block into the named milestone without disturbing other milestones; refuses duplicate phase ids within a milestone
- [x] `advance` inserts `**Status:** shipped (YYYY-MM-DD)` into the current milestone's body, flips frontmatter `current_milestone` to the next milestone, and adopts that milestone's `**Version:**` into frontmatter `version`
- [x] `advance` errors with a clear message when `current_milestone` is the last milestone in source order
- [x] `advance` and `completePhase` are idempotent — re-running on an already-shipped section returns `{ ok: true, written: false }` with a reason and does not double-insert status lines
- [x] `completePhase` inserts `**Status:** shipped (YYYY-MM-DD)` immediately after the target `### Phase <id>` heading
- [x] `bumpVersion` validates against `SEMVER_LIKE`, rejects non-semver input, and rejects a no-op bump
- [x] Every op updates frontmatter `updated:` to today's date
- [x] Every op re-validates the rendered frontmatter via `validateRoadmap` before writing; on failure the file on disk is unchanged
- [x] User-authored goal paragraphs are preserved byte-for-byte across all ops (covered by round-trip test)
- [x] `/fsd-roadmap` skill at `plugin/skills/fsd-roadmap/SKILL.md` passes `/fsd:validate --skills`, dispatches subcommands, and gathers missing args one question at a time
- [x] Skill refuses to run if `planning/ROADMAP.md` is missing; points the user at `/fsd-new-project`
- [x] New `plugin/tests/test-roadmap.js` covers parser + all 5 ops + round-trip validation + byte-preservation + idempotency + atomicity
- [x] New `plugin/tests/test-fsd-roadmap.js` covers CLI-entrypoint integration for each op + skill file sanity
- [x] README Commands section documents `/fsd-roadmap <op>` with one-liners per op; Project Context section points at `/fsd-roadmap` as the maintenance path
- [x] No regression: full test suite stays green (≥13 test files passing — previously 12 after FSD-005)
- [x] Version sources aligned at 0.7.0: `plugin.json`, README header, CHANGELOG `[0.7.0]` entry

## Decisions locked by user (pre-execution)

1. **Operation surface** — add-milestone, add-phase, advance, complete-phase, bump-version. Rename/reorder out of scope for v1.
2. **Completion tracking** — body markers (`**Status:** shipped (YYYY-MM-DD)` lines), not frontmatter arrays. No schema change.
3. **`advance` version semantics** — auto-adopts the next milestone's `**Version:**` into frontmatter `version`.
4. **`advance` precondition** — errors when `current_milestone` is the last milestone; user must `/fsd-roadmap add-milestone` first.
5. **Version bump** — 0.6.0 → 0.7.0 (minor, additive skill + scripts module).

## Relationship to other tasks

- **Pairs with FSD-005** — that task created `planning/ROADMAP.md` (write-once, refuses to overwrite). This task supplies the ongoing-edits surface that FSD-005 explicitly out-of-scoped.
- **Precedes FSD-008 / FSD-009** — once the roadmap can be updated fluidly, `/fsd-plan` and `/fsd-execute-plan` can rely on an up-to-date `current_milestone` + shipped markers to decide what to work on.
- **No schema change** — `validateRoadmap` and the render output of `fsd-new-project` are both unchanged. Existing `planning/ROADMAP.md` files in the wild (only this repo, since 0.6.0 just shipped) continue to work with no migration.
