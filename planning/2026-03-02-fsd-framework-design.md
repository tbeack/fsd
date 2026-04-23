# FSD — Full Stack Development Framework

## Design Document

**Date:** 2026-03-02
**Revised:** 2026-03-26
**Status:** Approved (v0.2 revision — incorporates GSD/OpenSpec research findings)
**Format:** Claude Code Plugin

---

## Overview

FSD is a plugin-native meta-framework for Claude Code that lets users and teams create, share, and organize skills, agents, and commands through a layered architecture. It separates core framework content from user and organizational customizations so upgrades never overwrite custom work.

**Target audience:** Teams and organizations using Claude Code daily who want shared workflows with individual customization.

**Strategic position:** A lightweight, content-first management layer that teams build on top of — whether they adopt structured workflows, spec-driven development, or their own methodology. The multi-layer resolution system is the core differentiator.

## Problem Statement

Existing metaframeworks share common pain points:

1. **Rigid structure** — forced directory layouts and file naming conventions
2. **Monolithic content** — skills baked into core, can't add/remove/override individually without forking
3. **No composability** — can't mix and match pieces from different frameworks
4. **Upgrade fragility** — updates overwrite customizations, losing personalized workflows
5. **No team primitives** — no organization-scoped content, no shared registries, no role-based configuration
6. **No extension contracts** — no validation of what a skill/agent/command must provide, leading to inconsistent quality

## Design Principles

These principles guide all architectural decisions:

1. **Content-first, not workflow-first** — the core value is layered content resolution; workflows are one way to compose content, not the only way
2. **Stateless by default, stateful by opt-in** — content resolution always scans the filesystem; state files only appear when workflows are active
3. **Extension contracts over convention** — auto-discover by directory structure, but validate against formal schemas
4. **Zero npm dependencies** — no supply chain risk, fast startup, easy to audit
5. **Plugin-native** — work within Claude Code's plugin system, not around it
6. **Upgrade-safe always** — core content is read-only; user/project/org content shadows by name

## Architecture: Multi-Layer Resolution

```
Priority: Project (.fsd/) > User (~/.fsd/) > Org (~/.fsd/org/{name}/) > Core (plugin install)
```

### Layer 1: Core (read-only, plugin install)

```
~/.claude/plugins/fsd/
  .claude-plugin/
    plugin.json
  skills/
    brainstorm/SKILL.md
    plan/SKILL.md
    execute/SKILL.md
    verify/SKILL.md
    debug/SKILL.md
  agents/
    explorer.md
    reviewer.md
  commands/
    init.md
    add.md
    list.md
    validate.md
    import.md
    diff.md
    workflow.md
    config.md
  hooks/
    hooks.json
    scripts/
      session-start.sh
  scripts/
    yaml-parser.js
    config.js
    loader.js
    validator.js
    importer.js
    init.js
    add.js
    list.js
    session-start-loader.js
  tests/
```

Ships built-in skills, agents, commands, a default workflow, and the loader engine that discovers, validates, merges, and serves content from all layers.

### Layer 2: Organization Space (~/.fsd/org/{name}/)

```
~/.fsd/org/{org-name}/
  config.yaml
  skills/
  agents/
  commands/
  teams/
    {team-name}/
      config.yaml
      skills/
      agents/
      commands/
```

Organization-wide conventions and approved content. Can be a cloned git repo for centralized management. Teams within an org get their own namespace with additional overrides.

Active org/team is set in user config or via environment variables:
```yaml
# ~/.fsd/config.yaml
org: my-company
team: platform
```

Or: `FSD_ORG=my-company FSD_TEAM=platform`

### Layer 3: User Space (~/.fsd/)

```
~/.fsd/
  config.yaml
  skills/
  agents/
  commands/
  imports/
  imports.lock
```

Personal customizations. Never touched by upgrades. Contains user-authored content and git-imported third-party content.

### Layer 4: Project Space (<project>/.fsd/)

```
<project>/.fsd/
  config.yaml
  skills/
  agents/
  commands/
  .state.yaml          # Only when a workflow is active
```

Team-shared content committed to git. Highest priority in resolution order.

