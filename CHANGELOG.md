# Changelog

All notable changes to FSD are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

## Versioning

FSD's public surface — the "API" that gets versioned — is:

- **Commands** — `/fsd:*` and `/fsd-*` command names and behavior
- **Skills** — skill names, activation behavior, and visible effects
- **Config schema** — keys in `.fsd/config.yaml` and their semantics
- **`.fsd/` project contract** — the top-level name (`.fsd/`), required layout, reserved filenames
- **Script CLI entry points** — argument signatures for `init.js`, `add.js`, `list.js`, `validate.js`, `restructure.js`
- **Programmatic module exports** — functions exported from `plugin/scripts/*.js`

### Bump rules

| Change | Bump |
|---|---|
| Removed or renamed command, skill, or exported function | MAJOR |
| Breaking config schema change (removed key, semantic change to an existing key) | MAJOR |
| Changed `.fsd/` top-level name or required structure contract | MAJOR |
| Removed or renamed required CLI argument | MAJOR |
| New command or skill | MINOR |
| New config key, backward-compatible | MINOR |
| New optional CLI argument | MINOR |
| Additive change to exported function signatures (new optional params) | MINOR |
| Internal refactor with identical user-visible behavior | PATCH |
| Bug fix | PATCH |
| Documentation-only change | PATCH |
| Test-only change | PATCH |

### Pre-1.0 notice

While version < 1.0, the **command surface**, **skill surface**, and **project-level `.fsd/config.yaml` schema** are treated as stable as of 0.2.0 — breaking changes there will still bump MAJOR. Internal script APIs and advanced/undocumented config may evolve in minor releases; each such change is recorded under `Changed` or `Removed`.

### Source of truth

The authoritative version lives in `plugin/.claude-plugin/plugin.json`. The README roadmap tracks what's planned for future versions. This CHANGELOG records what shipped.

---

## [0.15.0] - 2026-05-06

### Added

- **`/fsd:research` skill** — create research artifacts under `.fsd/research/<id>.md`; guided interview (one question at a time) for frontmatter (`id`, `title`, `status`, `related`, `tags`, `sources`, `conclusion`) and six body sections (Question / Context / Method / Findings / Conclusion / Open questions); auto-injects `project:` from `planning/PROJECT.md`; create-only, refuses to overwrite; backed by the new `research.js` script module.
- **`plugin/scripts/research.js`** — new backing module mirroring `spec.js`: `renderResearch`, `writeResearchFile`, `resolveResearchPath` exports plus CLI entry point (`node research.js <projectPath> [--json=<path> | --id=... --title=... ...]`). Validates via `validateResearch` before touching disk; atomic tmp+rename write.

## [0.14.1] - 2026-04-25

### Fixed

- **Skill prefix duplication** — All 15 remaining skills that were missing the `fsd:` namespace prefix in their `name:` frontmatter field now use `fsd:<name>` consistently (e.g. `name: fsd:plan`, `name: fsd:brainstorm`). Previously, only `spec` carried the prefix; the others had bare names, causing Claude Code to list skills from the two loading paths under different identifiers and display every skill twice.
- **install.sh: eliminate versioned cache** — `installPath` in `installed_plugins.json` now points directly at `~/.claude/plugins/fsd/plugin` (the live git clone) instead of a versioned copy in `~/.claude/plugins/cache/tbeack/fsd/<VERSION>/`. Any prior versioned cache under `~/.claude/plugins/cache/tbeack/` is deleted on install. This removes the stale-cache class of bug permanently: skills loaded by Claude Code always come from the same directory that `git pull` keeps up to date.

## [0.14.0] - 2026-04-25

### Changed

- **Skill rename — drop `fsd-` prefix** (FSD-018) — All 11 FSD-specific skills renamed to remove the redundant `fsd-` prefix, resolving the double-prefix convention (`fsd:fsd-plan` → `fsd:plan`). Rename map: `fsd-new-project` → `new-project`, `fsd-roadmap` → `roadmap`, `fsd-spec` → `spec`, `fsd-spec-update` → `spec-update`, `fsd-plan` → `plan`, `fsd-plan-update` → `plan-update`, `fsd-execute-plan` → `execute-plan`, `fsd-restructure` → `restructure`, `fsd-help` → `help`, `fsd-add-task` → `add-task`, `fsd-do-task` → `do-task`. The generic `plan` skill that previously occupied the `plan/` directory slot was renamed to `workflow-plan` to free up the name. All cross-references in SKILL.md bodies updated from `/fsd-X` → `/fsd:X` convention. Backing scripts (`plan.js`, `spec.js`, `plan-update.js`, `spec-update.js`, `roadmap.js`, `new-project.js`, `architecture.js`, `config.js`, `init.js`, `restructure.js`, `validator.js`) updated: error-message skill pointers use the new `/fsd:X` form, comment references updated. 8 test files renamed from `test-fsd-*.js` → `test-skill-*.js` to avoid naming collision with existing script-level test files; all internal path and name assertions updated to match the new skill directory names and frontmatter `name:` values. README and CLAUDE.md skill references updated.

### Compatibility

**Breaking change (skill names).** Any saved slash-command shortcut referencing `/fsd:fsd-plan`, `/fsd:fsd-spec`, etc. must be updated to the new names. No `.fsd/` artifact schema changes; no config.yaml changes; no script API changes. All existing plan, spec, and research artifacts are unaffected.

---

## [0.13.0] - 2026-04-25

### Added

- **`fsd-statusline.js` hook** (FSD-017) — `Notification` hook (`async: false`) that renders a minimal `model | dirname | context_bar` statusline and writes the bridge file `/tmp/claude-ctx-{session_id}.json` used by the context monitor. Bridge payload: `{ session_id, remaining_percentage, used_pct, timestamp }` where `used_pct` is the raw CC value (`100 - remaining_percentage`, no buffer normalization). Context bar is 10 `█`/`░` segments coloured green < 50%, yellow < 65%, orange < 80%, blinking red ≥ 80%. Bridge write is best-effort (try/catch) and is skipped when `remaining_percentage` is absent or the session ID contains path-traversal sequences. Exports `renderStatusline(data)` and `writeBridge(sessionId, remaining)` for unit testing. New test file: `plugin/tests/test-statusline.js` (8 tests: bridge-file fields, absent-remaining no-write, path-traversal guard, model name in stdout, bar characters in stdout, dirname in stdout, export shapes).
- **`fsd-context-monitor.js` hook** (FSD-017) — `PostToolUse` hook (`async: true`) ported from GSD's `gsd-context-monitor.js` with FSD-specific adaptations. Reads the bridge file written by `fsd-statusline.js` and injects an `additionalContext` agent warning when remaining context drops below 35% (WARNING) or 25% (CRITICAL). Debounce: 5 tool uses between warnings; severity escalation (WARNING → CRITICAL) bypasses debounce. Stale metrics (> 60 s old) are ignored. FSD-specific adaptations: config opt-out path is `.fsd/config.json` (`hooks.context_warnings: false`); active-project detection uses `.fsd/` directory presence instead of GSD's `.planning/STATE.md`; GSD auto-state-recording block (`gsd-tools.cjs` spawn) removed entirely; warning messages use generic language with no GSD-specific command references. Session-ID path-traversal guard and 10-second stdin timeout retained from GSD source. New test file: `plugin/tests/test-context-monitor.js` (8 tests: no-file, above-threshold, WARNING, CRITICAL, stale, debounce, severity escalation, path-traversal guard).

### Changed

- **`plugin/hooks/hooks.json`** — added `Notification` entry (synchronous, `fsd-statusline.js`) and `PostToolUse` entry (asynchronous, `fsd-context-monitor.js`) alongside the existing `SessionStart` entry.

### Compatibility

Fully backward-compatible. Both hooks degrade gracefully: the statusline hook outputs a plain `model | dirname` line if `context_window` is absent; the context monitor exits silently if no bridge file is present (subagent / session with no statusline). Existing projects without `.fsd/config.json` are unaffected — the config opt-out check swallows read errors.

---

## [0.12.0] - 2026-04-24

### Added

