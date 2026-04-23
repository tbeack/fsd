# FSD — Full Stack Development Framework

**Version 0.7.0** — released 2026-04-23 · [Changelog](./CHANGELOG.md)

A multi-layer meta-framework plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with schema-validated skills, agents, and commands. Content is resolved across multiple layers so you can customize or override anything without touching the plugin itself.

## What It Does

FSD gives Claude Code a structured development workflow through five core skills (brainstorm, plan, execute, verify, debug) and two agents (explorer, reviewer). All content is validated against formal schemas at discovery time, so issues are caught early.

**Multi-layer resolution (highest priority wins):**

| Layer | Location | Purpose |
|-------|----------|---------|
| **Project** | `.fsd/` in your repo | Team-shared overrides, committed to git |
| **User** | `~/.fsd/` | Personal customizations across all projects |
| **Org/Team** | `~/.fsd/org/{name}/` | Organization-wide conventions (planned) |
| **Core** | Plugin directory | Built-in defaults, updated with the plugin |

If you create a skill named `brainstorm` in `~/.fsd/skills/`, it shadows the core version. A project-level version in `.fsd/skills/` shadows both.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and working
- Node.js 18+
- Git

No npm dependencies -- FSD uses only Node.js built-ins (`fs`, `path`, `assert`).

## Installation

### Quick install

```bash
git clone https://github.com/tbeack/fsd.git ~/.claude/plugins/fsd
bash ~/.claude/plugins/fsd/install.sh
```

The script checks prerequisites, clones (or updates) the plugin, runs tests, validates content, and checks Claude Code registration.

### Manual install

#### 1. Clone the plugin

```bash
git clone https://github.com/tbeack/fsd.git ~/.claude/plugins/fsd
```

#### 2. Register with Claude Code

If Claude Code doesn't auto-discover plugins in `~/.claude/plugins/`, add the plugin path to your Claude Code settings:

```bash
# Open Claude Code settings
claude config

# Or manually add to ~/.claude/settings.json
```

Add FSD to the `plugins` array:

```json
{
  "plugins": [
    "~/.claude/plugins/fsd"
  ]
}
```

#### 3. Verify installation

Restart Claude Code (or start a new session). You should see:

```
FSD Framework Active
====================

SKILLS (5 active)
  brainstorm            core      Ideation and design exploration
  plan                  core      Task breakdown and ordering
  execute               core      TDD implementation
  verify                core      Quality verification
  debug                 core      Systematic debugging

AGENTS (2 active)
  explorer              core      Codebase analysis
  reviewer              core      Code review

Commands: /fsd:list, /fsd:add, /fsd:init, /fsd:validate
```

Run `/fsd:validate` to confirm all content passes schema validation.

#### 4. (Optional) Initialize a project

In any project directory, run:

```
/fsd:init
```

This creates a `.fsd/` directory for project-specific skills, agents, commands, and configuration. Commit it to git so your team shares the same setup.

## Updating

### Pull latest changes

Run the install script again (it detects existing installs and updates):

```bash
bash ~/.claude/plugins/fsd/install.sh
```

Or update manually:

```bash
cd ~/.claude/plugins/fsd
git pull origin main
```

Restart Claude Code. Core content updates automatically -- your customizations in `~/.fsd/` and `.fsd/` are never touched.

### Check for issues after update

```
/fsd:validate
```

If your overrides conflict with updated schemas, validation will flag them. Use `/fsd:list` to see which items override core (`[>]` indicator) and compare with `/fsd:diff` (planned for v0.3).

### Pin to a specific version

If you need stability, pin to a tagged release:

```bash
cd ~/.claude/plugins/fsd
git checkout v0.2.0
```

### Upgrade guarantees

- Core updates never modify files in `~/.fsd/` or `.fsd/`
- Your overrides always take priority over core content
- Import lock files (planned for v0.3) are in user space, unaffected by upgrades

## Uninstalling

```bash
rm -rf ~/.claude/plugins/fsd
```

Remove the plugin entry from `~/.claude/settings.json` if you added one. Your user customizations in `~/.fsd/` and project spaces in `.fsd/` are preserved -- delete them manually if you want a clean removal.

