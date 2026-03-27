# Changelog

All notable changes to FSD are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic Versioning](https://semver.org/).

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
