# FSD-006 — `/fsd-spec` skill: create new spec artifacts

## Source
Own backlog. Third skill in the FSAD workflow chain established by FSD-005 (`/fsd-new-project` → **`/fsd-spec`** → `/fsd-plan` → `/fsd-execute-plan` → `/fsd-research` → `/fsd-ship`). Unblocks FSD-008 and downstream — once specs can be authored through a structured interview, `/fsd-plan` has a stable "what" to read from.

## Summary

Add a create-only skill that interviews the user for a spec's frontmatter + six body sections (Problem / Goals / Non-goals / Requirements / Acceptance / Open questions), then writes `<projectPath>/<structure.spec>/<id>.md` with validated frontmatter. Mirrors the `/fsd-new-project` model: refuses to overwrite, auto-injects `project:` from `planning/PROJECT.md`, config-aware location, atomic write with pre-validation. When PROJECT.md is missing, the skill confirms then chain-invokes `/fsd-new-project` before resuming the spec interview. Update/approve/archive/supersede operations are **out of scope for v1** — deferred to a future `/fsd-spec-update` skill.

## Assessment

**Current state:**
- `validateSpec` already exists (`plugin/scripts/validator.js:184`). Required frontmatter: `project`, `id` (kebab-case), `title`, `status`, `created`. Optional: `updated`, `tags`, `related`, `approved` (boolean), `supersedes` (array of kebab-case spec ids).
- `STORAGE_KINDS = ['spec', 'plan', 'research']` is exported from validator.js; `scanArtifacts({ fsdDir, kind, dirName })` in `plugin/scripts/loader.js:210` already reads the storage-kind dir and runs `ARTIFACT_VALIDATORS[kind]`. So post-write, `/fsd:validate --artifacts` will pick up the new spec automatically.
- `config.yaml`'s `structure.spec` (default `"spec"`) resolves the dir name via `getStructure(config).spec` in `plugin/scripts/config.js` — same pattern `/fsd:add` uses. `/fsd-restructure` can rename it; the skill must honor that.
- `loadProjectContext({ planningDir })` in `plugin/scripts/loader.js:173` returns `{ project, roadmap, validation }` from `planning/PROJECT.md` + `planning/ROADMAP.md`. Never throws. This is the read path for auto-injecting `project:`.
- Backing-module precedent: `plugin/scripts/new-project.js` (render + write + validate + refuse-to-overwrite) and `plugin/scripts/roadmap.js` (parser + 5 ops + atomic write). Either is a reasonable template; this task follows `new-project.js` since `/fsd-spec` is create-only.
- No `/fsd-spec`-shaped skill, script, or test exists yet. `.fsd/spec/` is empty in this repo.

**What needs to exist:**
- A backing module (`plugin/scripts/spec.js`) with `renderSpec(data)`, `writeSpecFile({ ... })`, and a CLI entry point.
- A skill (`plugin/skills/fsd-spec/SKILL.md`) that interviews one question at a time, handles the PROJECT.md precondition path (confirm → chain to `/fsd-new-project`), and dispatches to the backing module.
- Unit tests for the backing module + integration test for the skill surface.
- Docs + CHANGELOG entry + version bump (0.7.0 → 0.8.0).

**Locked decisions (gathered during plan-mode interview):**
- **Scope:** create-only; refuses to overwrite. Update/approve/archive/supersede are deferred to a future `/fsd-spec-update` skill (separate FSD, to be captured after this ships).
- **Body sections:** six — Problem / Goals / Non-goals / Requirements / Acceptance / Open questions.
- **Frontmatter interview fields:** `id` (suggest from title, user can override), `title`, `status` (default `draft`), `approved` (default `false`), `related` (optional, comma-separated), `tags` (optional, comma-separated kebab-case).
- **Auto-injected frontmatter:** `project:` from `planning/PROJECT.md`'s `project:` field; `created:` = today.
- **PROJECT.md precondition:**
  - **Missing** → confirm with user ("PROJECT.md not found — run `/fsd-new-project` first? (yes/no)"), on yes invoke `fsd-new-project` via the Skill tool then resume, on no abort.
  - **Invalid** (exists but `validateProject` fails) → show errors verbatim, point at `/fsd:validate` / manual fix, abort. Do NOT chain-invoke (new-project refuses to overwrite).
  - **Valid but ROADMAP.md missing** → soft warning, proceed.