## Commands

### `/fsd:init`

Initialize a project-level FSD space in the current directory:

```
/fsd:init
```

Creates `.fsd/` with:
- `config.yaml` -- project configuration
- `skills/` -- project-specific skills
- `agents/` -- project-specific agents
- `commands/` -- project-specific commands

After `/fsd:init`, run **`/fsd-new-project`** (see below) to capture project identity and the first roadmap entry — every downstream skill reads from those files.

### `/fsd-new-project`

Interactive one-time kickoff. Walks through the project's identity, scope, tech context, success metrics, anti-goals, first milestone, and first phase — then writes `planning/PROJECT.md` and `planning/ROADMAP.md`. Refuses to overwrite either file if already present. See **Project Context** below for the frontmatter schema and examples.

### `/fsd-roadmap`

Mid-project maintenance for `planning/ROADMAP.md`. Dispatches five surgical operations that edit the file in place while preserving user-authored goal prose and re-validating the schema on every write:

| Op | Purpose |
|---|---|
| `add-milestone` | Append a new `## Milestone <id>` block. Optionally set as current. |
| `add-phase` | Insert a new `### Phase <id>` block into a named milestone. |
| `advance` | Mark current milestone shipped; flip `current_milestone` + `version` to the next milestone (auto-adopts its `**Version:**` into frontmatter). |
| `complete-phase` | Mark a named phase shipped via a `**Status:** shipped (YYYY-MM-DD)` body line. |
| `bump-version` | Frontmatter `version:` bump (patch-style; does not touch milestones). |

`advance` and `complete-phase` are idempotent — re-running on an already-shipped section no-ops instead of double-inserting. All ops abort without touching the file if the result would fail `validateRoadmap`. Refuses to run if `planning/ROADMAP.md` is missing (use `/fsd-new-project` to create it first).

### `/fsd:list`

Show all active content resolved across layers with validation status:

```
/fsd:list
```

Output includes:
- **STATUS** column (`ok`, `N err`, `N warn`) for schema compliance
- **[>]** indicator when content overrides a lower layer
- **COMMANDS** section listing all available commands

### `/fsd:add`

Scaffold a new skill, agent, or command:

```
/fsd:add skill my-review
/fsd:add agent my-linter
/fsd:add command deploy
```

Add `--project` to create in `.fsd/` (project space) instead of `~/.fsd/` (user space):

```
/fsd:add skill team-lint --project
```

Generated templates include all required fields and pass schema validation out of the box.

### `/fsd:validate`

Run schema validation across all layers:

```
/fsd:validate
/fsd:validate --skills
/fsd:validate --agents
/fsd:validate --commands
```

Storage-kind artifacts (`.fsd/spec/`, `.fsd/plan/`, `.fsd/research/`) are validated on demand only — they are not loaded at session start. Pass an artifact filter to scan them:

```
/fsd:validate --artifacts            # all three storage kinds
/fsd:validate --specs                # specs only
/fsd:validate --plans                # plans only
/fsd:validate --research             # research only
```

Reports errors and warnings per item. Exit code 1 if any errors found.

## Configuration

Edit `config.yaml` at any layer to customize behavior. Config merges strategically across layers:

- **Scalars:** last writer wins
- **Arrays:** concatenate with dedup (not replace)
- **Objects:** recursive merge
- **`!replace` suffix:** force full replacement

```yaml
# Workflow steps
workflow: plan-execute-verify

# Disable specific core content (concatenates across layers)
disabled:
  - "skills/brainstorm"
  - "agents/explorer"

# Require specific skills (always loaded)
required:
  - "skills/code-review"

# Content-kind → directory mapping (partial override; unset keys default)
# Use /fsd-restructure to rename any of these safely after install —
# it physically renames the directory, updates this config, and flags
# stale references in content bodies.
structure:
  # Scannable kinds (loaded and activated by the framework):
  # skills: capabilities     # renames .fsd/skills/ → .fsd/capabilities/
  # agents: bots
  # commands: actions
  # Storage kinds (artifacts written by /fsd-spec, /fsd-plan, /fsd-research):
  # spec: specifications
  # plan: plans
  # research: notes

# Team conventions (merges recursively across layers)
conventions:
  commit_style: conventional
  test_before_complete: true

# Model profiles for cost management (planned)
model_profiles:
  balanced:
    planning: opus
    execution: sonnet
    review: haiku

# Force full replacement instead of merge
disabled!replace:
  - "skills/brainstorm"
```