- **`/fsd-execute-plan` skill** (FSD-009) — stateful plan executor that consumes an approved plan artifact and drives it to completion. Six-step flow: preconditions (`checkPlanPrecondition` refuses on missing plan / archived plan / zero `- [ ] **Phase NN**` entries / zero open `- [ ]` acceptance / missing or archived linked spec; warns on draft plan / unapproved spec) → pre-flight summary + single yes/no gate (plan title, N phases, resolved verification commands + source, version target, linked spec + FSD task, CHANGELOG + ARCHITECTURE.md presence) → phase execution loop with per-phase verification + progressive `- [ ]` → `- [x]` flips via `flip-phase` + mid-execution `adr:` chat-prefix ADR scratch-list capture + end-of-loop full regression re-run → acceptance walkthrough with evidence + progressive flips via `flip-ac` + `All criteria verified YYYY-MM-DD before commit.` header insertion → pipeline close-out behind one final ACK (CHANGELOG entry + version alignment across `plugin/.claude-plugin/plugin.json` + README header + CHANGELOG heading + `planning/to do/todo.md` task flip + plan `status → archived` + linked spec `approved → true` + optional ADR appends) → handoff with commit-boundary suggestions. No auto-commit. Verification discovery order: phase-body `verify:` backtick hint > plan frontmatter `verification:` > PROJECT.md `verification:` > ask engineer. Guardrails section forbids skipping the gate, proceeding past failed verification, flipping without evidence, editing the plan body or AC text to cheat, auto-committing, auto-pushing, applying close-out without ACK, bumping unnamed versions, silent ADR writes, dropping the spec check, and executing archived plans.
- **`parsePhases` / `flipPhase` / `flipAcceptance`** in `plugin/scripts/plan-update.js` — inline phase + acceptance checkbox machinery that pairs with the executor. `parsePhases` scans `## Phases` for `- [ ] **Phase NN** — <title>` entries (two-digit zero-padded; regex `/^-\s+\[([ xX])\]\s+\*\*Phase\s+(\d{2,})\*\*\s+—\s+(.+?)\s*$/`), tolerates freeform prose interleaved with checkboxes, and returns `[{ number, title, completed, lineIndex }]`. `flipPhase` flips `- [ ]` → `- [x]` on the matched phase line, byte-preserves every other line, bumps frontmatter `updated:` to today; refuses when the phase is missing or already complete. `flipAcceptance` does the same against the first `- [ ]` line in `## Acceptance` whose text contains the caller-supplied substring; refuses on no-match or already-complete. Both also ship as CLI ops (`flip-phase --id=... --phase-number=NN`, `flip-ac --id=... --line-matcher="<substring>"`).
- **`checkPlanPrecondition`** in `plugin/scripts/plan.js` — parallel to `checkSpecPrecondition`. Returns `{ ok, plan?: { meta, body, path, phases }, warnings, reason? }`. Lazy-requires `parsePlan` + `parsePhases` from `plan-update.js` to avoid the circular module load. Hard-fails on: missing plan file, `status: archived`, zero Phase NN checkbox entries, zero open `- [ ]` acceptance entries, missing linked spec (via existing `checkSpecPrecondition`), archived linked spec. Soft warnings: plan `status: draft`, linked spec `approved: false`.
- **`validateVerificationField`** in `plugin/scripts/validator.js` — validator helper for the new optional `verification:` frontmatter object. Absent → pass. Present → must be a mapping; each of `tests`, `validate`, `typecheck`, `lint` is optional and must be a non-empty string when set; unknown subfields surface as validator warnings (forward-compatible). Wired into `validateProject` and `validatePlan`; unchanged for `validateSpec`, `validateResearch`, `validateRoadmap`, `validateArchitecture`. Exports `VERIFICATION_SUBFIELDS` alongside.
- **Optional `verification:` frontmatter** on PROJECT.md and plan artifacts. Same shape at both levels; plan-level overrides PROJECT.md at execute time. `renderProject` and `renderPlan` emit the sub-object as YAML when present; empty-subfield entries are dropped. Round-trips through the bundled YAML parser (one-level nested object already supported).
- **New test file** — `plugin/tests/test-fsd-execute-plan.js` (18 tests: SKILL.md sanity across frontmatter + all 6 steps + every refusal path + every guardrail + cross-references + ADR prefix mechanic + checkPlanPrecondition integration across happy/missing/archived/no-phases/no-ACs/draft/unapproved-spec/archived-spec).
- **+35 tests across existing files** — `test-plan.js` (+12: phases-placeholder shape, renderPlan verification emit round-trip, `checkPlanPrecondition` happy-path + all six refusal paths + both warning paths), `test-plan-update.js` (+10: `parsePhases` minimal/multi/prose-interleaved/malformed-rejected, `flipPhase` happy-path + byte-preservation + already-complete + missing-phase + missing-file refusals, `flipAcceptance` happy-path + substring-match + missing-matcher + already-complete refusals, CLI smoke for both flip ops), `test-validator.js` (+5: `validateVerificationField` exports + all subfield combinations + non-object rejection + empty-subfield rejection + unknown-subfield warning + integration into `validateProject` and `validatePlan`), `test-project-context.js` (+2: verification propagation through `loadProjectContext.meta`, invalid verification surfaces as validation error), `test-fsd-new-project.js` (+3: SKILL prompt documentation, engineer-supplied round-trip, skip path), `test-fsd-plan.js` (+3: SKILL checkbox convention + verification override prompt + renderPlan phases placeholder snapshot).
- **`/fsd-help` skill** (FSD-016) — entry point and quick reference for the FSD framework. No backing script; the SKILL.md is the deliverable. Two dispatch modes: no-args prints the full overview (intro paragraph, core workflow numbered steps, skill index table with 9 rows, common patterns for "Starting a new project" / "Adding a feature" / "Revising a spec mid-flight" / "Updating the roadmap" / "Finding your place in a project"); skill-name arg (e.g. `/fsd-help fsd-plan`) prints a focused cheat sheet for that skill covering purpose, prerequisites, argument syntax, common invocations, and what to run next. Cheat sheets for all 8 current skills: `fsd-new-project`, `fsd-roadmap`, `fsd-spec`, `fsd-spec-update`, `fsd-plan`, `fsd-plan-update`, `fsd-execute-plan`, `fsd-restructure`. Unknown skill names return the known-skill list. Guardrails: read-only, never writes files, never chains skill invocations.
- **New test file** — `plugin/tests/test-fsd-help.js` (30 tests: file existence, frontmatter validity (name / description / argument-hint), all 8 skill names in body, overview + deep-dive + guardrails + common-patterns sections present, "Starting a new project" + "Adding a feature" patterns present, all 8 per-skill cheat sheet headings present, no unfilled `{{}}` template markers, no-args dispatch documented, `$ARGUMENTS` dispatch documented).

### Changed

- **`/fsd-plan` emits phases as inline checkbox entries** — `SECTION_META.phases.placeholder` now seeds `- [ ] **Phase 01** — _Phase title_\n  - _First step_\n  - _Second step_\n- [ ] **Phase 02** — _..._` so every newly authored plan is executor-ready without post-editing. SKILL.md Step 4 documents the convention (two-digit numbering, top-level checkbox, indented steps, freeform prose tolerated) and cross-references `parsePhases` as the single source of truth. No migration — `.fsd/plan/` had no real plans at the time of the change.
- **`/fsd-plan` frontmatter interview gains an optional plan-level `verification:` prompt** — engineer can override PROJECT.md's repo-wide commands per plan. SKILL.md prompts with the same `tests: ..., validate: ...` comma-syntax the `/fsd-new-project` prompt uses; 'skip' inherits from PROJECT.md.
- **`/fsd-new-project` interview gains an optional `verification:` prompt** — captures repo-wide `tests | validate | typecheck | lint` commands consumed by `/fsd-execute-plan`. Skippable; absent field leaves no footprint in PROJECT.md.
- **`/fsd-plan-update` gains two CLI ops** — `flip-phase` and `flip-ac` join the existing `update` / `archive` / `supersede` surface. Each returns `{ ok, written?, reason? }` JSON and exits 0/1 like the other ops; used directly by `/fsd-execute-plan`'s phase + AC loops but also usable by hand.
- **`plan.js` yaml emitter** extended to serialize one-level nested objects (`yamlLine` handles the `verification:` shape). `new-project.js`'s emitter gets the same treatment so PROJECT.md + plan frontmatter stay schema-consistent.
- **README** — added `/fsd-execute-plan` under Commands; expanded Project Context to document the optional `verification:` field at both PROJECT.md and plan levels; expanded Artifact Schemas to document the phase checkbox convention and the `adr:` chat-prefix mid-execution ADR capture mechanic; added `fsd-execute-plan` to the Core Skills authoring-surface table; noted `flip-phase` / `flip-ac` alongside the existing `/fsd-plan-update` ops.

