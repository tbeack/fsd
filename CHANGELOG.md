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
