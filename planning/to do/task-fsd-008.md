# FSD-008 — `/fsd-plan` skill: technical implementation planning via native plan mode

## Source

Own backlog. Fourth skill in the FSAD workflow chain established by FSD-005 (`/fsd-new-project` → `/fsd-spec` → **`/fsd-plan`** → `/fsd-execute-plan` → `/fsd-research` → `/fsd-ship`). Unblocks FSD-009 (`/fsd-execute-plan`) — once plan artifacts exist with a stable schema and reliable provenance (hard-linked to a spec, informed by project context), the execution skill has a stable "how" to read from.

## Summary

Add a **guided technical-planning skill** that an engineer drives inside Claude Code's native plan mode. The skill hard-requires a spec linkage (the engineer names a spec id in `.fsd/<structure.spec>/`, refuse if missing or archived), enters `EnterPlanMode`, reads a narrow set of context artifacts (spec + PROJECT.md + ROADMAP.md + ARCHITECTURE.md + existing plans' frontmatter + files/symbols the spec explicitly names), and conducts a Socratic discussion to fill gaps where prior context doesn't give strict guidance. At `ExitPlanMode` the engineer approves the draft, and the skill writes a plan artifact to `.fsd/<structure.plan>/<id>.md` with a 6-section body (Context / Approach / Phases / Risks / Acceptance / Open questions).

Alongside plan authoring, this FSD introduces **`planning/ARCHITECTURE.md`** as a new long-lived project-level artifact — a counterpart to PROJECT.md and ROADMAP.md that captures stack, standards, ADR-style decisions, code examples, references, glossary, and open architectural questions. `/fsd-plan` owns both its lazy creation (first run after detecting the file is missing, if the engineer opts in) and its append-on-every-run mechanic (ADR entries prepended newest-first in `## Decisions`; other sections edited in place).

Update/approve/archive/supersede for plan artifacts are **out of scope for v1** — deferred to a future `/fsd-plan-update` skill (captured as a follow-up after the first real plan has been hand-edited, mirroring the FSD-006 → FSD-014 pattern).

## Assessment

**Current state:**

- `validatePlan` already exists (`plugin/scripts/validator.js:203`). Required frontmatter: `project`, `id` (kebab-case), `title`, `status`, `created`. Optional: `updated`, `tags`, `related`, `task` (string), `depends_on` (array of kebab-case plan ids), `estimate` (string). Validates format only — no cross-reference resolution, matching the FSD-004/005/006/007 stance.
- `STORAGE_KINDS = ['spec', 'plan', 'research']` already includes `plan`; `scanArtifacts({ fsdDir, kind: 'plan', dirName })` in `plugin/scripts/loader.js:210` already reads the storage-kind dir and runs `validatePlan`. Post-write, `/fsd:validate --artifacts` (and `--plans`) will pick up new plans automatically.
- `config.yaml`'s `structure.plan` (default `"plan"`) resolves the dir name via `getStructure(config).plan` in `plugin/scripts/config.js`. `/fsd-restructure` can rename it; the skill must honor that.
- `loadProjectContext({ planningDir })` in `plugin/scripts/loader.js:173` returns `{ project, roadmap, validation }` from `planning/PROJECT.md` + `planning/ROADMAP.md`. Never throws. This is the read path for auto-injecting `project:` AND (after this FSD) for surfacing `architecture`.
- `plugin/scripts/spec.js` is the backing-module precedent for a create-only authoring artifact (renderSpec + writeSpecFile + atomic write + pre-validation + refuse-to-overwrite + PROJECT.md auto-injection). `plugin/scripts/roadmap.js` is the precedent for a parser + multi-op editor with byte-preservation guarantees. This task follows `spec.js` for `plan.js` (create-only), and draws from both for `architecture.js` (create-once + append-many).
- No `validateArchitecture`, no `architecture.js`, no `/fsd-plan`-shaped skill, script, or test exists yet. `.fsd/plan/` is empty in this repo.

**What needs to exist:**