> **Note (FSD-003, 2026-04-22):** The `skills/`, `agents/`, and `commands/` directory names are configurable via `config.yaml`'s `structure:` section. The trees above show defaults. Use `/fsd-restructure` to rename them safely after init.

### Resolution Rules

- **Name shadowing:** Content with the same name at a higher-priority layer fully replaces the lower-priority version. No merging.
- **Full resolution order:** Core → Org → Team → User → Project (last wins)
- **Org/team layers are optional.** If no org is configured, resolution is Core → User → Project (current v0.1 behavior, fully backward compatible).

## Content Schemas

Each content type has a formal schema. Frontmatter is validated at discovery time. Invalid content loads with warnings (never breaks the session), but gets flagged in `/fsd:list` and `/fsd:validate`.

### Skills (Markdown + YAML frontmatter)

```markdown
---
name: brainstorm                              # required, string
description: Collaborative ideation           # required, string, min 20 chars
trigger: "creative work, new features"        # optional, string (trigger phrases)
context_strategy: fresh                       # optional, enum: fresh | shared | minimal
max_context_pct: 30                           # optional, number (suggested context budget %)
delegates_to:                                 # optional, array (agents this skill spawns)
  - explorer
---

# Brainstorm

[skill content here]
```

The `layer` field is set automatically at resolution time based on file location — never specified in the file.

**Context strategy metadata:** Advisory hints for orchestration prompts. `fresh` means the skill should instruct Claude to spawn fresh-context agents. `shared` means inline execution is fine. `minimal` means the skill should minimize context usage.

### Agents (Markdown + YAML frontmatter)

```markdown
---
name: explorer                                # required, string
description: Deep codebase analysis           # required, string
model: sonnet                                 # required, enum: sonnet | opus | haiku | ${profile.*}
tools:                                        # required, array of strings
  - Glob
  - Grep
  - Read
  - WebSearch
color: cyan                                   # optional, string
---

[agent system prompt here]
```

**Model profile references:** Agents can use `${profile.exploration}` instead of a hardcoded model name. At runtime, this resolves from the active model profile in config.

### Commands (Markdown + YAML frontmatter)

```markdown
---
name: fsd:validate                            # required, string (fsd: prefix)
description: Check all content for schema compliance   # required, string
argument-hint: "[--all|--skills|--agents]"    # optional, string
---

[command implementation instructions]
```

### Validation Rules

| Field | Skills | Agents | Commands |
|-------|--------|--------|----------|
| `name` | Required, string | Required, string | Required, string with `fsd:` prefix |
| `description` | Required, >= 20 chars | Required | Required |
| `model` | N/A | Required, valid enum or profile ref | N/A |
| `tools` | N/A | Required, non-empty array | N/A |

Validation happens in `loader.js` at content discovery time. Results are surfaced via:
- SessionStart hook output (warning count)
- `/fsd:list` (validation status per item)
- `/fsd:validate` (full report across all layers)

## Config Cascade

Each layer can have a `config.yaml`. **Strategic merge** across layers (project > user > team > org > core):

- **Scalar values:** Last writer wins
- **Arrays:** Concatenate with dedup (not replace)
- **Objects:** Recursive merge (not shallow)
- **Explicit replace:** Use `!replace` suffix to force full replacement

```yaml
# Core config.yaml
workflow: plan-execute-verify
disabled:
  - "skills/brainstorm"

# Org config.yaml
disabled:
  - "skills/debug"          # Concatenated: [brainstorm, debug]

# Project config.yaml
disabled!replace:            # Explicit full replacement
  - "skills/brainstorm"     # Result: [brainstorm] only
```

### Supported Config Keys

```yaml
# Content resolution
disabled:                     # Array: content IDs to exclude
  - "skills/brainstorm"
required:                     # Array: content always loaded at session start
  - "skills/code-review"

# Workflow
workflow: plan-execute-verify # String: active workflow name, or "none"
workflows:                    # Object: named workflow definitions
  default:
    steps: [brainstorm, plan, execute, verify]
    optional: [brainstorm]
  quick:
    steps: [plan, execute]
  review:
    steps: [verify, debug]

# Model profiles
model_profiles:
  quality:
    planning: opus
    execution: opus
    review: sonnet
    exploration: sonnet
  balanced:
    planning: opus
    execution: sonnet
    review: sonnet
    exploration: haiku
  budget:
    planning: sonnet
    execution: sonnet
    review: haiku
    exploration: haiku
active_profile: balanced

# Team (user config only)
org: my-company               # String: active organization name
team: platform                # String: active team within org

# Conventions (informational, used by skills)
conventions:
  commit_style: conventional
  test_before_complete: true
```

