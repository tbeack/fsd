# CLAUDE.md

## Project Overview

FSD — Full Stack Development Framework. A multi-layer meta-framework plugin for Claude Code with schema-validated skills, agents, and commands. Published as a Claude Code plugin at `~/.claude/plugins/fsd`.

Current version: `plugin/.claude-plugin/plugin.json` and the `**Version X.Y.Z**` line in `README.md` are the sources of truth.

## Tech Stack

- **Node.js 18+** — All backing modules; no npm dependencies (only `fs`, `path`, `assert` built-ins)
- **Bash** — `install.sh`, `plugin/tests/run-tests.sh`
- **Markdown + YAML frontmatter** — Skills (`SKILL.md`), agents, `.fsd/` artifacts
- **No build step** — plugin loads directly at runtime via Claude Code's plugin system

## Project Structure

```
/fsd
├── plugin/                     # Plugin source (installed to ~/.claude/plugins/fsd)
│   ├── .claude-plugin/
│   │   └── plugin.json         # Name, version, author
│   ├── scripts/                # Backing modules (Node.js, pure exports)
│   ├── skills/                 # Skill definitions (SKILL.md with YAML frontmatter)
│   ├── agents/                 # Agent definitions
│   ├── commands/               # Command definitions
│   ├── hooks/                  # Hook scripts
│   └── tests/                  # test-*.js files + run-tests.sh
├── planning/                   # Project planning artifacts
│   ├── to do/todo.md           # FSD-### task tracker
│   ├── to do/task-fsd-NNN.md   # Per-task detail files
│   ├── PROJECT.md              # Scaffolded by /fsd-new-project
│   ├── ROADMAP.md              # Scaffolded by /fsd-new-project
│   └── ARCHITECTURE.md         # ADR log (appended via /fsd-execute-plan)
├── .fsd/                       # Runtime artifacts (spec/, plan/, research/)
├── CHANGELOG.md                # Keep-a-Changelog format
├── README.md                   # Version header: **Version X.Y.Z**
└── install.sh                  # Clone + register + verify
```

## Key Scripts (`plugin/scripts/`)

| Script | Key exports |
|--------|-------------|
| `config.js` | `loadConfig`, `resolveLayerPaths`, `getStructure` |
| `loader.js` | `loadProjectContext`, `scanArtifacts` |
| `validator.js` | `validateSkill`, `validateAgent`, `validatePlan`, `validateSpec` |
| `yaml-parser.js` | `parseYaml` (no deps) |
| `plan.js` | `writePlanFile`, `checkPlanPrecondition`, `parsePhases`, `flipPhase`, `flipAcceptance` |
| `plan-update.js` | `update`, `archive`, `supersede` — also a CLI entry point |
| `spec.js` | `writeSpecFile` |
| `spec-update.js` | `approve`, `archive`, `supersede` — also a CLI entry point |
| `architecture.js` | `appendDecision` — also a CLI entry point |
| `new-project.js` | `writeProjectFiles` |

**Script conventions:**
- Create-only writes refuse to overwrite; mutation ops live in `-update` siblings
- Atomic write: `tmp file + fs.renameSync` — never direct overwrites for artifacts
- `project:` is auto-injected from `planning/PROJECT.md` when absent

## Testing

```bash
# Run all tests
bash plugin/tests/run-tests.sh

# Run one suite
node plugin/tests/test-plan.js
```

- Test files: `plugin/tests/test-*.js` — plain Node.js `assert`, no test framework
- Fixture pattern: `fs.mkdtempSync` → write/assert → OS cleanup
- Skill tests: verify frontmatter validity, required section headings, cross-refs, guardrail language
- Every new script module and every new skill needs a corresponding test file

## Skills System

Skills live in `plugin/skills/<name>/SKILL.md` with YAML frontmatter:

```yaml
---
name: fsd-plan
argument-hint: `[spec-id]`
description: >-
  20+ char description...
---
```

Scripts invoked from skills use `$CLAUDE_PLUGIN_ROOT`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-update.js" "$(pwd)/.fsd" flip-phase --id=<id> --phase-number=NN
```

## Task Management

Tasks live in `planning/to do/todo.md` with `FSD-NNN` identifiers. Detail plans go in `planning/to do/task-fsd-NNN.md`.

When picking up a task:
1. Read `planning/to do/todo.md` for the next open item
2. Read its `task-fsd-NNN.md` plan
3. Implement and run `bash plugin/tests/run-tests.sh`
4. Flip `[ ]` → `[x]` in `todo.md`
5. CHANGELOG entry + version bump (see Versioning below) + commit

## Versioning & Release

Three files must stay in sync for every release:
1. `plugin/.claude-plugin/plugin.json` — `"version": "X.Y.Z"`
2. `README.md` — `**Version X.Y.Z**` header line
3. `CHANGELOG.md` — new `## [X.Y.Z]` block (Keep-a-Changelog format)

Bump rules:
- **MAJOR**: removed/renamed command, skill, or exported function
- **MINOR**: new command or skill
- **PATCH**: internal refactor, bug fix, docs/tests only

**Never auto-commit or auto-push.** Present the diff; let the engineer own the release boundary.

## Research > Plan > Implement

**Never jump straight to coding.** Always:
1. **Research** — Read relevant scripts and skill `SKILL.md` files; understand existing patterns
2. **Plan** — Draft `task-fsd-NNN.md` and verify with the user
3. **Implement** — Execute the plan, run the full test suite
4. **Release** — CHANGELOG + version bump, then commit

## Working Together

- Match existing patterns — check similar scripts/skills before adding new ones
- Exported functions over CLI surface — pure exports are primary; CLI is secondary
- One test file per module — `test-<module>.js` alongside every new `plugin/scripts/<module>.js`
- Create-only vs update split — authoring skills are create-only; mutations go in `-update` siblings