- **Config-aware location:** `<projectPath>/<getStructure(config).spec>/<id>.md`. Same resolution `/fsd:add` and loader use.
- **Arguments:** optional title in `$ARGUMENTS` (e.g. `/fsd-spec artifact metadata schema`); if provided, skip the title question and derive id from it.
- **Version bump:** 0.7.0 → 0.8.0 (minor, additive skill + scripts module).

**Out of scope** (flagged for follow-up):
- Editing existing specs, flipping `approved`, archiving, superseding — future `/fsd-spec-update`.
- Cross-file reference resolution (e.g., checking that a `related:` entry like `plan/foo` points at a real plan file). Mirrors FSD-004/005/007 stance: format-only validation.
- Multi-spec batch creation.

## Plan

**Phase A — Backing module `plugin/scripts/spec.js`**

1. Create `plugin/scripts/spec.js`. Exports:
   - `renderSpec(data)` — returns the full markdown body (frontmatter + six `##` sections). Keeps the same YAML serialization helper pattern as `new-project.js` (block-sequence arrays, flat scalars).
   - `writeSpecFile({ projectPath, config, specData, planningDir })` — resolves target path via `getStructure(config).spec`, validates via `validateSpec` BEFORE touching disk, refuses to overwrite, writes atomically (tmp + rename), returns `{ ok, written?, skipped?, reason? }`.
   - `today()` helper (same shape as `new-project.js`).
   - CLI entry at the bottom: `node scripts/spec.js <projectPath> <id> --title=... [--status=draft] [--approved=false] [--related=...] [--tags=...]` accepting a JSON payload on stdin OR `--json=<path>` for richer body content. Stable invocation surface so SKILL.md can delegate via `node -e` just like `/fsd-new-project`.

2. Rendered frontmatter key order (for consistency with `renderProject` / `renderRoadmap`):
   ```
   project: <string>
   id: <kebab-case>
   title: <string>
   status: <draft|active|archived>
   created: <YYYY-MM-DD>
   approved: false                   # omitted if default; written explicitly only when user set it
   related:                          # omitted if empty
     - spec/foo
     - plan/bar
   tags:                             # omitted if empty
     - onboarding
   ```

3. Rendered body template (placeholder copy if user skips):
   ```
   ## Problem
   _What's the problem this spec addresses?_

   ## Goals
   _What this spec is trying to achieve._

   ## Non-goals
   _What this spec is deliberately NOT trying to do._

   ## Requirements
   _Falsifiable requirements the implementation must satisfy._

   ## Acceptance
   - [ ] _Verification step_

   ## Open questions
   _Unknowns to resolve before implementation._
   ```
   User-provided content replaces the placeholder verbatim; skipped sections keep the italicized placeholder so the section still exists in the file.

**Phase B — Skill `plugin/skills/fsd-spec/SKILL.md`**

4. SKILL.md structure (mirror `fsd-new-project` + `fsd-roadmap` style):
   - **Step 1: Precondition checks.**
     - Read `planning/PROJECT.md` via `loadProjectContext({ planningDir })`.
     - **Missing:** ask "PROJECT.md not found — run `/fsd-new-project` first? (yes/no)". On yes, invoke via the Skill tool (`Skill(skill: "fsd-new-project")`) and re-read after it returns. On no, abort with a one-line message.
     - **Invalid:** print `projectValidation.errors` verbatim, suggest `/fsd:validate` or manual fix, abort.
     - **Valid, ROADMAP.md missing:** print soft warning, proceed.
     - **Both present and valid:** continue.
   - **Step 2: Gather frontmatter — one question at a time.**
     1. Title — use `$ARGUMENTS` if non-empty, else ask "What's this spec called?"
     2. Id — derive kebab-case slug from title, confirm with user ("Confirm id: `<derived>` — accept / override?"). Validate against `KEBAB_CASE`.
     3. Status — "Status? (draft/active/archived — default draft)"
     4. Approved — "Approved? (yes/no — default no)"
     5. Related — "Related refs? (comma-separated `spec/…` `plan/…` `research/…`, or 'none')" — validate each against `CROSS_REF`.
     6. Tags — "Tags? (comma-separated kebab-case, or 'none')" — validate each against `KEBAB_CASE`.
   - **Step 3: Gather body sections — one question at a time.**
     1. Problem — "What's the problem? (1–3 sentences)"
     2. Goals — "What should this accomplish?"
     3. Non-goals — "What is this deliberately NOT doing? (or 'none')"
     4. Requirements — "Falsifiable requirements? (numbered or bulleted)"
     5. Acceptance — "How will we know it's done? (bullets; `- [ ]` checkboxes)"
     6. Open questions — "Any unknowns to surface? (or 'none')"
     - Fast-path: if user says "use your best judgment" / "fill it in", infer reasonably from title + PROJECT.md context and proceed.
   - **Step 4: Preview + confirm.** Print the full rendered file content, ask "write to `<resolved-path>`? (yes/no)".
   - **Step 5: Write.** On confirmation, invoke the backing module via `node -e '...'` passing the assembled payload. Relay `{ ok, reason }` verbatim on failure.
   - **Step 6: Next-step pointer.** On success: "Spec written to `<path>`. Run `/fsd:validate --artifacts` to confirm it's picked up. When `/fsd-plan` lands (FSD-008), it'll read this spec automatically."
   - **Guardrails section** — never touch PROJECT.md/ROADMAP.md, never auto-approve, never overwrite, one question at a time, `project:` injected not asked, abort on invalid id.