## Content Schemas

All content is validated against formal schemas at discovery time. Invalid content still loads (with warnings) but gets flagged.

### Skills

Required fields: `name` (string), `description` (string, >= 20 chars)

Optional: `context_strategy` (fresh|shared|minimal), `max_context_pct` (1-100), `delegates_to` (array)

### Agents

Required fields: `name` (string), `description` (string), `model` (sonnet|opus|haiku or `${profile.*}`), `tools` (non-empty array)

Optional: `color` (string)

### Commands

Required fields: `name` (string, `fsd:` prefix recommended), `description` (string)

Optional: `argument-hint` (string)

### Project Context

Separate from the `.fsd/` content kinds, FSD persists a pair of files under `planning/` that capture the project's framing. They are written once (by `/fsd-new-project`) and maintained over time (by `/fsd-roadmap` for the roadmap), and read by downstream skills so every session starts with shared context:

- `planning/PROJECT.md` — identity, scope, tech context, success metrics, anti-goals
- `planning/ROADMAP.md` — versioned milestones → numbered phases

**Create once, edit many.** `/fsd-new-project` writes both files and refuses to overwrite. `/fsd-roadmap` is the ongoing-edits surface for the roadmap: add milestones, add phases, advance when a milestone ships, mark a phase complete, or bump the version without disturbing user-authored goal paragraphs. Every edit re-validates against the schema; failed edits leave the file on disk unchanged.

When both files are present and their frontmatter validates, the session-start hook prints a one-line header: `Project: <name> — Milestone: <current> (v<version>)`. If either file is absent or invalid, the header is hidden (no noisy errors at session start — use `/fsd:validate` for that).

**PROJECT.md schema**

Required: `project` (non-empty string), `id` (kebab-case), `title` (non-empty), `status` (`draft|active|archived`), `created` (ISO date).

Optional: `updated`, `tags` (kebab-case array), `vision` (string), `target_users` (array of strings).

```yaml
---
project: My Project
id: my-project
title: My Project
status: active
created: 2026-04-23
vision: One-line summary of what this project does
target_users:
  - solo developers
  - small teams
---

# My Project

## Identity
...

## Scope
...
```

**ROADMAP.md schema**

Required: all the PROJECT.md common fields, plus `version` (semver-like — `1.0` or `1.0.0`) and `current_milestone` (string id matching a `## Milestone <id>` heading in the body).

```yaml
---
project: My Project
id: my-project-roadmap
title: My Project Roadmap
status: active
created: 2026-04-23
version: 0.1
current_milestone: v1
---

# My Project Roadmap

## Milestone v1

**Version:** 0.1
**Name:** Initial release
**Goal:** Ship the minimum useful thing.

### Phase v1.1 — Bootstrap

One-paragraph goal for the phase.
```

The validator enforces frontmatter format only; it does **not** check that `current_milestone` references an existing heading in the body, or that phase ids point at real specs/plans (mirroring the artifact-schema stance — cross-ref resolution will land with `/fsd-roadmap` in FSD-007).

### Artifact Schemas

Storage-kind artifacts (`spec`, `plan`, `research`) are markdown files with YAML frontmatter. The framework does not load them at session start — they are passive data, scanned on demand by `/fsd:validate --artifacts` and consumed by the corresponding authoring skills (`/fsd-spec`, `/fsd-plan`, `/fsd-research`).

**Common required fields** (all three kinds):

- `project` — non-empty string (free-form, preserves human casing)
- `id` — kebab-case, must match the filename stem (e.g. `id: auth-v2` lives in `auth-v2.md`)
- `title` — non-empty string
- `status` — one of `draft`, `active`, `archived`
- `created` — ISO 8601 date (`YYYY-MM-DD`)