1. **Validator extension** — `validateArchitecture` in `plugin/scripts/validator.js`, sharing `validateProjectContextCommon` with PROJECT/ROADMAP. No plan-side validator changes — `validatePlan` already covers everything `/fsd-plan` emits.
2. **Loader extension** — `loadProjectContext` returns a third entry `architecture` alongside `project` and `roadmap`. Shape: `{ meta, body, path, validation } | null`. `validation` summary extended the same way.
3. **Architecture backing module** — `plugin/scripts/architecture.js`: `parseArchitecture(content)` (line-range-aware, mirroring roadmap.js), `renderArchitecture(data)`, `createArchitectureFile({...})` (refuses to overwrite), `appendDecision({...})` (ADR-style entry prepended under `## Decisions`), `appendToSection({sectionId, content})` (edit-in-place for the other six sections), `today()`, + CLI entry.
4. **Plan backing module** — `plugin/scripts/plan.js`: `renderPlan(data)`, `writePlanFile({...})` (refuses to overwrite, pre-validates via `validatePlan`, auto-injects `project:` from PROJECT.md, atomic write), `resolvePlanPath({...})`, `today()`, `SECTION_ORDER`, `SECTION_META`, + CLI entry. Enforces the hard spec-linkage rule: refuses if `specData.related` does not contain an existing `spec/<id>` pointing at a real file.
5. **Spec-status helper** — either in `plan.js` or `loader.js`: a `checkSpecPrecondition({ fsdDir, config, specId })` function returning `{ ok, spec?, reason? }`. Returns `ok: false` with a clear reason when the spec file is missing; returns `{ ok: true, spec: { meta, warnings: [...] } }` with a non-empty warnings array when the spec is present but `approved: false`; refuses when `status: archived`. Keeps the skill's precondition logic testable in isolation.
6. **`/fsd-plan` skill** — `plugin/skills/fsd-plan/SKILL.md` orchestrates the 6-step flow (preconditions → EnterPlanMode → context gather → Socratic draft → architecture delta → ExitPlanMode → write). Must dispatch to the backing modules via `node -e` calls.
7. **Tests** — four files: `test-architecture.js`, `test-plan.js`, `test-fsd-plan.js`, plus extensions to `test-loader.js` for the new `architecture` return field and `test-project-context.js` for `validateArchitecture`.
8. **Docs + release** — README (Commands + Project Context sections), CHANGELOG `[0.10.0]`, `plugin.json` + README header version bump.

**Locked decisions (gathered during plan-mode interview):**

1. **Spec linkage is hard-required.** Plan must include `related: spec/<id>` where `<id>.md` exists in `.fsd/<structure.spec>/`. Missing spec file → refuse with pointer to `/fsd-spec`. Archived spec → refuse with "supersede it first or point at an active spec". Unapproved spec (`approved: false`) → soft warning + explicit user-yes to proceed.
2. **Native plan mode is literal.** The skill calls `EnterPlanMode` in Step 2, conducts all read-only context gathering and Socratic discussion inside plan mode, drafts the plan in conversation, and calls `ExitPlanMode` with the drafted plan as the payload. The harness handles the approval gate; on approval, the skill writes the artifact(s).
3. **Plan body sections — 6.** Context / Approach / Phases / Risks / Acceptance / Open questions. Mirrors `/fsd-spec`'s six-section cadence; Dependencies live as callouts inside Context or Approach rather than a dedicated section (the `depends_on:` frontmatter array carries the formal list).
4. **ARCHITECTURE.md is a new project-level artifact.** Lives at `planning/ARCHITECTURE.md` alongside PROJECT.md/ROADMAP.md. New `validateArchitecture` in validator.js. Extended `loadProjectContext` surfaces it. `/fsd-plan` owns lazy creation (first run, engineer-opt-in) and append-on-every-run.
5. **ARCHITECTURE.md body sections — 7.** Stack & Technical Details / Decisions (ADR-style, newest-first) / Code Examples / References / Standards / Glossary / Open architectural questions. Append semantics: new Decisions prepended at top of `## Decisions` with `### YYYY-MM-DD — <title>` sub-headings (Context/Decision/Consequences sub-fields); other sections edited in place (append-to-section).
6. **Context gathering depth — artifacts + narrowly-hinted code.** Skill reads: the linked spec (full), PROJECT.md, ROADMAP.md, ARCHITECTURE.md (if present), frontmatter + titles of every existing plan in `.fsd/<structure.plan>/`, plus full reads of any files the spec explicitly names and greps for symbols the spec calls out. No broad repo scan. The engineer can request additional reads during the Socratic discussion.
7. **Create-only for plans.** No update/approve/archive/supersede in v1. Future `/fsd-plan-update` owns those (separate FSD, captured after first real plan is hand-edited).
8. **Arguments — `/fsd-plan [spec-id]`.** Optional positional; when provided, pre-populates `related: spec/<id>` and skips that prompt. When omitted, skill lists specs in `.fsd/<structure.spec>/` and asks which one. Plan id defaults to the spec id (different directories, no collision); engineer can override.
9. **`task:` field — one optional frontmatter prompt.** Asked during the frontmatter interview ("FSD task id this plan addresses? e.g. `FSD-012`, or 'none'"). Not auto-populated from args. `depends_on:` is gathered during the Socratic discussion (not as a separate prompt) — engineer sees the existing-plan list surfaced in Step 3 and names any that block this one.
10. **Session-start header — unchanged visibly.** `loadProjectContext` returns the third `architecture` field, but the session-start output stays `Project: <name> — Milestone: <current> (v<version>)`. A future FSD can extend the header if desired.
11. **Version bump — 0.9.0 → 0.10.0.** Minor additive.

**Out of scope** (flagged for follow-up):