**Phase C — Tests**

5. New `plugin/tests/test-spec.js` (backing module unit/integration):
   - `renderSpec`: minimal data (just title/id/project/status/created), full data (all optional fields populated), placeholder preservation for skipped sections.
   - `writeSpecFile`:
     - Happy path: writes to `<projectPath>/<structure.spec>/<id>.md`, returns `{ ok: true, written: [path] }`.
     - Refuses overwrite when target file exists; returns `{ ok: false, reason: /refusing to overwrite/ }`, file on disk unchanged.
     - Pre-write validation failure (e.g., bad `id`): returns `{ ok: false, reason: /invalid frontmatter/ }`, no file written.
     - Honors `config.structure.spec` override (e.g., `specs` instead of `spec`).
     - Atomicity: inject a validation failure mid-flow → target file absent on disk.
   - Round-trip: after write, `scanArtifacts({ fsdDir, kind: 'spec', dirName })` returns the new spec with `validation.valid === true`.

6. New `plugin/tests/test-fsd-spec.js` (skill + CLI-entrypoint integration):
   - Exercise `node scripts/spec.js` CLI against a throwaway fixture project (with a valid PROJECT.md in `planning/`).
   - Assert SKILL.md exists, advertises `name: fsd-spec`, and references `/fsd-new-project` as the precondition + `/fsd-plan` as the downstream.
   - Assert the rendered spec's frontmatter `project:` field matches PROJECT.md's `project:`.

7. Extend `plugin/tests/run-tests.sh` — no changes expected; it globs `test-*.js` so the new files are picked up automatically (verify by inspection).

**Phase D — Docs + release**

8. README:
   - Commands section: add `/fsd-spec [title]` with a one-liner ("create a new spec artifact; interviews for problem/goals/requirements/acceptance, refuses to overwrite").
   - Project Context section: mention `/fsd-spec` reads `project:` from PROJECT.md, so `/fsd-new-project` is a soft prerequisite (chained on confirmation when missing).
9. CHANGELOG: new `[0.8.0] - YYYY-MM-DD` entry under `Added` (backing module + skill + tests + docs) and `Compatibility` (additive; no schema change; existing specs unaffected since none exist).
10. `plugin/.claude-plugin/plugin.json` → `0.8.0`. README header → `0.8.0`.
11. Three logical commits (mirror FSD-007 pattern):
    - `feat(spec): renderSpec + writeSpecFile backing module + CLI entry`
    - `feat: /fsd-spec skill for creating spec artifacts`
    - `chore(release): v0.8.0 — /fsd-spec skill + spec authoring module`
12. Push to `origin/main` is **NOT** part of this task — hand off to user per skill guardrails.

## Acceptance Criteria

All criteria verified 2026-04-24 before commit.

