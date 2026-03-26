# FSD — Full Stack Development Framework

## Design Document

**Date:** 2026-03-02
**Status:** Approved
**Format:** Claude Code Plugin

---

## Overview

FSD is a plugin-first meta-framework for Claude Code that lets users create, add, and organize skills, agents, and commands through a layered architecture. It separates core framework content from user personalizations so upgrades never overwrite custom work.

**Target audience:** Teams and organizations using Claude Code daily who want shared workflows with individual customization.

## Problem Statement

Existing metaframeworks (GSD, superpowers, SPARC) share four pain points:

1. **Rigid structure** — forced directory layouts and file naming conventions
2. **Monolithic skills** — skills baked into core, can't add/remove/override individually without forking
3. **No composability** — can't mix and match pieces from different frameworks
4. **Upgrade fragility** — updates overwrite customizations, losing personalized workflows

## Architecture: Three-Layer Resolution

```
Priority: Project (.fsd/) > User (~/.fsd/) > Core (plugin install)
```

### Layer 1: Core (read-only, plugin install)

```
~/.claude/plugins/fsd/
  plugin.json
  skills/
    brainstorm.md
    plan.md
    execute.md
    verify.md
    debug.md
  agents/
    explorer.yaml
    reviewer.yaml
  commands/
    add.ts
    import.ts
    list.ts
    upgrade.ts
    init.ts
    config.ts
  lib/
    loader.ts
    config.ts
    importer.ts
```

Ships built-in skills, agents, commands, a default workflow (plan -> execute -> verify), and the loader engine that discovers, merges, and serves content from all three layers.

### Layer 2: User Space (~/.fsd/)

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

### Layer 3: Project Space (<project>/.fsd/)

```
<project>/.fsd/
  config.yaml
  skills/
  agents/
  commands/
```

Team-shared content committed to git. Highest priority in resolution order.

### Resolution Rules

- **Name shadowing:** A user skill with the same name as a core skill overrides it. A project skill overrides both.
- **Whole-file replacement:** No file merging or diffing. If `~/.fsd/skills/brainstorm.md` exists, it completely replaces `core/skills/brainstorm.md`.

## Config Cascade

Each layer can have a `config.yaml`. Shallow merge per key, project > user > core.

```yaml
skills_dir: "./my-skills"      # Override default "skills/"
agents_dir: "./agents"         # Override default "agents/"
workflow: "my-workflow"        # Replace default methodology
disabled:                      # Disable specific core content
  - "skills/brainstorm"
```

## Content Formats

### Skills (Markdown + YAML frontmatter)

```markdown
---
name: brainstorm
description: Collaborative ideation and design exploration
trigger: "creative work, new features, product concepts"
layer: core
---

# Brainstorm

[skill content here]
```

### Agents (YAML)

```yaml
name: explorer
description: Deep codebase analysis
subagent_type: Explore
tools: [Glob, Grep, Read, WebSearch]
layer: core
```

The `layer` field is metadata only — set automatically based on file location, used by `/fsd:list` to show provenance.

## Git Import System

### Importing content

```bash
/fsd:import github:theobeack/fsd-testing-suite
```

1. Clones repo into `~/.fsd/imports/<owner>/<repo>/`
2. Reads `fsd-manifest.yaml` from repo root
3. Symlinks (or copies, configurable) content into user-space directories
4. Records import in `~/.fsd/imports.lock`

### Import manifest (in third-party repos)

```yaml
name: testing-suite
author: theobeack
version: 1.0.0
provides:
  skills:
    - skills/tdd.md
    - skills/integration-test.md
  agents:
    - agents/test-runner.yaml
  commands:
    - commands/coverage.ts
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
/fsd:import --update                    # Update all imports
/fsd:import --update testing-suite      # Update one import
/fsd:import --remove testing-suite      # Uninstall
```

### Conflict handling

If an import provides a skill with the same name as something already in user space, FSD warns and skips. User can force with `--override`. User-authored content always wins by default.

## Team & Project Space

### Initialization

```bash
/fsd:init
```

Creates `.fsd/` in the project root (committed to git).

### Project config

```yaml
# <project>/.fsd/config.yaml
workflow: "plan-review-execute"
disabled:
  - "skills/brainstorm"
required:
  - "skills/code-review"
conventions:
  commit_style: conventional
  test_before_complete: true
```

`required` skills are always loaded into context at session start for anyone working in the project.

### Visibility

```
$ /fsd:list

SKILLS (7 active)
  brainstorm          core        built-in ideation
  plan                core        planning skill
  execute             core        execution skill
  verify              core        verification skill
  debug               core        debugging skill
  tdd                 import      from: theobeack/fsd-testing-suite
  code-review         project     team-required

AGENTS (3 active)
  explorer            core        codebase analysis
  reviewer            core        code review
  test-runner         import      from: theobeack/fsd-testing-suite

Layer: core | user | import | project
```

## Upgrade System

```bash
/fsd:upgrade
```

1. Updates core plugin layer only (via Claude Code plugin update mechanism)
2. Runs compatibility check: scans user/project space for name collisions with new core content
3. Reports changelog:

```
FSD upgraded: v1.2.0 -> v1.3.0

NEW in core:
  + skills/refactor.md
  + agents/perf-analyzer.yaml

CHANGED in core:
  ~ skills/plan.md

SHADOWED (your overrides still active):
  ! skills/debug.md    Your user version overrides updated core version

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

## Default Workflow

Minimal 3-step workflow (replaceable):

```
plan -> execute -> verify
```

Each step maps to a skill. Customizable:

```yaml
workflow:
  steps: [research, plan, review, execute, test, verify]
```

Or disabled:

```yaml
workflow: none
```

## Authoring & Publishing

### Creating content

```bash
/fsd:add skill my-review              # Creates ~/.fsd/skills/my-review.md
/fsd:add agent linter                 # Creates ~/.fsd/agents/linter.yaml
/fsd:add command deploy               # Creates ~/.fsd/commands/deploy.ts
/fsd:add skill my-review --project    # Creates in .fsd/ instead of ~/.fsd/
```

### Publishing for others

```bash
/fsd:export my-skills-pack
```

Generates `fsd-manifest.yaml`, creates a git-ready directory. Push to repo, others `/fsd:import` it.

## Commands Summary

| Command | Description |
|---------|-------------|
| `/fsd:init` | Create `.fsd/` in project root |
| `/fsd:add <type> <name>` | Create new skill/agent/command in user space |
| `/fsd:add <type> <name> --project` | Create in project space |
| `/fsd:import <source>` | Git-import third-party content |
| `/fsd:import --update` | Update all imports |
| `/fsd:import --remove <name>` | Uninstall import |
| `/fsd:list` | Show all active content across layers |
| `/fsd:config` | View/edit config at any layer |
| `/fsd:upgrade` | Update core plugin |
| `/fsd:diff <name>` | Compare override with core version |
| `/fsd:export <name>` | Package content for sharing |