### Compatibility

Fully backward-compatible. Existing PROJECT.md and plan artifacts without `verification:` continue to validate unchanged. The `/fsd-plan` phase-placeholder change only affects newly authored plans; plans written before 0.12.0 keep whatever structure they had, and `/fsd-execute-plan` simply refuses (with a pointer to `/fsd-plan-update`) if a plan lacks the checkbox convention. All existing CLI signatures on `plan.js`, `plan-update.js`, `validator.js`, and `new-project.js` are additive.

### Out of scope (flagged for follow-up)

- `/fsd-plan-update unarchive` op — engineer archives by running a plan through `/fsd-execute-plan`; no auto-unarchive route yet.
- Auto-detect of verification commands from `package.json` / `Makefile`. The explicit `verification:` field is the contract; auto-detect was deferred to avoid fragility.
- Multi-plan batch execution and parallel phase execution — one plan, serial phases.
- Rollback on phase failure. `/fsd-execute-plan` stops and surfaces; the engineer decides whether to fix + re-invoke or abandon. No `git reset` / `git stash` semantics.
- `depends_on:` resolution during execution. A plan with `depends_on: [other-plan]` surfaces a warning but does not block; chain-execution is a future FSD.
- Session-start header extension to surface plan-execution state. Loader stays as-is.
- CLI surface for scripted end-to-end plan execution without engineer interaction. The skill is interactive-only; automation is covered by the CLI entries on `plan.js` and `plan-update.js` for tests.

---

## [0.11.0] - 2026-04-24

### Added

- **`/fsd-plan-update` skill** (FSD-015) — ongoing-edits surface for plan artifacts, pairing with `/fsd-plan`'s create surface to complete the "create once, edit many" shape for plans (mirrors the `/fsd-spec` + `/fsd-spec-update` pair that FSD-006/014 established). Dispatches three surgical operations that re-validate via `validatePlan` before writing and preserve untouched sections byte-for-byte:
  - `update` — surgical edit of ONE thing per call: `title` (rewrites frontmatter + body `# <title>` heading in a single edit), `status` (flips draft ↔ active; refuses `archived` with a pointer to the `archive` op), `related` (add/remove one entry; `CROSS_REF`-validated), `tags` (add/remove one entry; `KEBAB_CASE`-validated), `depends_on` (add/remove one entry; `KEBAB_CASE`-validated), `task` (set non-empty string / clear removes key), `estimate` (set non-empty string / clear removes key), or one of the six canonical body sections (Context / Approach / Phases / Risks / Acceptance / Open questions). Running `update` with an unchanged value returns `{ ok: true, written: false }`; `clear` on an already-absent scalar is a no-op; `add` of a duplicate array entry is a no-op; `remove` of a missing array entry is an error (not silent success). `update remove-related` does NOT special-case the spec-hard-require link — engineer takes responsibility for keeping the plan authorable.
  - `archive` — flips frontmatter `status: archived`. Idempotent when already archived.
  - `supersede` — two-file cross-plan op: adds `oldId` to the new plan's `supersedes:` array AND flips old plan's `status` to `archived`; bumps `updated:` on both. Best-effort atomic: if the second write fails, the first is rolled back from an in-memory backup (covered by a deterministic rollback test). Idempotent when the new plan already lists the old id AND the old plan is already archived.