- `/fsd-plan-update` — editing existing plans, flipping status, appending phases, adding `depends_on:` entries, archiving stale plans. Separate future FSD.
- Cross-file reference resolution at validator level — e.g., `validatePlan` checking that `related: spec/foo` actually points at a real file. Skill enforces the hard-require at author time; `/fsd:validate --plans` still does format-only validation (matches FSD-004 stance).
- Multi-plan batch creation (one plan per `/fsd-plan` invocation).
- `/fsd-architecture` as a dedicated authoring surface for ARCHITECTURE.md. For v1, `/fsd-plan` is the only writer. If the append-on-plan mechanic proves insufficient (e.g., users want to record a pure-architecture decision with no associated plan), a dedicated skill can be added later.
- Architecture.md update/archive ops beyond the append/edit-in-place semantics defined here (no rename, no ADR supersede chain, no per-section delete).
- Surfacing ARCHITECTURE.md in the session-start header.
- CLI surface for scripted plan creation without user interaction (the CLI entry on `plan.js` is meant for tests; interactive authoring goes through the skill).

## Plan

**Phase A — Validator extension for `validateArchitecture`**

1. Add `validateArchitecture` to `plugin/scripts/validator.js`:
   - Reuses `validateProjectContextCommon(meta)` — same required fields (`project`, `id`, `title`, `status`, `created`) and optional (`updated`, `tags`).
   - No architecture-specific frontmatter extensions in v1. Keep it maximally simple; future FSDs can extend.
   - Return shape: `{ valid, errors, warnings }`.
   - Export alongside `validateProject` and `validateRoadmap`.

2. No changes to `validatePlan` — current schema covers every field `/fsd-plan` emits.

**Phase B — Loader extension for `architecture`**

3. Extend `loadProjectContext({ planningDir })` in `plugin/scripts/loader.js`:
   - Add a third `readProjectContextFile` call for `planning/ARCHITECTURE.md` using `validateArchitecture`.
   - Return `{ project, roadmap, architecture, validation: { project, roadmap, architecture } }`.
   - `architecture` follows the same shape as `project`/`roadmap`: `{ meta, body, path, validation } | null`.
   - `loadContent`'s return shape gets the `architecture` field propagated through `projectContext` automatically (no additional changes in `loadContent` itself).
4. Session-start loader (`plugin/scripts/session-start-loader.js`) — leave the rendered header unchanged in v1. Verify no regression by inspection: the existing header code reads `projectContext.project` and `projectContext.roadmap`; adding `architecture` doesn't break anything.

**Phase C — Architecture backing module `plugin/scripts/architecture.js`**