## Git Import System

### Importing content

```bash
/fsd:import github:theobeack/fsd-testing-suite
/fsd:import github:team/fsd-agents#security-scanner@v2.1
```

1. Clones repo into `~/.fsd/imports/<owner>/<repo>/`
2. Reads `fsd-manifest.yaml` from repo root
3. Copies content into user-space directories (respects three-layer model)
4. Records import in `~/.fsd/imports.lock`
5. Validates imported content against schemas, warns on failures

### Import manifest (in third-party repos)

```yaml
name: testing-suite
author: theobeack
version: 1.0.0
provides:
  skills:
    - skills/tdd/SKILL.md
    - skills/integration-test/SKILL.md
  agents:
    - agents/test-runner.md
  commands:
    - commands/coverage.md
```

### Import lock file

```yaml
# ~/.fsd/imports.lock
imports:
  - name: testing-suite
    source: github:theobeack/fsd-testing-suite
    version: 1.0.0
    commit: abc123f
    installed: 2026-03-02
    provides:
      skills: [tdd, integration-test]
      agents: [test-runner]
      commands: [coverage]
```

### Import commands

```bash
/fsd:import <source>                    # Install from git
/fsd:import --update                    # Update all imports
/fsd:import --update testing-suite      # Update one import
/fsd:import --remove testing-suite      # Uninstall
```

### Conflict handling

If an import provides content with the same name as something already in user space, FSD warns and skips. User can force with `--override`. User-authored content always wins by default.

## Workflow Engine

Workflows chain skills into composable sequences. They are **advisory, not blocking** — users can skip steps.

### Workflow definitions

Defined in `config.yaml` at any layer:

```yaml
workflows:
  default:
    steps: [brainstorm, plan, execute, verify]
    optional: [brainstorm]          # Can be skipped without warning
  quick:
    steps: [plan, execute]
  review:
    steps: [verify, debug]
```

### Workflow commands

| Command | Description |
|---------|-------------|
| `/fsd:workflow [name]` | Start a named workflow (default: "default") |
| `/fsd:next` | Advance to the next step in active workflow |

### Workflow state

When a workflow is active, minimal state is tracked in `.fsd/.state.yaml`:

```yaml
workflow: default
current_step: 2
started: 2026-03-26T10:00:00Z
```

No state file = no workflow in progress. State is deleted when the workflow completes or is abandoned.

### Future: Parallel execution

Phase 5 (v0.5+) adds wave-based parallel execution for workflows with independent steps. Not in initial implementation.

## Model Profiles

Profiles map agent roles to model tiers for cost management:

```yaml
active_profile: balanced

model_profiles:
  balanced:
    planning: opus
    execution: sonnet
    review: sonnet
    exploration: haiku
```

Agents reference profiles in frontmatter:

```yaml
model: ${profile.exploration}    # Resolves to "haiku" under balanced profile
```

Fallback: If no profile is active or the reference is invalid, the agent's literal `model` value is used.

## Upgrade System

```bash
/fsd:upgrade
```

1. Updates core plugin layer only (via Claude Code plugin update mechanism)
2. Runs compatibility check: scans user/project space for name collisions with new core content
3. Validates all content against updated schemas
4. Reports changelog:

```
FSD upgraded: v1.2.0 -> v1.3.0

NEW in core:
  + skills/refactor
  + agents/perf-analyzer

CHANGED in core:
  ~ skills/plan

SHADOWED (your overrides still active):
  ! skills/debug    Your user version overrides updated core version

VALIDATION:
  2 warnings in user content (run /fsd:validate for details)

No action needed. Run /fsd:diff debug to compare.
```

### Diff command

```bash
/fsd:diff debug          # Compare your override with new core version
/fsd:diff --all          # Show all divergences across layers
```

### Guarantees

