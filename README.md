# FSD — Full Stack Development Framework

A three-layer meta-framework plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that organizes skills, agents, and commands with upgrade-safe customization.

## What It Does

FSD gives Claude Code a structured development workflow through five core skills (brainstorm, plan, execute, verify, debug) and two agents (explorer, reviewer). Content is resolved across three layers — core, user, and project — so you can customize or override anything without touching the plugin itself.

**Three-layer resolution (highest priority wins):**

| Layer | Location | Purpose |
|-------|----------|---------|
| **Project** | `.fsd/` in your repo | Team-shared overrides, committed to git |
| **User** | `~/.fsd/` | Personal customizations across all projects |
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
  brainstorm             core      Ideation and design exploration
  plan                   core      Task breakdown and ordering
  execute                core      TDD implementation
  verify                 core      Quality verification
  debug                  core      Systematic debugging

AGENTS (2 active)
  explorer               core      Codebase analysis
  reviewer               core      Code review

Commands: /fsd:list, /fsd:add, /fsd:init
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
- `config.yaml` — project configuration
- `skills/` — project-specific skills
- `agents/` — project-specific agents
- `commands/` — project-specific commands

### `/fsd:list`

Show all active content resolved across layers:

```
/fsd:list
```

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

## Configuration

Edit `config.yaml` at any layer to customize behavior.

```yaml
# Workflow steps
workflow: plan-execute-verify

# Disable specific core content
disabled:
  - "skills/brainstorm"
  - "agents/explorer"

# Require specific skills (always loaded)
required:
  - "skills/code-review"
```

Config merges by shallow override — each key from a higher layer replaces the lower layer's value entirely.

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
| **explorer** | Deep codebase analysis — architecture, patterns, dependencies |
| **reviewer** | Code review for bugs, quality, and conventions |

## Project Structure

```
fsd/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── skills/                   # Core skills
│   ├── brainstorm/SKILL.md
│   ├── plan/SKILL.md
│   ├── execute/SKILL.md
│   ├── verify/SKILL.md
│   └── debug/SKILL.md
├── agents/                   # Core agents
│   ├── explorer.md
│   └── reviewer.md
├── commands/                 # Slash commands
│   ├── init.md
│   ├── list.md
│   └── add.md
├── hooks/                    # Session hooks
│   ├── hooks.json
│   └── scripts/
│       └── session-start.sh
├── scripts/                  # Node.js logic
│   ├── yaml-parser.js
│   ├── config.js
│   ├── loader.js
│   ├── init.js
│   ├── list.js
│   ├── add.js
│   └── session-start-loader.js
└── tests/
    ├── run-tests.sh
    ├── test-yaml-parser.js
    ├── test-config.js
    ├── test-loader.js
    ├── test-init.js
    ├── test-list.js
    └── test-add.js
```

## Running Tests

```bash
bash tests/run-tests.sh
```

## License

MIT
