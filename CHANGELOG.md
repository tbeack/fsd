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