5. Create `plugin/scripts/architecture.js`. Exports:
   - `parseArchitecture(content)` — line-range-aware parser (mirrors `parseRoadmap`). Returns `{ lines, frontmatter, frontmatterLines: [start, end], bodyStart, sections: [{ id, heading, headingLine, range: [startLine, endLine] }] }`. Tolerates unknown headings (captures with `id: null` same as spec-update's tolerance path).
   - `renderArchitecture(data)` — frontmatter + all 7 `##` section headings with italicized placeholders for empty sections (same placeholder-preserve discipline as `renderSpec`).
   - `createArchitectureFile({ planningDir, architectureData })` — resolves `<planningDir>/ARCHITECTURE.md`, refuses to overwrite, pre-validates via `validateArchitecture`, writes atomically (tmp + rename). Auto-injects `project:` from PROJECT.md.
   - `appendDecision({ planningDir, title, context, decision, consequences })` — prepends a new ADR-style entry inside `## Decisions`. Entry shape: `### YYYY-MM-DD — <title>\n\n**Context:** <ctx>\n\n**Decision:** <dec>\n\n**Consequences:** <cons>\n`. Refuses if ARCHITECTURE.md missing. Updates frontmatter `updated:` to today.
   - `appendToSection({ planningDir, sectionId, content })` — appends `content` to the end of the named section (other six: stack, code_examples, references, standards, glossary, open_questions). Strips the italic placeholder if the section was still in its default state. Refuses if ARCHITECTURE.md missing or section heading absent.
   - `today()` local helper.
   - CLI entry: `node scripts/architecture.js <planningDir> <op> [--key=value ...]` where op ∈ `create | append-decision | append-to-section`. Prints `{ ok, written?, reason? }` JSON.
6. `SECTION_ORDER` / `SECTION_META`:
   ```
   SECTION_ORDER = ['stack', 'decisions', 'code_examples', 'references', 'standards', 'glossary', 'open_questions']
   SECTION_META = {
     stack:          { heading: 'Stack & Technical Details', placeholder: '_Core stack, runtime versions, hosting, and cross-cutting technical facts._' },
     decisions:      { heading: 'Decisions',                  placeholder: '_Architecture Decision Records — newest first._' },
     code_examples:  { heading: 'Code Examples',              placeholder: '_Canonical idioms, snippets, and patterns the team follows._' },
     references:     { heading: 'References',                 placeholder: '_External docs, specs, papers, prior art._' },
     standards:      { heading: 'Standards',                  placeholder: '_Naming, error handling, testing discipline, code style._' },
     glossary:       { heading: 'Glossary',                   placeholder: '_Project-specific vocabulary — definitions for load-bearing terms._' },
     open_questions: { heading: 'Open architectural questions', placeholder: '_Unresolved cross-cutting issues surfacing across plans._' },
   }
   ```
7. Frontmatter schema for ARCHITECTURE.md:
   ```
   project: <string>
   id: architecture
   title: <project name> Architecture   # default; engineer can override
   status: active
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   tags:                                # optional
     - platform
   ```

**Phase D — Plan backing module `plugin/scripts/plan.js`**

8. Create `plugin/scripts/plan.js`. Exports (mirrors `spec.js`):
   - `renderPlan(data)` — frontmatter + 6 body sections. Skipped sections keep italic placeholders.
   - `writePlanFile({ projectPath, config, planningDir, planData })` — refuses to overwrite, auto-injects `project:` from PROJECT.md when absent, pre-validates via `validatePlan`, enforces spec-hard-require (see step 10), writes atomically.
   - `resolvePlanPath({ projectPath, config, id })` — uses `getStructure(config).plan`.
   - `checkSpecPrecondition({ fsdDir, config, specId })` — reads `<fsdDir>/<structure.spec>/<specId>.md`, returns `{ ok: false, reason }` on missing, `{ ok: false, reason: 'spec archived' }` on `status: archived`, `{ ok: true, spec, warnings: [...] }` with a non-empty warning when `approved: false`.
   - `today()`, `SECTION_ORDER`, `SECTION_META`.
   - CLI entry: `node scripts/plan.js <projectPath> [--json=<path> | ...flags]`.
9. `SECTION_ORDER` / `SECTION_META` for plan:
   ```
   SECTION_ORDER = ['context', 'approach', 'phases', 'risks', 'acceptance', 'open_questions']
   SECTION_META = {
     context:        { heading: 'Context',        placeholder: '_Spec summary + relevant code + prior decisions._' },
     approach:       { heading: 'Approach',       placeholder: '_High-level architectural strategy._' },
     phases:         { heading: 'Phases',         placeholder: '_Phase-by-phase implementation breakdown with concrete steps._' },
     risks:          { heading: 'Risks',          placeholder: '_Known gotchas and mitigations._' },
     acceptance:     { heading: 'Acceptance',     placeholder: '- [ ] _Falsifiable verification step_' },
     open_questions: { heading: 'Open questions', placeholder: '_Anything deferred or still unclear at write time._' },
   }
   ```
10. Spec-hard-require enforcement path inside `writePlanFile`:
    - Compute `specLinks = (planData.related || []).filter(r => r.startsWith('spec/'))`.
    - If `specLinks.length === 0`: return `{ ok: false, reason: 'plan must link to a spec via related: spec/<id> — /fsd-plan hard-requires a spec linkage' }`.
    - For each `specLinks` entry, extract the id and call `checkSpecPrecondition`. Refuse on missing or archived. Propagate warnings (the skill surfaces them).

**Phase E — `/fsd-plan` skill `plugin/skills/fsd-plan/SKILL.md`**

11. SKILL.md structure — 6 steps:

    **Step 1: Preconditions.**
    - Read `planning/PROJECT.md` via `loadProjectContext`. Missing → ask "run `/fsd-new-project` first? (yes/no)"; on yes chain-invoke, on no abort. Invalid → abort with errors printed verbatim.
    - Parse `$ARGUMENTS` — single optional positional, the spec id.
    - If spec id not provided: list specs found in `.fsd/<structure.spec>/` with their titles, ask engineer to pick one.
    - Call `checkSpecPrecondition({ fsdDir, config, specId })`. Missing spec → abort with `/fsd-spec` pointer. Archived → abort with supersede pointer. Warnings (unapproved) → surface verbatim, ask "proceed anyway? (yes/no)".
    - Check `<fsdDir>/<structure.plan>/<specId>.md` doesn't already exist — if it does, surface and ask for an override id.

    **Step 2: EnterPlanMode.**
    - Invoke `EnterPlanMode` tool. All subsequent work is read-only until Step 5.

    **Step 3: Context gathering (read-only).**
    - Read linked spec in full (`meta` + body).
    - Read PROJECT.md + ROADMAP.md + ARCHITECTURE.md (if present).
    - Scan `.fsd/<structure.plan>/*.md` frontmatter — collect `{ id, title, status }` for every existing plan. Present this list to the engineer as "existing plans — any of these block this one? (we'll revisit during phase drafting)".
    - Parse the spec body for explicit file paths (regex: `` `([a-zA-Z0-9_\-./]+\.(js|ts|jsx|tsx|md|json|yaml|yml|sh|py|rs|go|toml))` ``) and symbol mentions. Read those files. Grep the repo for the symbol names.
    - Print a single-paragraph synthesis back to the engineer: "Here's what I pulled — [spec X], [project context], [N existing plans], [these files from the spec's mentions]. Anything else you want me to read before we draft?"

    **Step 4: Socratic discussion + draft iteration.**
    - Draft the plan's 6 sections from context. Don't dump the whole draft at once — present one section at a time, engineer confirms or redirects.
    - Ask pointed clarifying questions ONLY for gaps the context doesn't cover (e.g., "spec says 'use the existing error-handling pattern' — I see two patterns in the codebase, `tryCatchAndReturn` at `src/lib/errors.js:14` and `wrapWithErrorBoundary` at `src/components/ErrorBoundary.tsx:22` — which one applies here?").
    - For `depends_on:`: surface the existing-plan list from Step 3 and ask "any of these need to finish first?". Engineer names them.
    - For the frontmatter interview: ask only for what the context doesn't infer — title (if not obvious from spec), id (default to spec id, confirm), status (default draft), `task:` (optional FSD-NNN), `tags:`, `estimate:`. Keep it brief.

    **Step 5: Architecture delta.**
    - If ARCHITECTURE.md exists: ask "any technical decisions from this plan to record in ARCHITECTURE.md's `## Decisions` section?" If yes, draft the ADR entry (title / context / decision / consequences). Also ask about appends to other sections (stack, code examples, standards, references, glossary, open_questions) — one question, engineer names any that apply.
    - If ARCHITECTURE.md is missing: ask "create ARCHITECTURE.md and seed it with this plan's technical decisions? (yes/no)". On yes, draft the initial 7-section content (populating Decisions from this plan; other sections seeded with the spec's stack hints + placeholders).

    **Step 6: ExitPlanMode + write.**
    - Invoke `ExitPlanMode` with a payload containing:
      1. The full rendered plan content.
      2. The architecture delta (either create-with-seed or append-decision + any section appends).
      3. The target path(s) — plan file path, and ARCHITECTURE.md path if created/updated.
    - On engineer approval (the harness handles this), write the plan via `node scripts/plan.js <projectPath> --json=<tmp>`, and the architecture delta via `node scripts/architecture.js <planningDir> <op> --json=<tmp>`.
    - Relay `{ ok, written?, reason? }` verbatim for each write. Print a one-line confirmation pointing at the written paths.
    - Suggest next steps: "Run `/fsd:validate --artifacts` to confirm the plan is picked up. When `/fsd-execute-plan` lands (FSD-009), it'll read this plan automatically."
12. Frontmatter of the skill itself: `name: fsd-plan`; argument-hint: `[spec-id]`; description ≥20 chars, mentions plan mode, spec hard-require, and ARCHITECTURE.md ownership.
13. Guardrails section — non-negotiable rules:
    - Never skip `EnterPlanMode`. The skill is a plan-mode tool; bypassing the mode breaks the approval contract.
    - Never write without an `ExitPlanMode` approval.
    - Never overwrite an existing plan or ARCHITECTURE.md.
    - Never touch PROJECT.md or ROADMAP.md.
    - Never modify the linked spec (spec-update is `/fsd-spec-update`'s territory).
    - Never silently drop the spec-hard-require. Missing/archived spec → stop immediately; don't "help" by offering to create a stub.
    - Never auto-approve or auto-archive. Status flips are `/fsd-plan-update`'s territory (future).
    - Never commit or push. The engineer owns the release boundary.

**Phase F — Tests**

14. New `plugin/tests/test-architecture.js` — ~20 tests:
    - `validateArchitecture` — minimal valid, missing required fields (one per field), kebab-case id enforcement, status enum, ISO dates.
    - `parseArchitecture` — minimal valid file (frontmatter + 7 sections), section range accuracy, unknown heading tolerance, malformed frontmatter rejection.
    - `renderArchitecture` — minimal data, full data, placeholder preservation.
    - `createArchitectureFile` — happy path, refuses to overwrite, PROJECT.md missing, atomicity under injected validation failure.
    - `appendDecision` — ADR entry prepended at top of `## Decisions` (newest-first), frontmatter `updated:` bumped, refuses if file missing, byte-preservation of other sections.
    - `appendToSection` — appends to the named section without touching others, strips italic placeholder on first real content, refuses unknown section id, refuses if file missing, byte-preservation.
    - Round-trip: after each op the result passes `validateArchitecture`.
15. New `plugin/tests/test-plan.js` — ~15 tests:
    - `renderPlan` — minimal, full, placeholder preservation.
    - `resolvePlanPath` — default + config override.
    - `writePlanFile` — happy path, refuse-to-overwrite, pre-validation failure, PROJECT.md auto-inject path, config.structure.plan override.
    - Spec-hard-require: refuses when `related` empty, refuses when `related` has no `spec/` entry, refuses when `spec/<id>` points at non-existent file, refuses when spec is archived, surfaces warning when spec is unapproved but does NOT refuse.
    - `checkSpecPrecondition` — all three branches (missing/archived/unapproved) exercised directly.
    - Round-trip: `scanArtifacts({ kind: 'plan' })` picks up the new plan with `validation.valid === true`.
16. New `plugin/tests/test-fsd-plan.js` — ~8 tests:
    - CLI-entrypoint integration: happy path via `--json` against a fixture project with a valid PROJECT.md + spec in `.fsd/spec/foo.md`.
    - CLI refuses without spec link.
    - CLI refuses when spec file missing.
    - CLI refuses when spec archived.
    - CLI writes plan with correct `related: [spec/foo]` in frontmatter.
    - SKILL.md sanity: `name: fsd-plan`, argument-hint `[spec-id]`, cross-references `/fsd-spec` + `/fsd-execute-plan` + `EnterPlanMode` + `ExitPlanMode`, documents all 6 steps, documents ARCHITECTURE.md create + append, documents spec-hard-require + spec-status rules.
17. Extend `plugin/tests/test-loader.js`:
    - `loadProjectContext` returns the `architecture` field (null when file missing, populated object when present + valid, populated with errors when present + invalid).
    - `loadContent`'s `projectContext` now includes architecture.
18. Extend `plugin/tests/test-project-context.js`:
    - `validateArchitecture` happy path + failure cases.
    - `loadProjectContext` integration: all three files present + validated.
19. Verify `plugin/tests/run-tests.sh` picks up the three new files automatically (it globs `test-*.js`).

**Phase G — Docs + release**

20. README:
    - **Commands section**: add `/fsd-plan [spec-id]` with a one-liner explaining the plan-mode flow + spec-hard-require + ARCHITECTURE.md ownership. Cross-reference `/fsd-spec` as the creation path and `/fsd-execute-plan` (future) as the downstream.
    - **Project Context section**: add a paragraph introducing `planning/ARCHITECTURE.md` — long-lived, `/fsd-plan` owns create + append, read by downstream skills. Worked example showing the 7-section shape + a sample ADR-style Decisions entry.
    - **Artifact Schemas section**: document the plan schema is unchanged from FSD-004 (no content update needed) — but add a note that `/fsd-plan` enforces the spec-hard-require at author time, orthogonal to validator format-only checks.
21. CHANGELOG: new `[0.10.0] - YYYY-MM-DD` entry.
    - **Added**: `/fsd-plan` skill (full description including 6-step plan-mode flow, spec-hard-require, spec-status rules); `plugin/scripts/plan.js` (backing module, exports, CLI entry); `planning/ARCHITECTURE.md` as a new project-level artifact (7 sections + ADR-style Decisions log); `validateArchitecture` in validator.js; `plugin/scripts/architecture.js` (parser + 3 ops + CLI); `loadProjectContext` extended with `architecture` field (additive); new test files.
    - **Changed**: `loadProjectContext` return shape additively extended (no breaking change for callers that don't destructure `architecture`); README (Commands + Project Context sections).
    - **Compatibility**: fully backward-compatible. No migration. Repos without ARCHITECTURE.md see `architecture: null` in loadProjectContext. Existing plans (none anywhere, since this is the first authoring surface) continue to validate identically.
    - **Out of scope**: `/fsd-plan-update`, `/fsd-architecture` dedicated skill, architecture.md rename/archive ops, multi-plan batch, session-start header extension.
22. Version source alignment: `plugin/.claude-plugin/plugin.json` → `0.10.0`, README header → `0.10.0`, CHANGELOG `[0.10.0]` entry.
23. Commit boundaries — five logical commits:
    - `feat(validator): validateArchitecture for ARCHITECTURE.md schema`
    - `feat(loader): surface architecture alongside project + roadmap`
    - `feat(architecture): parser + 3 ops (create, append-decision, append-to-section) + CLI`
    - `feat(plan): renderPlan + writePlanFile + checkSpecPrecondition + CLI`
    - `feat: /fsd-plan skill — plan-mode-driven technical implementation planning`
    - `chore(release): v0.10.0 — /fsd-plan skill + ARCHITECTURE.md artifact`
24. Push to `origin/main` is NOT part of this task — hand off to user per skill guardrails.

## Acceptance Criteria

All criteria verified 2026-04-24 before commit.

- [x] `plugin/scripts/validator.js` exports `validateArchitecture`; it returns the standard `{ valid, errors, warnings }` shape and enforces the `validateProjectContextCommon` schema
- [x] `plugin/scripts/loader.js` `loadProjectContext` returns a third `architecture` field (null when `planning/ARCHITECTURE.md` is missing; `{ meta, body, path, validation }` when present); the `validation` summary object includes `architecture` alongside `project` and `roadmap`
- [x] `plugin/scripts/architecture.js` exists and exports `parseArchitecture`, `renderArchitecture`, `createArchitectureFile`, `appendDecision`, `appendToSection`, `today`, `SECTION_ORDER`, `SECTION_META`
- [x] `renderArchitecture` produces frontmatter passing `validateArchitecture` for minimal input; output includes all 7 `##` sections (Stack & Technical Details / Decisions / Code Examples / References / Standards / Glossary / Open architectural questions) with italic placeholders for skipped sections
- [x] `createArchitectureFile` refuses to overwrite an existing `planning/ARCHITECTURE.md`, returns `{ ok: false, reason: /refusing to overwrite/ }` with the file on disk unchanged
- [x] `createArchitectureFile` auto-injects `project:` from PROJECT.md when absent in `architectureData`; returns `{ ok: false, reason }` without writing when PROJECT.md is missing or invalid
- [x] `appendDecision` prepends an ADR-style entry (`### YYYY-MM-DD — <title>` sub-heading + Context/Decision/Consequences fields) at the top of the `## Decisions` section; bumps frontmatter `updated:` to today; other sections byte-preserved
- [x] `appendDecision` refuses when ARCHITECTURE.md does not exist, returning `{ ok: false, reason: /not found/ }` — does NOT lazily create the file (creation goes through `createArchitectureFile` via the skill)
- [x] `appendToSection` edits-in-place for the other six sections (stack, code_examples, references, standards, glossary, open_questions); strips the italic placeholder when the section was still in its default state; bumps frontmatter `updated:` to today; other sections byte-preserved
- [x] `appendToSection` refuses unknown section ids with `{ ok: false, reason: /unknown section/ }`
- [x] `plugin/scripts/plan.js` exists and exports `renderPlan`, `writePlanFile`, `resolvePlanPath`, `checkSpecPrecondition`, `today`, `SECTION_ORDER`, `SECTION_META`; CLI entry accepts a JSON payload via `--json`
- [x] `renderPlan` produces frontmatter passing `validatePlan` for minimal input; output includes all 6 `##` sections (Context / Approach / Phases / Risks / Acceptance / Open questions) with italic placeholders for skipped sections
- [x] `writePlanFile` resolves target path via `getStructure(config).plan` and honors config overrides
- [x] `writePlanFile` refuses to overwrite an existing plan; pre-validates via `validatePlan`; auto-injects `project:` from PROJECT.md; writes atomically (tmp + rename)
- [x] `writePlanFile` enforces the spec-hard-require: refuses when `planData.related` has no `spec/` entry, refuses when the linked spec file is missing, refuses when the linked spec is `archived`
- [x] `writePlanFile` surfaces a warning (not a refusal) when the linked spec has `approved: false`
- [x] `checkSpecPrecondition({ fsdDir, config, specId })` returns `{ ok: false, reason }` for missing or archived specs and `{ ok: true, spec, warnings: [...] }` for unapproved specs (warnings non-empty)
- [x] `/fsd-plan` skill at `plugin/skills/fsd-plan/SKILL.md` passes `/fsd:validate --skills`; frontmatter has `name: fsd-plan`, `argument-hint: [spec-id]`, description ≥20 chars
- [x] Skill Step 1 documents the PROJECT.md precondition (chain-invoke `/fsd-new-project` on missing, abort on invalid) AND the spec-hard-require check (`checkSpecPrecondition` branches on missing/archived/unapproved)
- [x] Skill Step 2 invokes `EnterPlanMode` before any reads or drafting work
- [x] Skill Step 3 documents the narrowly-hinted context gathering: spec (full), PROJECT/ROADMAP/ARCHITECTURE.md, existing-plan frontmatter, files/symbols mentioned in the spec
- [x] Skill Step 4 documents the Socratic discussion pattern: section-at-a-time drafting, questions only for gaps context doesn't cover, `depends_on:` surfaced from existing-plan list
- [x] Skill Step 5 documents the architecture delta: append-to-existing path (Decisions + other sections) AND lazy-create path (with explicit engineer opt-in)
- [x] Skill Step 6 invokes `ExitPlanMode` with a payload listing both the plan content and the architecture delta; on approval, writes via `plan.js` and `architecture.js` CLI entries
- [x] Skill Guardrails section explicitly forbids: bypassing plan mode, overwriting existing artifacts, touching PROJECT.md/ROADMAP.md/linked spec, auto-approving, auto-archiving, auto-committing, dropping the spec-hard-require
- [x] Skill argument handling: `/fsd-plan <spec-id>` pre-populates `related: spec/<id>` and skips that prompt; `/fsd-plan` (no arg) lists specs in `.fsd/<structure.spec>/` and asks which one
- [x] After write, `scanArtifacts({ fsdDir, kind: 'plan', dirName })` returns the new plan with `validation.valid === true` (round-trip verified in test-plan.js)
- [x] New `plugin/tests/test-architecture.js` covers validator, parser, renderer, createArchitectureFile, appendDecision, appendToSection, round-trip, byte-preservation, atomicity
- [x] New `plugin/tests/test-plan.js` covers renderPlan, writePlanFile happy path, refuse-to-overwrite, pre-validation-failure, PROJECT.md auto-inject, config override, spec-hard-require (all four refusal paths), checkSpecPrecondition, round-trip via scanArtifacts
- [x] New `plugin/tests/test-fsd-plan.js` covers CLI-entrypoint integration (happy path + each refusal path), SKILL.md sanity (name, argument-hint, cross-references, all 6 steps documented, ARCHITECTURE.md mechanics documented, spec-hard-require documented)
- [x] `plugin/tests/test-loader.js` extended to verify `architecture` field in `loadProjectContext` (null/present/invalid)
- [x] `plugin/tests/test-project-context.js` extended to cover `validateArchitecture` (happy + failure cases)
- [x] README Commands section documents `/fsd-plan [spec-id]` with one-liner; Project Context section documents `planning/ARCHITECTURE.md` shape with worked example; Artifact Schemas section notes the spec-hard-require is enforced at author time
- [x] CHANGELOG `[0.10.0]` entry added under Added/Changed/Compatibility/Out of scope
- [x] Version sources aligned at 0.10.0: `plugin/.claude-plugin/plugin.json`, README header, CHANGELOG `[0.10.0]` entry
- [x] No regression: full test suite stays green (21 test files passing — was 18 before this FSD)

## Decisions locked by user (pre-execution)

1. **Spec linkage — hard-require.** Plan must link to an existing spec via `related: spec/<id>`. Archived spec → refuse. Unapproved spec → soft warning + explicit proceed.
2. **Runtime — literal native plan mode.** `EnterPlanMode` in Step 2; `ExitPlanMode` in Step 6 with the drafted plan + architecture delta as the payload.
3. **Plan body sections — 6.** Context / Approach / Phases / Risks / Acceptance / Open questions.
4. **ARCHITECTURE.md — project-level, `/fsd-plan` owns create + append.** Lives at `planning/ARCHITECTURE.md`. New `validateArchitecture`; extended `loadProjectContext`. Lazy creation on first run (engineer-opt-in); append-on-every-run.
5. **ARCHITECTURE.md body sections — 7.** Stack & Technical Details / Decisions (ADR-style, newest-first) / Code Examples / References / Standards / Glossary / Open architectural questions.
6. **Context gathering — artifacts + narrowly-hinted code.** Spec (full), PROJECT/ROADMAP/ARCHITECTURE.md, existing-plan frontmatter, files and symbols the spec explicitly names. No broad repo scan.
7. **Scope — create-only.** Update/approve/archive/supersede deferred to a future `/fsd-plan-update` FSD.
8. **Arguments — `/fsd-plan [spec-id]`.** Optional positional; plan id defaults to spec id, engineer can override.
9. **`task:` field — optional frontmatter prompt.** Not auto-populated. `depends_on:` gathered during Socratic discussion from the existing-plan list surfaced in Step 3.
10. **Session-start header — unchanged visibly.** Loader returns the `architecture` field; no header extension in v1.
11. **Version bump — 0.9.0 → 0.10.0.** Minor additive.

## Relationship to other tasks

- **Builds on FSD-004** — reuses `validatePlan` unchanged; reuses `scanArtifacts` / `STORAGE_KINDS` / artifact frontmatter primitives; adds `validateArchitecture` alongside the existing validator family.
- **Builds on FSD-005** — reads PROJECT.md + ROADMAP.md via `loadProjectContext`; extends the same loader to also surface ARCHITECTURE.md, mirroring the pattern that FSD-005 established.
- **Builds on FSD-006** — hard-requires a spec in `.fsd/<structure.spec>/` (authored by `/fsd-spec`); follows `spec.js`'s create-only write pattern for `plan.js`; offers engineer the `archived`/`unapproved` spec-status refusal path.
- **Builds on FSD-003 + FSD-013** — honors config-driven `structure.plan` + `structure.spec` directories, so `/fsd-restructure` can rename them later without breaking this skill.
- **Paired with FSD-007** — `/fsd-roadmap` is the mid-project ROADMAP.md editor; `/fsd-plan` + (future) `/fsd-plan-update` form the analogous pair for plan artifacts. ARCHITECTURE.md append mechanics follow the same "create once, edit many" philosophy that `/fsd-new-project` + `/fsd-roadmap` established.
- **Precedes FSD-009 (`/fsd-execute-plan`)** — once plan artifacts exist with stable schema, hard spec-linkage, and ARCHITECTURE.md context, the execution skill has a fully-specified "how" to read from.
- **Future follow-ups** — `/fsd-plan-update` (TBD) for editing existing plans; `/fsd-architecture` (TBD) as a dedicated authoring surface for ARCHITECTURE.md if the append-on-plan mechanic proves insufficient for pure-architecture decisions that don't fit inside a plan's flow.