**Common optional fields:** `updated` (ISO date), `tags` (kebab-case array), `related` (cross-refs in the form `<spec|plan|research>/<kebab-id>`).

**Spec example** (`.fsd/spec/auth-v2.md`):

```yaml
---
project: My Project
id: auth-v2
title: Auth v2 Specification
status: draft
created: 2026-04-22
approved: false
supersedes:
  - auth-v1
related:
  - plan/auth-v2-migration
---
```

Spec-only optional fields: `approved` (boolean), `supersedes` (array of spec ids).

**Plan example** (`.fsd/plan/auth-v2-migration.md`):

```yaml
---
project: My Project
id: auth-v2-migration
title: Auth v2 Migration Plan
status: active
created: 2026-04-22
task: FSD-042
estimate: ~3 days
depends_on:
  - infra-bootstrap
related:
  - spec/auth-v2
---
```

Plan-only optional fields: `task` (string, often an FSD-NNN reference), `depends_on` (array of plan ids), `estimate` (string).

**Research example** (`.fsd/research/threat-model.md`):

```yaml
---
project: My Project
id: threat-model
title: Threat Model Research
status: draft
created: 2026-04-22
sources:
  - https://owasp.org/www-project-top-ten/
  - https://example.com/internal-postmortem
conclusion: Token rotation must precede session-cookie hardening.
---
```

Research-only optional fields: `sources` (array of http(s) URLs), `conclusion` (short string).

Run `/fsd:validate --artifacts` to check schema compliance across all artifact dirs in the current `.fsd/`.

## Core Skills

| Skill | Purpose |
|-------|---------|
| **brainstorm** | Explore ideas and requirements before implementation |
| **plan** | Break a design into ordered, testable tasks |
| **execute** | Implement tasks with TDD and atomic commits |
| **verify** | Confirm work meets requirements and passes tests |
| **debug** | Systematic diagnosis with evidence-based reasoning |

## Core Agents

| Agent | Purpose |
|-------|---------|
| **explorer** | Deep codebase analysis -- architecture, patterns, dependencies |
| **reviewer** | Code review for bugs, quality, and conventions |

## Project Structure

```
fsd/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── skills/                       # Core skills
│   ├── brainstorm/SKILL.md
│   ├── plan/SKILL.md
│   ├── execute/SKILL.md
│   ├── verify/SKILL.md
│   └── debug/SKILL.md
├── agents/                       # Core agents
│   ├── explorer.md
│   └── reviewer.md
├── commands/                     # Slash commands
│   ├── init.md
│   ├── list.md
│   ├── add.md
│   └── validate.md
├── hooks/                        # Session hooks
│   ├── hooks.json
│   └── scripts/
│       └── session-start.sh
├── scripts/                      # Node.js logic
│   ├── yaml-parser.js            # YAML parser (nested objects, text blocks, flow arrays)
│   ├── config.js                 # Config cascade with strategic merge
│   ├── loader.js                 # Content discovery, shadowing, validation
│   ├── validator.js              # Schema validation for skills/agents/commands
│   ├── validate.js               # /fsd:validate CLI entry point
│   ├── init.js
│   ├── list.js
│   ├── add.js
│   └── session-start-loader.js
└── tests/
    ├── run-tests.sh
    ├── test-yaml-parser.js
    ├── test-config.js
    ├── test-loader.js
    ├── test-loader-validation.js
    ├── test-validator.js
    ├── test-init.js
    ├── test-list.js
    └── test-add.js
```

## Running Tests

```bash
bash tests/run-tests.sh
```

## Roadmap

See `planning/2026-03-02-fsd-framework-design.md` for the full design and evolution roadmap.

- **v0.2** (current) -- Schema validation, strategic config merge, /fsd:validate
- **v0.3** -- Git-based import/export system for sharing content
- **v0.4** -- Workflow engine (chaining skills into composable sequences)
- **v0.5** -- Organization/team config tiers, model profiles
- **v1.0** -- Parallel execution, session continuity, multi-runtime adapters

## License

MIT