- Core upgrade never modifies files in `~/.fsd/` or `.fsd/`
- No silent overwriting of user content
- Import lockfile is in user space, unaffected by upgrades
- Schema changes follow semver: breaking changes increment major version

## Commands Summary

### Implemented (v0.1)

| Command | Description |
|---------|-------------|
| `/fsd:init` | Create `.fsd/` in project root |
| `/fsd:add <type> <name>` | Create new skill/agent/command in user space |
| `/fsd:add <type> <name> --project` | Create in project space |
| `/fsd:list` | Show all active content across layers |

### Phase 1: Foundation (v0.2)

| Command | Description |
|---------|-------------|
| `/fsd:validate` | Check all content for schema compliance |

### Phase 2: Sharing (v0.3)

| Command | Description |
|---------|-------------|
| `/fsd:import <source>` | Git-import third-party content |
| `/fsd:import --update` | Update all imports |
| `/fsd:import --remove <name>` | Uninstall import |
| `/fsd:upgrade` | Update core plugin |
| `/fsd:diff <name>` | Compare override with core version |
| `/fsd:export <name>` | Package content for sharing |

### Phase 3: Workflows (v0.4)

| Command | Description |
|---------|-------------|
| `/fsd:workflow [name]` | Start a named workflow |
| `/fsd:next` | Advance to next workflow step |

### Phase 4: Team Scaling (v0.5)

| Command | Description |
|---------|-------------|
| `/fsd:config` | View/edit config at any layer |

## Evolution Roadmap

### Phase 1: Foundation Hardening (v0.1 → v0.2)

**Goal:** Make the core robust enough for teams to build on.

1. Frontmatter schema validation in `loader.js`
2. Strategic merge for config (array concatenation, recursive object merge)
3. `/fsd:validate` command
4. Enhanced `/fsd:list` with layer source, validation status, override indicators

### Phase 2: Sharing & Import (v0.2 → v0.3)

**Goal:** Enable teams to share and reuse content across projects.

1. Git-based import system (`/fsd:import`)
2. `imports.lock` for version pinning
3. `/fsd:upgrade`, `/fsd:diff`, `/fsd:export` commands

### Phase 3: Workflow Engine (v0.3 → v0.4)

**Goal:** Chain skills into composable workflows.

1. Workflow definitions in config
2. `/fsd:workflow` and `/fsd:next` commands
3. Minimal state tracking (`.fsd/.state.yaml`)
4. Context strategy metadata in skill frontmatter

### Phase 4: Team Scaling (v0.4 → v0.5)

**Goal:** Support organization and team-level configuration.

1. Org/team config tiers with content resolution
2. Model profiles for cost management
3. `/fsd:config` interactive editor
4. Governance schema (approved sources, model policies)

### Phase 5: Advanced Orchestration (v0.5 → v1.0)

**Goal:** Sophisticated workflow execution.

1. Wave-based parallel task scheduling
2. Session continuity (pause/resume workflows)
3. Context budget management for agent allocation
4. Audit logging for skill/agent invocations

## Architectural Decisions

### Decision 1: Stay as a Claude Code Plugin

Plugin auto-discovery means zero config for basic usage. Leverages native command, skill, and agent systems. Can extract a standalone CLI later if needed for multi-runtime support.

### Decision 2: Keep Zero Dependencies

Faster startup (matters for SessionStart hook), no supply chain risk, simpler distribution. Custom YAML parser and plain JS validators are sufficient.

### Decision 3: Stateless by Default

Content resolution and config always scan the filesystem. State files only appear when a workflow is active. No state file = clean default.

### Decision 4: Content-First Architecture

The core value is multi-layer content resolution. Teams can use FSD purely for content management without workflows. This keeps FSD a true meta-framework rather than an opinionated methodology.

### Decision 5: Contracts on Top of Conventions

Keep convention-based auto-discovery. Add schema validation as a quality layer. Invalid content loads with warnings (never breaks). This enables a future registry with quality guarantees.

### Decision 6: Backward Compatibility

Org/team layers are additive. Existing three-layer setups (core/user/project) continue to work unchanged. Config merge changes (deep instead of shallow) are non-breaking for the common case of scalar overrides.
