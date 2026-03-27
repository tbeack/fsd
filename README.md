# FSD — Full Stack Development Framework

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

## Installation

Clone the repo into your Claude Code plugins directory:

```bash
git clone https://github.com/tbeack/fsd.git ~/.claude/plugins/fsd
```

Restart Claude Code. On session start you'll see:

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

## Requirements

- Claude Code CLI
- Node.js 18+
- No npm dependencies (uses only built-in `fs`, `path`, `assert`)

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

See `docs/plans/2026-03-02-fsd-framework-design.md` for the full design and evolution roadmap.

- **v0.2** (current) -- Schema validation, strategic config merge, /fsd:validate
- **v0.3** -- Git-based import/export system for sharing content
- **v0.4** -- Workflow engine (chaining skills into composable sequences)
- **v0.5** -- Organization/team config tiers, model profiles
- **v1.0** -- Parallel execution, session continuity, multi-runtime adapters

## License

MIT