- **`plugin/scripts/plan-update.js`** — backing module exporting `parsePlan`, `readPlan`, `writePlanAtomic`, `rewriteFrontmatter`, `update`, `archive`, `supersede`, and `today`. The parser records line ranges for frontmatter, title line, and each body section (keyed by canonical `SECTION_ORDER` id imported from `plan.js`); user-authored extra `##` headings are tolerated (captured with `id: null` and still spliceable). `rewriteFrontmatter` handles both scalar edits and block-sequence array replacement with the same key-order preservation `spec-update.js` ships. Every op updates frontmatter `updated:` to today and re-validates via `validatePlan` before touching disk; failed writes leave the file on disk byte-unchanged (atomic tmp-file + rename).
- **`validatePlan.supersedes`** in `plugin/scripts/validator.js` — optional array of kebab-case plan ids, validated the same way `validateSpec.supersedes` already was. Additive one-line extension.
- **CLI entry point** on `plan-update.js` — `node scripts/plan-update.js <projectPath> <op> [--key=value ...]`. Exit 0 on success, 1 on op failure, 2 on invocation error. The skill's Step 5 delegates via this surface.
- **New test files** — `plugin/tests/test-plan-update.js` (32 tests: parser coverage for minimal/all-6-sections/unknown-heading-tolerance/malformed-frontmatter; every `update` sub-target including the three new ones (depends_on add/remove, task set/clear, estimate set/clear); byte-preservation of untouched sections; `archive` idempotency; `supersede` happy path + refusals when either plan is missing + idempotency when both halves already applied + `newId === oldId` rejection + deterministic rollback test that corrupts the old plan to force a second-write failure and verifies the new plan is restored from backup; every-op-bumps-`updated` sweep; round-trip through `scanArtifacts` after every op; refusal path when target plan doesn't exist) and `plugin/tests/test-fsd-plan-update.js` (8 integration tests: CLI update-title, CLI update-related add/remove roundtrip, CLI update-depends_on add/remove roundtrip, CLI update-task set/clear roundtrip, CLI archive against a missing plan, CLI supersede happy path + idempotency, CLI usage error exit code, and SKILL.md sanity — name, argument-hint, all three op names present, all eight update sub-targets present, `/fsd-plan` cross-reference, refuse-when-missing documentation, preview-before-write discipline, spec-hard-require footgun warning present in Guardrails, auto-commit forbidden).
- **+2 tests in `test-artifact-validator.js`** — `validatePlan.supersedes` accepts valid kebab-case array, rejects non-kebab entries. Mirrors the existing spec-supersedes tests.

### Changed

- **README.md** — Commands section adds `### /fsd-plan-update` with a per-op table; `/fsd-plan`'s entry updated to point at `/fsd-plan-update` as the editor. Artifact Schemas section adds `supersedes` to the plan-only optional fields list. Version header bumped to 0.11.0.

### Compatibility

Fully backward-compatible. No migration required:

- `validatePlan.supersedes` is additive — plans authored in 0.10.0 that don't set the field continue to validate identically. Plans that already set a (legal kebab-case) `supersedes` array only validate cleaner in 0.11.0.
- `loadContent` / `loadProjectContext` / `scanArtifacts` return shapes are all unchanged.
- `/fsd-plan-update` is additive — no existing skill or command behavior changes.

### Out of scope (intentional, follow-up work)

- `rename-id` — physically renames the plan file + updates frontmatter `id:` + rewrites cross-references in other specs/plans/research. Requires cross-file reference rewriting; follow-up FSD.
- `unarchive` — flip `status: archived` → active. Strict one-way op keeps the mental model clean for v1; add later if real usage demands it. There is no `unapprove` counterpart on plans because plans have no `approved` field.
- Edit history / audit log — no append-only record of who-edited-what.
- Mass/batch ops — editing many plans at once (e.g., "retag all plans with `legacy`").
- A "protect spec-link" guard on `update remove-related` — `/fsd-plan`'s spec-hard-require is enforced at create time, not at edit time; removing the sole `spec/<id>` entry leaves the plan unauthor-able by `/fsd-plan` but edit-able by this skill. Follow-up FSD if real usage surfaces footguns.
- Cross-file reference resolution on `related:`, `depends_on:`, and `supersedes:` — mirrors the FSD-004/005/006/007/008/014 stance: format-only validation.

---

## [0.10.0] - 2026-04-24

### Added

- **`/fsd-plan` skill** (FSD-008) — guided technical-implementation planning inside Claude Code's native plan mode. Engineer-led: the skill reads prior context and asks pointed questions only where that context doesn't cover. Produces a plan artifact under `.fsd/<structure.plan>/<id>.md` with six body sections (**Context**, **Approach**, **Phases**, **Risks**, **Acceptance**, **Open questions**). Six-step flow: preconditions (PROJECT.md precondition + spec-hard-require + no-overlap check) → `EnterPlanMode` → read-only context gathering → Socratic draft iteration → architecture delta → `ExitPlanMode` with the full payload + write on harness approval. Create-only; editing existing plans is deferred to a future `/fsd-plan-update` skill.
- **Hard spec linkage** — `/fsd-plan` refuses to run without a `related: spec/<id>` frontmatter entry that resolves to an existing spec file. Archived specs are hard-refused (`status: archived` → abort with a pointer to `/fsd-spec-update supersede`). Unapproved specs (`approved: false`) require explicit engineer opt-in via `acknowledgeUnapproved: true` at write time; the skill surfaces the warning verbatim and asks "proceed anyway? (yes/no)" before proceeding.
- **Narrowly-hinted context gathering** — inside plan mode, the skill reads the linked spec (full), PROJECT.md, ROADMAP.md, ARCHITECTURE.md (if present), the frontmatter + titles of every existing plan, and any files the spec explicitly names (plus greps for symbols it mentions). No broad repo scan. The engineer can request additional reads during the Socratic discussion.
- **`planning/ARCHITECTURE.md` — new long-lived project-level artifact.** Lives alongside PROJECT.md and ROADMAP.md. Seven canonical body sections: **Stack & Technical Details** / **Decisions** (ADR-style, newest-first) / **Code Examples** / **References** / **Standards** / **Glossary** / **Open architectural questions**. `/fsd-plan` owns both creation (lazy: the skill offers to create it on first run with no engineer ARCHITECTURE.md present, seeded from this plan's technical decisions) and maintenance (append-on-every-run: ADR entries prepended under `## Decisions`; other six sections append in place with placeholder-strip on first real content). Every append bumps frontmatter `updated:` to today and re-validates via `validateArchitecture` before touching disk; failed writes leave the file byte-unchanged.
- **`plugin/scripts/plan.js`** — backing module exporting `renderPlan`, `writePlanFile`, `resolvePlanPath`, `checkSpecPrecondition`, `today`, `SECTION_ORDER`, and `SECTION_META`. `renderPlan` emits frontmatter + all six `##` section headings (skipped sections retain their italic placeholder). `writePlanFile` auto-injects `project:` from PROJECT.md when the caller omits it, enforces the spec-hard-require, pre-validates via `validatePlan`, refuses to overwrite, and writes atomically (tmp + rename). `checkSpecPrecondition` is exported separately so the skill can exercise the missing/archived/unapproved branches during Step 1.
- **`plugin/scripts/architecture.js`** — backing module exporting `parseArchitecture`, `renderArchitecture`, `createArchitectureFile`, `appendDecision`, `appendToSection`, `rewriteFrontmatter`, `today`, `ARCHITECTURE_FILENAME`, `SECTION_ORDER`, `SECTION_META`, and `HEADING_TO_ID`. The parser records line ranges for frontmatter and every `##` section so append ops splice the file directly (mirrors `roadmap.js` and `spec-update.js`). Unknown H2 headings are tolerated (captured with `id: null`) so engineer-authored extras don't break the parser.
- **`validateArchitecture`** in `plugin/scripts/validator.js` — reuses `validateProjectContextCommon` (same required fields as PROJECT/ROADMAP: `project`, `id` kebab-case, `title`, `status`, `created`; same optional fields `updated`, `tags`). No architecture-specific extensions in v1.
- **CLI entry points** — `node scripts/plan.js <projectPath> [--json=<path> | --id=... --title=... --related=spec/<id> ...]` accepts a JSON payload or flag-style args; exits 0 / 1 / 2 for success / op failure / invocation error. `node scripts/architecture.js <planningDir> <create|append-decision|append-to-section> [--key=value ...]` dispatches to the three ops with the same exit-code contract. Both CLI surfaces are stable — the skill's Step 6 delegates via them.
- **`loadProjectContext` extended with third `architecture` field.** Return shape now `{ project, roadmap, architecture, validation: { project, roadmap, architecture } }`. Architecture entry follows the same `{ meta, body, path, validation } | null` shape as the other two. Additive — existing callers that only destructure `project` and `roadmap` are unaffected.
- **New test files** — `plugin/tests/test-architecture.js` (24 tests: exports + constants, validator happy/fail paths, parser canonical-sections/unknown-heading-tolerance/malformed-frontmatter, renderer with/without user content, createArchitectureFile happy/refuse-to-overwrite/PROJECT.md-missing/explicit-project-bypass, appendDecision placeholder-strip/newest-first/updated-bump/refuse-if-missing/required-fields/byte-preservation, appendToSection placeholder-replace/subsequent-append/refuse-unknown-section/refuse-decisions-via-wrong-op/refuse-if-missing, multi-op round-trip stability), `plugin/tests/test-plan.js` (22 tests: exports, renderPlan minimal/full/placeholder, optional-field serialization gating, resolvePlanPath default/config-override, checkSpecPrecondition all four branches, writePlanFile happy/config-override/refuse-overwrite/pre-validation/PROJECT.md-auto-inject, spec-hard-require no-related/no-spec-link/missing-spec/archived-spec/unapproved-without-ack/unapproved-with-ack, round-trip via scanArtifacts), `plugin/tests/test-fsd-plan.js` (16 integration tests: CLI happy/no-spec-link/missing-spec/archived-spec/unapproved-without-ack/unapproved-with-ack/usage-error, architecture CLI create-then-append-decision-then-append-to-section smoke + usage error, SKILL.md sanity covering name + argument-hint + all six steps + EnterPlanMode/ExitPlanMode references + `/fsd-spec`/`/fsd-execute-plan`/`/fsd-new-project` cross-references + spec-hard-require/spec-status rules documentation + ARCHITECTURE.md create/append mechanics documentation + all six plan body sections mentioned + Guardrails cover plan-mode boundary + overwrite refusal + auto-commit prohibition).
- **+5 tests in `test-project-context.js`** — `validateArchitecture` minimal-valid / missing-required-fields / optional-tags-format, `loadProjectContext` architecture-present / architecture-invalid paths.
- **+2 tests in `test-loader.js`** — `loadContent.projectContext.architecture` present when file exists and valid, null when file absent.

### Changed

- **README.md** — Commands section adds `### /fsd-plan` with the full six-step flow documented. Project Context section now introduces the trio (PROJECT + ROADMAP + **ARCHITECTURE**) and documents the ARCHITECTURE.md schema with a worked example showing the 7-section shape and a sample ADR Decisions entry. Artifact Schemas section adds a note that `/fsd-plan` enforces the spec-hard-require at author time, orthogonal to the validator's format-only checks. Version header bumped to 0.10.0.
- **`loadProjectContext` return shape** — additively extended with `architecture` and `validation.architecture`. Callers that don't destructure these are unaffected.
- **`plugin/scripts/validator.js` exports extended** — adds `validateArchitecture` alongside the existing validator family.

### Compatibility

Fully backward-compatible. No migration required:

- No schema change affects existing artifacts — `validateSpec`, `validatePlan`, `validateResearch`, `validateProject`, `validateRoadmap` all unchanged. Plans authored in `.fsd/<structure.plan>/` prior to this release (none in any repo yet, since this is the first authoring surface for them) continue to validate identically.
- `loadProjectContext` return shape is additively extended — callers that don't destructure the new `architecture` key are unaffected.
- Session-start header output is unchanged — ARCHITECTURE.md is read but not surfaced in the one-line header (`Project: <name> — Milestone: <current> (v<version>)`).
- `/fsd-plan` is additive; no existing skill or command behavior changes.

### Out of scope (intentional, follow-up work)

- `/fsd-plan-update` — editing existing plans, flipping status, appending phases, adding `depends_on:` entries, archiving stale plans. Separate future FSD (to be captured after the first real plan has been hand-edited, mirroring the FSD-006 → FSD-014 pattern).
- `/fsd-architecture` as a dedicated authoring surface for ARCHITECTURE.md. `/fsd-plan` is the only writer in v1; a dedicated skill can be added later if the append-on-plan mechanic proves insufficient for pure-architecture decisions that don't fit inside a plan's flow.
- ARCHITECTURE.md update/archive ops beyond the append/edit-in-place semantics defined here — no rename, no ADR supersede chain, no per-section delete.
- Surfacing ARCHITECTURE.md in the session-start header — a future FSD can extend the header if the project wants architecture info there too.
- Cross-file reference resolution at validator level — `validatePlan` does not check that `related: spec/<id>` points at a real file. The skill enforces the hard-require at author time; `/fsd:validate --plans` remains format-only (mirrors the FSD-004 stance).
- Multi-plan batch creation (one plan per `/fsd-plan` invocation).

---

## [0.9.0] - 2026-04-24

### Added

- **`/fsd-spec-update` skill** (FSD-014) — ongoing-edits surface for spec artifacts, pairing with `/fsd-spec`'s create surface to complete the "create once, edit many" shape for specs (mirrors the `/fsd-new-project` + `/fsd-roadmap` split). Dispatches four surgical operations that re-validate via `validateSpec` before writing and preserve untouched sections byte-for-byte:
  - `update` — surgical edit of ONE thing per call: `title` (rewrites frontmatter + body `# <title>` heading in a single edit), `status` (flips draft ↔ active; refuses `archived` with a pointer to the `archive` op), `related` (add/remove one entry; `CROSS_REF`-validated), `tags` (add/remove one entry; `KEBAB_CASE`-validated), or one of the six canonical body sections (Problem / Goals / Non-goals / Requirements / Acceptance / Open questions). Running `update` with an unchanged value returns `{ ok: true, written: false }`.
  - `approve` — flips frontmatter `approved: true`. Idempotent — re-running on an already-approved spec returns `{ ok: true, written: false, reason: "already approved" }` and does not touch disk.
  - `archive` — flips frontmatter `status: archived`. Idempotent when already archived.
  - `supersede` — two-file cross-spec op: adds `oldId` to the new spec's `supersedes:` array AND flips old spec's `status` to `archived`; bumps `updated:` on both. Best-effort atomic: if the second write fails, the first is rolled back from an in-memory backup (covered by a deterministic rollback test). Idempotent when the new spec already lists the old id AND the old spec is already archived.
- **`plugin/scripts/spec-update.js`** — backing module exporting `parseSpec`, `readSpec`, `writeSpecAtomic`, `rewriteFrontmatter`, `update`, `approve`, `archive`, `supersede`, and `today`. The parser records line ranges for frontmatter, title line, and each body section (keyed by canonical `SECTION_ORDER` id imported from `spec.js`); user-authored extra `##` headings are tolerated (captured with `id: null` and still spliceable). `rewriteFrontmatter` handles both scalar edits and block-sequence array replacement with the same key-order preservation `roadmap.js` ships. Every op updates frontmatter `updated:` to today and re-validates via `validateSpec` before touching disk; failed writes leave the file on disk byte-unchanged (atomic tmp-file + rename).
- **CLI entry point** on `spec-update.js` — `node scripts/spec-update.js <projectPath> <op> [--key=value ...]`. Exit 0 on success, 1 on op failure, 2 on invocation error. The skill's Step 4 delegates via this surface.
- **New test files** — `plugin/tests/test-spec-update.js` (32 tests: parser coverage for minimal/all-6-sections/unknown-heading-tolerance/malformed-frontmatter; every `update` sub-target including byte-preservation of untouched sections; `approve` / `archive` idempotency; `supersede` happy path + refusals when either spec is missing + idempotency when both halves already applied + `newId === oldId` rejection + deterministic rollback test that corrupts the old spec to force a second-write failure and verifies the new spec is restored from backup; every-op-bumps-`updated` sweep; round-trip through `scanArtifacts` after every op; refusal path when target spec doesn't exist) and `plugin/tests/test-fsd-spec-update.js` (7 integration tests: CLI update-title, CLI update-related add/remove roundtrip, CLI approve + idempotency, CLI archive against a missing spec, CLI supersede, CLI usage error exit code, and SKILL.md sanity — name, all four op names present, `/fsd-spec` cross-reference, refuse-when-missing documentation, preview-before-write discipline).

### Changed

- **README.md** — Commands section adds `### /fsd-spec-update` with a per-op table; `/fsd-spec`'s entry updated to point at `/fsd-spec-update` as the editor. Project Context section adds a paragraph framing the spec pair as "create once, edit many" — mirroring the existing `/fsd-new-project` + `/fsd-roadmap` split.

### Compatibility

Fully backward-compatible. No migration required:

- No schema change — `validateSpec` already supports every frontmatter field this skill edits (`status`, `approved`, `supersedes`, `related`, `tags`, `title`, `updated`). Specs created by the `/fsd-spec` create path in 0.8.0 are edit-compatible without modification.
- `loadContent` / `loadProjectContext` / `scanArtifacts` return shapes are all unchanged.
- `/fsd-spec-update` is additive — no existing skill or command behavior changes.

### Out of scope (intentional, follow-up work)

- `rename-id` — physically renames the spec file + updates frontmatter `id:` + rewrites cross-references in other specs/plans/research. Requires cross-file reference rewriting; follow-up FSD.
- `unapprove` (flip `approved: true` → false) and `unarchive` (flip `status: archived` → active). Strict one-way ops keep the mental model clean for v1; add later if usage demands.
- Edit history / audit log — no append-only record of who-edited-what.
- Mass/batch ops — editing many specs at once (e.g., "retag all specs with `legacy`").
- Cross-file reference resolution on `related:` and `supersedes:` — mirrors the FSD-004/005/006/007 stance: format-only validation.

---

## [0.8.0] - 2026-04-24

### Added

- **`/fsd-spec` skill** (FSD-006) — create-only authoring skill for spec artifacts under `.fsd/<structure.spec>/<id>.md`. Interviews the user one question at a time for frontmatter (`id`, `title`, `status`, `approved`, `related`, `tags`) and six body sections — **Problem**, **Goals**, **Non-goals**, **Requirements**, **Acceptance**, **Open questions** — then renders a markdown file with validated YAML frontmatter and atomic write. Refuses to overwrite existing specs; editing is deferred to a future `/fsd-spec-update` skill.
- **PROJECT.md soft-prerequisite with chain-invocation** — the skill's Step 1 reads `planning/PROJECT.md` via `loadProjectContext`. If PROJECT.md is missing, the skill offers to chain-invoke `/fsd-new-project` before resuming the spec interview. If PROJECT.md exists but fails `validateProject`, the skill aborts with the errors printed verbatim (does NOT chain-invoke, since new-project refuses to overwrite). If PROJECT.md is valid but ROADMAP.md is missing, the skill prints a soft warning and proceeds.
- **`plugin/scripts/spec.js`** — backing module exporting `renderSpec`, `writeSpecFile`, `resolveSpecPath`, `today`, `SECTION_ORDER`, and `SECTION_META`. `renderSpec` emits frontmatter + all six `##` section headings (skipped sections retain their italicized placeholder copy so the structure is always present for later editing). `writeSpecFile` auto-injects `project:` from `planning/PROJECT.md` when the caller omits it, validates via `validateSpec` before touching disk, refuses to overwrite, and writes atomically via tmp-file + rename.
- **CLI entry point** on `spec.js` — `node scripts/spec.js <projectPath> [--json=<path> | --id=... --title=... ...]` prints a single line of JSON (`{ ok, written?, skipped?, reason? }`) and exits 0 on success, 1 on op failure, 2 on invocation error. The skill's Step 5 delegates via this surface.
- **Config-aware location** — the backing module honors `getStructure(config).spec` the same way `/fsd:add` and the loader do, so `/fsd-restructure` can rename the spec directory (`spec` → `specifications`, etc.) and `/fsd-spec` follows automatically without code changes.
- **New test files** — `plugin/tests/test-spec.js` (17 tests: module exports, `renderSpec` with minimal/full/placeholder/skipped-section inputs, `approved`/array omission rules, `resolveSpecPath` default + config override, `writeSpecFile` happy path, refuse-to-overwrite with byte-preserved original content, pre-write validation failure on bad `id` or invalid `related`, missing-required-field refusals, config.structure.spec rename path, PROJECT.md missing/invalid/direct-injection paths, atomicity under injected failure, round-trip through `scanArtifacts`) and `plugin/tests/test-fsd-spec.js` (6 tests: CLI happy path via `--json` payload + via flag-style args, refuse-to-overwrite via CLI, missing-PROJECT.md abort via CLI, usage error on missing projectPath, SKILL.md sanity including `name: fsd-spec` + documented create-only contract + cross-references to `/fsd-new-project` and `/fsd-plan` + coverage of all six body-section names).

### Changed

- **README.md** — Commands section documents `/fsd-spec [title]`; Project Context section adds a paragraph explaining that downstream artifact skills read PROJECT.md on demand to inject project framing, and that `/fsd-spec` offers to chain-invoke `/fsd-new-project` when PROJECT.md is missing.

### Compatibility

Fully backward-compatible. No migration required:

- No schema change — `validateSpec` and the artifact-scanner contract are both unchanged. Existing specs (none in any repo yet, since this release is the first authoring surface for them) continue to validate identically.
- `loadProjectContext` / `scanArtifacts` / `loadContent` return shapes are unchanged.
- `/fsd-spec` is additive — no existing skill or command behavior changes.

### Out of scope (intentional, follow-up work)

- Editing existing specs, flipping `approved`, archiving specs, recording `supersedes:` on a new spec while archiving the old one — future `/fsd-spec-update` skill (to be captured as a separate FSD after at least one real spec has been written and edited by hand).
- Cross-file reference resolution — e.g., checking that a spec's `related: plan/foo` actually points at an existing plan in `.fsd/plan/`. Mirrors the FSD-004/005/007 stance: format-only validation.
- Multi-spec batch creation.

---

## [0.7.0] - 2026-04-23

### Added

- **`/fsd-roadmap` skill** (FSD-007) — mid-project maintenance for `planning/ROADMAP.md`. Dispatches five surgical operations that edit the file in place while preserving user-authored goal prose and re-validating the schema on every write:
  - `add-milestone` — appends a new `## Milestone <id>` block; optional `setCurrent` flips frontmatter `current_milestone` and `version` to the new milestone's values.
  - `add-phase` — inserts a new `### Phase <id> — <title>` block into a named milestone without disturbing other milestones.
  - `advance` — marks the current milestone shipped via a `**Status:** shipped (YYYY-MM-DD)` body line, flips `current_milestone` to the next milestone in source order, and adopts that milestone's `**Version:**` into frontmatter `version`. Errors when the current milestone is the last one (user must `/fsd-roadmap add-milestone` first).
  - `complete-phase` — marks a named phase shipped via a body status line.
  - `bump-version` — frontmatter `version:` bump for patch-style increments mid-milestone; rejects non-semver input and no-op bumps.
  - `advance` and `complete-phase` are idempotent — re-running on an already-shipped section returns `{ ok: true, written: false }` with a reason instead of double-inserting status lines.
- **`plugin/scripts/roadmap.js`** — backing module exporting `parseRoadmap`, `readRoadmap`, `writeRoadmapAtomic`, `rewriteFrontmatter`, `addMilestone`, `addPhase`, `advance`, `completePhase`, `bumpVersion`, and `today`. The parser records line-range pairs for frontmatter and every milestone/phase section, so each op splices the file directly — no full re-render. Every op updates frontmatter `updated:` to today and re-validates via `validateRoadmap` before touching disk; failed writes leave the file on disk unchanged (atomic tmp-file + rename).
- **CLI entry point** on `roadmap.js` — `node scripts/roadmap.js <roadmapPath> <op> [--key=value ...]` prints a single line of JSON (`{ ok, reason?, written? }`) and exits 0 on success, 1 on op failure, 2 on unknown op. The skill's Step 5 delegates via this surface.
- **New test files** — `plugin/tests/test-roadmap.js` (25 tests: parser coverage for minimal/multi-milestone/multi-phase/shipped markers/malformed frontmatter; happy paths and refusal paths for all five ops; round-trip validation across a 5-op sequence; byte-preservation of wonky user-authored goal prose; atomicity under injected validation failure; two CLI-entry integration tests) and `plugin/tests/test-fsd-roadmap.js` (8 integration tests: each op via `execFileSync`, CLI failure exit codes, SKILL.md sanity including name, op coverage, and refuse-when-missing documentation).

### Changed

- **README.md** — Commands section documents `/fsd-roadmap` with a per-op table; Project Context section updated to frame the pair as "create once, edit many" and point at `/fsd-roadmap` as the ongoing-edits surface.

### Compatibility

Fully backward-compatible. No migration required:

- `validateRoadmap` and the `fsd-new-project` render output are both unchanged — the new `**Status:** shipped (YYYY-MM-DD)` body marker is additive content, not a schema field. Existing repos (only this one, since 0.6.0 shipped today) work with no edits.
- `loadContent` / `loadProjectContext` return shape is unchanged. Session-start header behavior is unchanged.
- `/fsd-roadmap` is additive — no existing skill or command behavior changes.

### Out of scope (intentional, follow-up work)

- Renaming or reordering existing milestones/phases — users edit the file directly; any follow-up skill would want full parse+render with preservation guarantees.
- Editing milestone/phase goal prose — the skill only adds structure and status markers. Users hand-edit prose.
- Cross-file reference resolution — e.g., checking that a phase id matches a real plan in `.fsd/plan/`. Mirrors the FSD-004/005 stance: format-only validation.
- Multi-roadmap support.

---

## [0.6.0] - 2026-04-23

### Added

- **Project context artifacts** (FSD-005) — `planning/PROJECT.md` and `planning/ROADMAP.md` capture project framing (identity, scope, tech context, success metrics, anti-goals, versioned milestones → numbered phases) once at the start of a project, and every downstream skill reads from them.
  - `validateProject` + `validateRoadmap` in `plugin/scripts/validator.js` enforce the frontmatter schemas; both return the familiar `{ valid, errors, warnings }` shape.
  - PROJECT.md required fields: the common artifact vocabulary (`project`, `id` kebab-case, `title`, `status`, `created`) plus optional `vision` (string) and `target_users` (array of strings).
  - ROADMAP.md adds `version` (semver-like, validated by the new `SEMVER_LIKE` regex) and `current_milestone` (string id matching a `## Milestone <id>` heading in the body). The validator enforces format only — cross-ref resolution will land with `/fsd-roadmap` (FSD-007).
- **`/fsd-new-project` skill** at `plugin/skills/fsd-new-project/SKILL.md` — interactive one-time kickoff. Gathers PROJECT + ROADMAP context one question at a time, validates the rendered frontmatter, writes both files, and hard-refuses to overwrite either one if already present.
- **`plugin/scripts/new-project.js`** — backing module exporting `renderProject`, `renderRoadmap`, `writeProjectFiles`, and the canonical filenames. The skill delegates its Step 4 write to this module so the logic is testable in isolation.
- **`loadProjectContext({ planningDir })`** in `plugin/scripts/loader.js` — on-demand reader returning `{ project, roadmap, validation }` with `null` for absent files. Never throws on missing files.
- **Session-start project header** — when both PROJECT.md and ROADMAP.md are present and pass validation, the session-start hook prints a single line: `Project: <name> — Milestone: <current> (v<version>)`. Header is hidden on any absence or schema failure so session start never emits scary errors.
- **New test files** — `plugin/tests/test-project-context.js` (22 tests: validators, `loadProjectContext`, `writeProjectFiles` happy path + refuse-to-overwrite, round-trip via rendered output, `loadContent` surfaces `projectContext`) and `plugin/tests/test-fsd-new-project.js` (3 integration tests running the backing script via `execFileSync` + skill file sanity check).
- **+1 test in `test-init.js`** — asserts the post-init message in `plugin/commands/init.md` recommends `/fsd-new-project` as the next step.

### Changed

- **`loadContent` return shape is additively extended** — now returns `{ skills, agents, commands, validationSummary, projectContext }`. `projectContext` is the result of `loadProjectContext` scoped to the repo's `planning/` dir (sibling of `.fsd/`). Prior fields are unchanged; callers that ignore the new field are unaffected.
- **`plugin/scripts/session-start-loader.js`** — destructures the new `projectContext` from `loadContent` and emits the project header when valid.
- **`plugin/commands/init.md`** — post-init message now points at `/fsd-new-project` as the recommended follow-up, with a one-sentence rationale about shared context for downstream skills.
- **`README.md`** — new **Project Context** subsection under "Content Schemas" documents the PROJECT.md and ROADMAP.md schemas with worked examples. Commands section describes `/fsd-new-project` and its relationship to `/fsd:init`.
- **`plugin/scripts/validator.js` exports extended** — adds `validateProject`, `validateRoadmap`, and the `SEMVER_LIKE` regex constant alongside the existing artifact exports.

### Compatibility

Fully backward-compatible. No migration required:

- Existing repos without `planning/PROJECT.md` or `planning/ROADMAP.md` continue to work; the session-start header simply hides itself until both files exist and validate.
- `loadContent` callers that don't destructure the new `projectContext` key are unaffected.
- The plain `/fsd:validate` (and `--artifacts`) flows are unchanged — PROJECT.md and ROADMAP.md are validated on demand by `loadProjectContext` or the session-start header, not via the artifact scanner.

### Out of scope (intentional, follow-up work)

- `/fsd-roadmap` authoring/maintenance skill for editing the roadmap mid-project (FSD-007).
- Cross-file reference resolution (verifying `current_milestone` points at a real heading, verifying phase ids match real specs/plans) — validator enforces format only, mirroring the FSD-004 artifact-schema stance.
- Multi-project support in one repo (one PROJECT.md per repo for now).

---

## [0.5.0] - 2026-04-23

### Added

- **Artifact metadata schemas** (FSD-004) for the three storage kinds (`spec`, `plan`, `research`). Frontmatter is enforced at scan time; the schema is the contract that the future `/fsd-spec`, `/fsd-plan`, `/fsd-research` skills will author against.
  - Common required fields: `project`, `id` (kebab-case, must match filename stem), `title`, `status` (`draft|active|archived`), `created` (ISO date).
  - Common optional fields: `updated`, `tags`, `related` (cross-refs `<spec|plan|research>/<kebab-id>`).
  - Spec extras: `approved` (boolean), `supersedes` (array of spec ids).
  - Plan extras: `task` (string, often FSD-NNN), `depends_on` (array of plan ids), `estimate` (string).
  - Research extras: `sources` (array of http(s) URLs), `conclusion` (string).
  - Unknown frontmatter keys pass through silently (lenient, matches existing skill/agent/command behavior).
- **`validateSpec`, `validatePlan`, `validateResearch`** in `plugin/scripts/validator.js`, each returning `{ valid, errors, warnings }` to match the existing validator shape. Also exports `ARTIFACT_STATUSES`, `ARTIFACT_VALIDATORS`, and the regex constants `KEBAB_CASE`, `ISO_DATE`, `CROSS_REF`, `URL_PATTERN`.
- **`scanArtifacts({ fsdDir, kind, dirName })`** in `plugin/scripts/loader.js` — on-demand storage-kind scanner. Reads `*.md` files (skips `.gitkeep`), runs the matching validator, and treats a frontmatter `id` that disagrees with the filename stem as a hard validation error. Not used by `loadContent`; session-start cost is unaffected.
- **`/fsd:validate --artifacts`** plus per-kind narrowing: `--specs`, `--plans`, `--research`. Renders one section per kind with the same `ok/WARN/ERR` formatting as the scannable kinds, rolled into a single combined `Summary:` line. Exit code is non-zero when any errors are present.
- **New test file `plugin/tests/test-artifact-validator.js`** — 26 tests covering per-kind validation (minimal/full, every required field, status enum, ISO dates, kebab-case, cross-refs, kind-specific extras, lenient unknown keys) and three `/fsd:validate --artifacts` integration tests via `execFileSync` against a fixture project.
- **+8 tests in `test-loader.js`** for `scanArtifacts`: empty dir, finds `.md` and skips `.gitkeep`, attaches validation, detects filename/id mismatch, honors a renamed dir from `config.structure`, returns `[]` for nonexistent dirs, throws on unknown kind, and a defensive regression that `loadContent` never surfaces artifacts.

### Changed

- **`plugin/commands/validate.md`** — `argument-hint` now lists the new `--artifacts`, `--specs`, `--plans`, `--research` flags; body documents on-demand artifact scanning.
- **`/fsd:validate` no-flag behavior preserved** — running it with no flags continues to scan only the scannable kinds (skills/agents/commands). Artifact validation requires an explicit flag, so the default invocation matches the session-start loader's cost characteristics.
- **`README.md`** — new **Artifact Schemas** subsection under "Content Schemas" with a worked example for each kind; Commands section documents the new `/fsd:validate` filters.
- **`plugin/commands/init.md`** — post-init message points at the artifact schema in the README and the `/fsd:validate --artifacts` command.

### Compatibility

Fully backward-compatible. No migration required:

- `validateSkill` / `validateAgent` / `validateCommand` signatures and behavior are unchanged.
- `loadContent` return shape is unchanged — no `artifacts` key was added; storage kinds remain invisible to the loader by design (verified by a defensive regression test).
- The plain `/fsd:validate` invocation produces the same output it did in 0.4.0; new behavior is opt-in via the new flags.

### Out of scope (intentional, follow-up work)

- Cross-artifact reference resolution (whether `plan.depends_on` actually points at a real plan) — the validator enforces *format only*; existence checking will land alongside the authoring skills.
- Auto-generated artifact index / TOC.
- The authoring skills themselves (FSD-006 / FSD-008 / FSD-010).
- A fourth `roadmap` storage kind (will mirror this pattern when FSD-007 lands).

---

## [0.4.0] - 2026-04-22

### Added

- **Three new storage kinds under `.fsd/`** (FSD-013) — `spec/`, `plan/`, `research/`. Each is a configurable directory for artifacts produced by the corresponding (future) `fsd-spec` / `fsd-plan` / `fsd-research` skills.
  - Scaffolded automatically by `/fsd:init`, each with a `.gitkeep` so git tracks them while empty.
  - Fully configurable via `structure:` in `config.yaml` — same rename semantics as the existing scannable kinds.
  - Renameable via `/fsd-restructure` — preview / apply / stale-reference flagging all work identically to renaming scannable kinds.
- **`SCANNABLE_KINDS` / `STORAGE_KINDS` split** in `plugin/scripts/validator.js` — the public surface now distinguishes loadable content (`skills`, `agents`, `commands`) from artifact storage (`spec`, `plan`, `research`). `STRUCTURE_KEYS` remains the union.
- **+13 tests across the suite** covering the new storage-kind behavior: validator acceptance, init scaffold with `.gitkeep`, `/fsd:add` rejection for storage kinds, restructure rename + alias detection across classes, and a defensive loader test that storage kinds can never be accidentally scanned.

### Changed

- **`DEFAULT_STRUCTURE`** — extended to 6 keys (added `spec`, `plan`, `research`).
- **`CONFIG_TEMPLATE`** in `init.js` — `structure:` section now groups scannable and storage kinds with separate headers and lists all 6 commented defaults.
- **`/fsd:add`** now explicitly rejects storage kinds with a message pointing to the owning skill: `"spec content is managed by the /fsd-spec skill, not /fsd:add"`. Prevents users from accidentally creating spec/plan/research entries through the wrong authoring path.
- **`rewriteConfigStructure`** in `scripts/restructure.js` — iterates `STRUCTURE_KEYS` dynamically when emitting the all-defaults commented example, so future additions propagate automatically without code changes.
- **`/fsd-restructure` skill** (`plugin/skills/fsd-restructure/SKILL.md`) — description, argument-hint usage, and Guardrails section updated to reflect the 6-kind scope (was "3 known kinds").
- **`plugin/commands/init.md`** — post-init report now lists all 6 subdirectories, grouped into scannable vs storage classes with short explanations of each.
- **`README.md`** — Configuration section's `structure:` example extends to all 6 kinds, grouped by class.

### Compatibility

No migration required. This is the first release of the `spec`/`plan`/`research` kinds, and no v0.3.0 projects exist in the wild — fresh `/fsd:init` produces the 6-dir layout directly. The `loader.js` implementation is unchanged; it explicitly names only scannable kinds, so storage dirs stay invisible to scan/activation by design. Existing test fixtures and callers of `previewRestructure` / `applyRestructure` that pass full `structure:` objects (e.g. via `getStructure`) work without modification.

---

## [0.3.0] - 2026-04-22

### Added

- **Configurable project directory structure** (FSD-003) — new `structure:` section in `.fsd/config.yaml` lets users rename the `skills/`, `agents/`, and `commands/` subdirectories individually. Partial overrides supported; unset keys fall back to defaults.
  - `getStructure(config)` helper in `scripts/config.js` with partial-override semantics
  - `DEFAULT_STRUCTURE` exported constant
  - `validateStructure()` in `scripts/validator.js` rejects unknown kinds, path separators, leading dots, reserved names (`config.yaml`, `.state.yaml`), and aliases (two kinds pointing at the same directory)
- **`/fsd-restructure` skill** — rename content-kind directories safely after install. Preview-first (rename ops + stale-reference detection), confirmation-gated, surgical `config.yaml` rewrite. Safety rules: refuses target-already-exists, reserved names, aliases, and (without `--force`) uncommitted changes under `.fsd/`. Flags stale references in content bodies but does **not** auto-rewrite user-authored prose.
- **`/fsd-add-task` skill** — manages entries in `planning/to do/todo.md` with auto-incremented `FSD-NNN` numbering. Defaults to quick-add (single-line bullet); `--detail` flag creates a full `task-fsd-NNN.md` workup with source / summary / assessment / plan / acceptance-criteria sections.
- **`scripts/restructure.js`** — new module exporting `previewRestructure`, `applyRestructure`, `rewriteConfigStructure`, `findStaleReferences`; includes CLI entry point.
- **New test file `test-restructure.js`** — 16 integration tests covering preview, apply, config rewrite, stale-reference detection, and idempotency.
- **+34 unit tests** across `test-config.js`, `test-validator.js`, `test-loader.js`, `test-init.js`, `test-add.js` covering structure-driven behavior.

### Changed

- **`scripts/loader.js`** — `scanSkills` / `scanAgents` / `scanCommands` now accept an optional `dirName` parameter (defaults preserve the previous literal); `loadContent` resolves structure once from merged config and passes dir names into the scan functions. Fully backward-compatible — callers without `dirName` get the legacy behavior.
- **`scripts/add.js`** — `addContent` accepts an optional `config` parameter; the CLI entry point loads config first so project-level `structure:` overrides are honored automatically.
- **`scripts/init.js`** — subdirectory scaffold now loops over `getStructure(config)` rather than three hardcoded `mkdirSync` calls; `CONFIG_TEMPLATE` includes a commented `structure:` section documenting defaults.
- **Repo layout** (FSD-002) — plugin content relocated under `plugin/` to match Claude Code's marketplace plugin layout. Adds `.claude-plugin/marketplace.json` and `plugin/.claude-plugin/plugin.json`.
- **Planning docs location** (FSD-012) — `docs/plans/` renamed to `planning/to do/` for a shorter top-level name; relative links updated throughout.
- **Documentation** — README Configuration section now documents `structure:` with an example and links to `/fsd-restructure`; `plugin/commands/init.md` mentions configurable kinds and the restructure skill; `planning/2026-03-02-fsd-framework-design.md` annotated to clarify directory names are configurable.

### Compatibility

Fully backward-compatible at the user level. No migration required:

- Configs without `structure:` → loader uses the previous hardcoded defaults (`skills`, `agents`, `commands`)
- `addContent({type, name, project})` called without the new optional `config` parameter still works (falls back to defaults)
- Existing `.fsd/` projects continue to function at v0.3.0 with no edits

---

## [0.2.0] - 2026-03-26

### Added

- **Schema validation** for skills, agents, and commands at content discovery time
  - Skills require `name` and `description` (>= 20 chars)
  - Agents require `name`, `description`, `model`, and `tools`
  - Commands require `name` and `description`; `fsd:` prefix recommended
  - Validation results attached to each content item; invalid content loads with warnings
  - `validationSummary` returned by loader with total/valid/invalid/warnings counts
- **`/fsd:validate` command** -- full schema compliance report across all layers with `--skills`, `--agents`, `--commands` filters
- **`scripts/validator.js`** -- new module exporting `validateSkill`, `validateAgent`, `validateCommand`
- **`scripts/validate.js`** -- CLI entry point for the validate command
- **Override indicator `[>]`** in `/fsd:list` output when content shadows a lower layer
- **STATUS column** in `/fsd:list` showing `ok`, `N err`, or `N warn` per item
- **COMMANDS section** in `/fsd:list` output (previously only showed skills and agents)
- **Command scanning** in loader (`scanCommands` function)
- **Validation warning line** in SessionStart hook output when issues exist
- **YAML parser: nested object support** -- one-level deep `key:\n  nested_key: value` parsing
- **YAML parser: multi-line text blocks** -- `|` syntax for multi-line string values
- **YAML parser: inline flow arrays** -- `["a", "b", "c"]` syntax
- **New tests**: `test-validator.js`, `test-loader-validation.js`

### Changed

- **Config merge strategy** -- replaced shallow merge with strategic merge:
  - Arrays now concatenate with dedup (previously: full replacement)
  - Objects now merge recursively (previously: full replacement)
  - Scalars still use last-writer-wins
  - `!replace` suffix available to force full replacement when needed
- **`/fsd:list` output** -- now includes STATUS column, LAYER column with `[>]` indicator, COMMANDS section, and validation summary in section headers
- **`/fsd:add` templates** -- agent template now includes `tools` field; command template has longer description. All generated templates pass schema validation
- **SessionStart hook** -- now shows `/fsd:validate` in commands list and displays validation warnings when present
- **`loadContent()` return shape** -- now returns `{ skills, agents, commands, validationSummary }` (previously `{ skills, agents }`)
- **Content items** now include `validation` (result object) and `overrides` (boolean) properties
- **Plugin description** updated in `plugin.json`

---

## [0.1.0] - 2026-03-02

### Added

- **Three-layer content resolution** -- core (plugin) > user (`~/.fsd/`) > project (`.fsd/`) with name-based shadowing
- **5 core skills**: brainstorm, plan, execute, verify, debug
- **2 core agents**: explorer (codebase analysis), reviewer (code review)
- **3 commands**: `/fsd:init`, `/fsd:add`, `/fsd:list`
- **SessionStart hook** -- displays active skills and agents on session start
- **YAML parser** -- minimal parser for flat key-value pairs and string arrays
- **Config cascade** -- shallow merge of `config.yaml` across three layers
- **Content loader** -- filesystem scanning with name-based shadowing and disabled filtering
- **`/fsd:init`** -- creates `.fsd/` project space with config and content directories
- **`/fsd:add`** -- scaffolds new skills, agents, or commands in user or project space
- **`/fsd:list`** -- displays resolved content across all layers
- **Test suite** -- unit tests for yaml-parser, config, loader, init, add, list
- **Zero npm dependencies** -- uses only Node.js built-ins (`fs`, `path`, `assert`)