- [x] `plugin/scripts/spec.js` exists and exports `renderSpec`, `writeSpecFile`; CLI entry point accepts a JSON payload and writes the file on success
- [x] `renderSpec` produces frontmatter passing `validateSpec` for minimal input; output includes all six `##` sections (Problem / Goals / Non-goals / Requirements / Acceptance / Open questions) even when user skipped them (placeholder copy)
- [x] `writeSpecFile` resolves target path via `getStructure(config).spec` and honors config overrides (e.g. `specs` instead of `spec`)
- [x] `writeSpecFile` refuses to overwrite existing spec; returns `{ ok: false, reason: /refusing to overwrite/ }` with file on disk unchanged
- [x] `writeSpecFile` pre-validates frontmatter via `validateSpec` and returns `{ ok: false, reason: /invalid frontmatter/ }` without writing on validation failure
- [x] `writeSpecFile` auto-injects `project:` from the passed-in `planningDir`'s `PROJECT.md` and `created:` = today
- [x] `/fsd-spec` skill at `plugin/skills/fsd-spec/SKILL.md` passes `/fsd:validate --skills`, gathers frontmatter + 6 body sections one question at a time
- [x] Skill detects missing `PROJECT.md` and confirms with user before invoking `/fsd-new-project` via the Skill tool; on "no" it aborts cleanly
- [x] Skill detects invalid `PROJECT.md` (exists but `validateProject` fails) and aborts with the errors printed verbatim — does NOT chain-invoke `/fsd-new-project`
- [x] Skill proceeds with a soft warning when `PROJECT.md` is valid but `ROADMAP.md` is missing
- [x] Skill accepts optional title in `$ARGUMENTS` and derives id from it; user can override the derived id
- [x] Skill shows a preview of the full rendered file and asks confirmation before writing
- [x] After write, `scanArtifacts({ fsdDir, kind: 'spec', dirName })` returns the new spec with `validation.valid === true` (round-trip verified in test-spec.js)
- [x] New `plugin/tests/test-spec.js` covers renderSpec, writeSpecFile happy path, refuse-to-overwrite, validation-failure path, config-override path, and round-trip with `scanArtifacts`
- [x] New `plugin/tests/test-fsd-spec.js` covers CLI-entrypoint integration + skill file sanity (name, cross-references to `/fsd-new-project` and `/fsd-plan`)
- [x] README Commands section documents `/fsd-spec [title]` with a one-liner; Project Context section mentions the PROJECT.md soft-prerequisite
- [x] CHANGELOG `[0.8.0]` entry added under Added + Compatibility; `plugin.json` and README header both at `0.8.0`
- [x] No regression: full test suite stays green (≥15 test files passing — previously 14 after FSD-007)

## Decisions locked by user (pre-execution)

1. **Scope** — create-only; `/fsd-spec-update` is a separate future FSD (to be captured after this ships). Not merged into `/fsd-spec`.
2. **Body sections** — six: Problem / Goals / Non-goals / Requirements / Acceptance / Open questions.
3. **Frontmatter interview** — id / title / status (default draft) / approved (default false) / optional related / optional tags. `project:` auto-injected from PROJECT.md; `created:` = today.
4. **PROJECT.md precondition** — missing → confirm then chain-invoke `/fsd-new-project`; invalid → abort with errors; ROADMAP.md-only missing → soft warning, proceed.
5. **Config-aware location** — honors `structure.spec` via `getStructure(config)`.
6. **Arguments** — optional title; derive id; skip title question when provided.
7. **Version bump** — 0.7.0 → 0.8.0 (minor, additive).

## Relationship to other tasks

- **Builds on FSD-004** — reuses `validateSpec` + `KEBAB_CASE` / `ISO_DATE` / `CROSS_REF` primitives, `scanArtifacts` round-trip path, `STORAGE_KINDS`.
- **Builds on FSD-005** — reads `planning/PROJECT.md` via `loadProjectContext` to auto-inject `project:`; chain-invokes `/fsd-new-project` when the file is missing.
- **Builds on FSD-003 + FSD-013** — honors config-driven `structure.spec` directory, so `/fsd-restructure` can rename it later without breaking this skill.
- **Precedes FSD-008 (`/fsd-plan`)** — once specs exist with a stable schema, the planning skill can read them to derive implementation work without the user re-explaining context.
- **Future follow-up: `/fsd-spec-update` (new FSD, TBD)** — editing existing specs, flipping `approved`, archiving, superseding. Explicitly out of scope here to let the update semantics bake with real-world use first.
