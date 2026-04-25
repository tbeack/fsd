# FSD — Full Stack Development Framework

**Version 0.14.1** — released 2026-04-25 · [Changelog](./CHANGELOG.md)

A multi-layer meta-framework plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with schema-validated skills, agents, and commands. Content is resolved across multiple layers so you can customize or override anything without touching the plugin itself.

## What It Does

FSD gives Claude Code a structured development workflow through two layers of skills plus two agents, all schema-validated at discovery time:

- **Core workflow skills** (brainstorm, plan, execute, verify, debug) — the TDD-shaped inner loop.
- **Authoring skills** (`/fsd:new-project`, `/fsd:roadmap`, `/fsd:spec`, `/fsd:spec-update`, `/fsd:plan`, `/fsd:plan-update`, `/fsd:add-task`, `/fsd:do-task`, `/fsd:restructure`) — project-context and artifact surfaces that persist decisions, specs, plans, and task state under `planning/` and `.fsd/`.
- **Core agents** (explorer, reviewer) — codebase analysis and review.

Every artifact the authoring skills produce has a formal YAML frontmatter schema; `/fsd:validate` can scan them on demand.

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

SKILLS (core workflow)
  brainstorm            core      Ideation and design exploration
  plan                  core      Task breakdown and ordering
  execute               core      TDD implementation
  verify                core      Quality verification
  debug                 core      Systematic debugging

SKILLS (authoring surface)
  new-project       core      One-time PROJECT.md + ROADMAP.md kickoff
  roadmap           core      Mid-project roadmap maintenance
  spec              core      Create spec artifact
  spec-update       core      Edit spec artifact (update/approve/archive/supersede)
  plan              core      Guided technical plan in native plan mode
  plan-update       core      Edit plan artifact (update/archive/supersede)
  add-task          core      Append FSD-NNN task to planning/to do/todo.md
  do-task           core      Plan or execute a tracked FSD-NNN task
  restructure       core      Rename .fsd/ content-kind directories

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
- `spec/`, `plan/`, `research/` -- artifact storage (each pre-seeded with `.gitkeep`)

After `/fsd:init`, run **`/fsd:new-project`** (see below) to capture project identity and the first roadmap entry — every downstream skill reads from those files.

### `/fsd:restructure`

Rename content-kind directories inside `.fsd/` after install, in a single safe operation — either the scannable kinds (`skills`, `agents`, `commands`) or the storage kinds (`spec`, `plan`, `research`). For example, rename `.fsd/skills/` → `.fsd/capabilities/`, or `.fsd/spec/` → `.fsd/specifications/`. Preview-first and confirmation-gated: the skill prints the rename plan, flags stale references in content bodies (without rewriting them — that call is the engineer's), and refuses to run when `.fsd/` has uncommitted changes unless `--force` is passed. Reserved names (`config.yaml`, `.state.yaml`), path separators, leading dots, and aliases (two kinds pointing at the same directory) are hard-refused. Updates `.fsd/config.yaml` `structure:` so the loader, `/fsd:add`, `/fsd:list`, `/fsd:validate`, the session-start hook, and every artifact-producing skill see the new layout on the next session.

Usage: `/fsd:restructure kind=newname [...] [--apply] [--force]`.

### `/fsd:new-project`

Interactive one-time kickoff. Walks through the project's identity, scope, tech context, success metrics, anti-goals, first milestone, and first phase — then writes `planning/PROJECT.md` and `planning/ROADMAP.md`. Refuses to overwrite either file if already present. See **Project Context** below for the frontmatter schema and examples.

### `/fsd:roadmap`

Mid-project maintenance for `planning/ROADMAP.md`. Dispatches five surgical operations that edit the file in place while preserving user-authored goal prose and re-validating the schema on every write:

| Op | Purpose |
|---|---|
| `add-milestone` | Append a new `## Milestone <id>` block. Optionally set as current. |
| `add-phase` | Insert a new `### Phase <id>` block into a named milestone. |
| `advance` | Mark current milestone shipped; flip `current_milestone` + `version` to the next milestone (auto-adopts its `**Version:**` into frontmatter). |
| `complete-phase` | Mark a named phase shipped via a `**Status:** shipped (YYYY-MM-DD)` body line. |
| `bump-version` | Frontmatter `version:` bump (patch-style; does not touch milestones). |

`advance` and `complete-phase` are idempotent — re-running on an already-shipped section no-ops instead of double-inserting. All ops abort without touching the file if the result would fail `validateRoadmap`. Refuses to run if `planning/ROADMAP.md` is missing (use `/fsd:new-project` to create it first).

### `/fsd:spec`

Create a new spec artifact under `.fsd/<structure.spec>/<id>.md`. Interviews the user one question at a time for the spec's frontmatter (`id`, `title`, `status`, `approved`, `related`, `tags`) and six body sections — **Problem**, **Goals**, **Non-goals**, **Requirements**, **Acceptance**, **Open questions** — then renders a validated markdown file. Auto-injects `project:` from `planning/PROJECT.md`, so `/fsd:new-project` is a soft prerequisite; if PROJECT.md is missing, the skill offers to chain-invoke `/fsd:new-project` first. Refuses to overwrite an existing spec — editing is handled by `/fsd:spec-update` (see below). Optional title in `$ARGUMENTS` (e.g. `/fsd:spec artifact metadata schema`) skips the title question.

### `/fsd:spec-update`

Edit an existing spec artifact. Dispatches four surgical operations that re-validate via `validateSpec` before writing and preserve untouched sections byte-for-byte:

| Op | Purpose |
|---|---|
| `update` | Surgical edit of ONE thing: `title`, `status` (draft ↔ active), `related` (add/remove one), `tags` (add/remove one), OR one of the six body sections (Problem / Goals / Non-goals / Requirements / Acceptance / Open questions). |
| `approve` | Flip `approved: true`. Idempotent — re-running on an already-approved spec no-ops. |
| `archive` | Flip `status: archived`. Idempotent. |
| `supersede` | Add `oldId` to the new spec's `supersedes:` array AND archive the old spec. Best-effort atomic: if the second write fails, the first is rolled back from an in-memory backup. |

Refuses to run if the target spec doesn't exist — use `/fsd:spec` to create new specs. Every op bumps frontmatter `updated:` to today. Out of scope for v1: `rename-id` (file rename), `unapprove`, `unarchive`, mass/batch ops, edit history.

### `/fsd:plan`

Guided technical-implementation planning **inside Claude Code's native plan mode**. Engineer-led — you provide the technical, architectural, and implementation guidance; the skill reads prior context and asks pointed questions only where that context doesn't cover. Produces a plan artifact under `.fsd/<structure.plan>/<id>.md` with six body sections (**Context**, **Approach**, **Phases**, **Risks**, **Acceptance**, **Open questions**).

Six-step flow:

1. **Preconditions** — loads PROJECT.md (offers to chain-invoke `/fsd:new-project` if missing). Hard-requires a spec linkage: the first `$ARGUMENTS` token names a spec id in `.fsd/<structure.spec>/`; archived specs are refused, unapproved specs require explicit opt-in.
2. **Enter plan mode.**
3. **Context gathering (read-only)** — linked spec in full + PROJECT.md + ROADMAP.md + `planning/ARCHITECTURE.md` (if present) + frontmatter of every existing plan + files/symbols the spec explicitly names. No broad repo scan.
4. **Socratic discussion + draft iteration** — section-by-section; asks clarifying questions only for gaps. `depends_on:` is surfaced from the existing-plan list, not prompted as a frontmatter field.
5. **Architecture delta** — if `planning/ARCHITECTURE.md` exists, offers to append ADR-style decisions and/or section content. If missing, offers lazy creation seeded from this plan's technical decisions.
6. **ExitPlanMode + write** — on engineer approval the harness grants, writes the plan artifact and any architecture delta. Never auto-commits.

Usage: `/fsd:plan [spec-id]`. Omit the argument to have the skill list existing specs and ask which one. Plan id defaults to the spec id (different directories, no collision). Create-only — editing existing plans is handled by `/fsd:plan-update` (see below).

### `/fsd:plan-update`

Edit an existing plan artifact. Dispatches three surgical operations that re-validate via `validatePlan` before writing and preserve untouched sections byte-for-byte:

| Op | Purpose |
|---|---|
| `update` | Surgical edit of ONE thing: `title`, `status` (draft ↔ active), `related` (add/remove one), `tags` (add/remove one), `depends_on` (add/remove one), `task` (set/clear), `estimate` (set/clear), OR one of the six body sections (Context / Approach / Phases / Risks / Acceptance / Open questions). |
| `archive` | Flip `status: archived`. Idempotent. |
| `supersede` | Add `oldId` to the new plan's `supersedes:` array AND archive the old plan. Best-effort atomic: if the second write fails, the first is rolled back from an in-memory backup. |

Refuses to run if the target plan doesn't exist — use `/fsd:plan` to create new plans. Every op bumps frontmatter `updated:` to today. `update remove-related` does NOT special-case the spec-hard-require link — engineer takes responsibility for keeping the plan authorable. Out of scope for v1: `rename-id` (file rename), `unarchive`, mass/batch ops, edit history.

### `/fsd:execute-plan`

Stateful plan executor. Consumes an approved plan artifact, walks its `- [ ] **Phase NN** — <title>` inline checkboxes, runs per-phase verification commands, progressively flips each phase checkbox on pass, walks the Acceptance section the same way, and — after a single final ACK — lands the full close-out pipeline. No auto-commit; the engineer owns the release boundary.

Six-step flow:

1. **Preconditions** — loads PROJECT.md (aborts with a pointer to `/fsd:new-project` if missing; unlike `/fsd:plan`, does NOT chain-invoke). Calls `checkPlanPrecondition` — refuses on missing plan / archived plan / zero Phase NN entries / zero open `- [ ]` acceptance / missing or archived linked spec; surfaces warnings for draft plans and unapproved specs (engineer opts in to proceed).
2. **Pre-flight summary + yes/no gate** — prints plan title, N phases with titles, resolved verification commands + their source, version target from the plan body (if any), linked spec, linked FSD task, CHANGELOG flag, ARCHITECTURE.md presence. Asks once: `Proceed?`.
3. **Phase execution loop** — one `TaskCreate` per phase; verification discovery order is phase-body `verify:` backtick hint > plan frontmatter `verification:` > PROJECT.md `verification:` > ask engineer. On any verification failure, STOP — do not flip the phase and do not advance. On pass, flip via `plan-update.js flip-phase --phase-number=NN`. Chat messages starting `adr:` during Step 3 are captured as scratch-list titles for Step 5. After the last phase, re-run the full verification suite as a regression check.
4. **Acceptance walkthrough** — for each `- [ ]`, produce concrete evidence (test output, file probe), then flip via `plan-update.js flip-ac --line-matcher=<substring>`. Never edit AC text to make it pass. After every AC is `[x]`, insert `All criteria verified YYYY-MM-DD before commit.` above the list.
5. **Pipeline close-out — single ACK gate** — previews five ops: CHANGELOG entry, version alignment across `plugin/.claude-plugin/plugin.json` + README header + CHANGELOG heading, `planning/to do/todo.md` task flip (if plan `task:` is set), plan `status → archived`, linked spec `approved → true` (only if currently false). Scratch-list ADRs are filled in here (Context / Decision / Consequences) and appended to `planning/ARCHITECTURE.md`. Asks once; on yes, applies each write independently.
6. **Handoff** — prints the commit-boundary list from the plan body (if present) and reminds the engineer to review with `git diff` and push when ready. Never auto-commits.

Usage: `/fsd:execute-plan [plan-id]`. Omit the argument to have the skill list non-archived plans and ask which one to execute. Cross-reference pair: `/fsd:plan` writes the plan, `/fsd:plan-update` edits it, `/fsd:execute-plan` consumes it.

### `/fsd:add-task`

Capture a new task entry in `planning/to do/todo.md` with auto-incremented `FSD-NNN` numbering. Two modes:

- **Quick-add (default)** — appends a single bullet `` - [ ] `FSD-NNN` — <title> `` to the `## Backlog` list. Optimized for batch capture; no task file is created.
- **Detail mode** (`--detail`) — walks the user through Source / Summary / Assessment / Plan / Acceptance Criteria questions one at a time, writes `planning/to do/task-fsd-NNN.md`, and links the todo.md entry to the task file.

Usage: `/fsd:add-task [--detail] [brief task title]`. Always reads `todo.md` first to find the highest existing FSD number (never guesses); refuses to add dead links to task files it hasn't created; never implements the task (that's what `/fsd:do-task` is for).

### `/fsd:do-task`

Mode-switching task executor — the natural follow-on to `/fsd:add-task`. Reads `planning/to do/todo.md`, finds the named `FSD-NNN` entry, then branches:

- **Plan mode** — entry exists but no `task-fsd-NNN.md` file yet. Drafts the plan (Source / Summary / Assessment / Plan / Acceptance Criteria), writes the task file, links it from `todo.md`, and stops. No code is written.
- **Execute mode** — entry + task file both exist. Builds a `TaskCreate` working list, implements the plan's steps, runs the verification suite (`run-tests.sh` + `validate.js` + any task-specific probes), marks each Acceptance Criterion `- [x]` progressively with evidence, writes the CHANGELOG entry the plan specifies (or asks if unspecified), bumps the version across `plugin.json` + README + CHANGELOG when the plan calls for it, and marks the todo.md entry `- [x]`. Stops before committing — the user owns the release step.

Usage: `/fsd:do-task <FSD-NNN | NNN | N>`. Accepts any normalizable form (`4`, `004`, `fsd-4`, `FSD-004`) and canonicalizes to `FSD-004`. Never switches tasks mid-flow, never marks an AC verified without evidence, and never auto-commits.

### `/fsd:help`

Overview + quick reference for the framework. Read-only — no files read, no other skills invoked, no writes. Two dispatch modes:

- **No args** → prints the full overview: intro, canonical four-step core workflow (`/fsd:new-project` → `/fsd:spec` → `/fsd:plan` → `/fsd:execute-plan`), the ongoing-maintenance branches (`/fsd:roadmap`, `/fsd:spec-update`, `/fsd:plan-update`, `/fsd:restructure`), a skill index table keyed by "when to use" / key arguments / prerequisite, and common-pattern recipes (starting a new project, adding a feature, revising a spec mid-flight, updating the roadmap, finding your place in a project).
- **Skill name arg** (e.g. `/fsd:help plan`) → prints a focused cheat sheet for that skill: purpose, prerequisites, argument syntax, common invocations, and what to run next. Cheat sheets ship for all eight workflow skills: `new-project`, `roadmap`, `spec`, `spec-update`, `plan`, `plan-update`, `execute-plan`, `restructure`.

Unknown skill names return the available-skill list and point back at `/fsd:help` with no args.

Usage: `/fsd:help [skill-name]`. No backing script — the SKILL.md is the deliverable. Guardrails: read-only, never writes, never chains.

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
# Use /fsd:restructure to rename any of these safely after install —
# it physically renames the directory, updates this config, and flags
# stale references in content bodies.
structure:
  # Scannable kinds (loaded and activated by the framework):
  # skills: capabilities     # renames .fsd/skills/ → .fsd/capabilities/
  # agents: bots
  # commands: actions
  # Storage kinds (artifacts written by /fsd:spec, /fsd:plan, /fsd-research):
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

Separate from the `.fsd/` content kinds, FSD persists a trio of files under `planning/` that capture the project's framing. They are written once (by `/fsd:new-project` or lazily by `/fsd:plan` for architecture) and maintained over time (by `/fsd:roadmap` for the roadmap, by `/fsd:plan` for the architecture log), and read by downstream skills so every session starts with shared context:

- `planning/PROJECT.md` — identity, scope, tech context, success metrics, anti-goals
- `planning/ROADMAP.md` — versioned milestones → numbered phases
- `planning/ARCHITECTURE.md` — long-lived stack, ADR-style decisions, code examples, references, standards, glossary, open architectural questions

**Create once, edit many.** `/fsd:new-project` writes both files and refuses to overwrite. `/fsd:roadmap` is the ongoing-edits surface for the roadmap: add milestones, add phases, advance when a milestone ships, mark a phase complete, or bump the version without disturbing user-authored goal paragraphs. Every edit re-validates against the schema; failed edits leave the file on disk unchanged.

Downstream artifact skills read `PROJECT.md` on demand to inject project framing into what they write. `/fsd:spec` auto-injects `project:` from `planning/PROJECT.md` into every new spec, so running `/fsd:new-project` once up front means you never re-type the project name or re-explain the project scope in later sessions. If you invoke `/fsd:spec` before `/fsd:new-project`, the skill detects the missing file and offers to chain-invoke the kickoff first.

The spec pair follows the same **create once, edit many** shape as the project-context pair: `/fsd:spec` writes the file and refuses to overwrite; `/fsd:spec-update` is the ongoing-edits surface (update / approve / archive / supersede), mirroring how `/fsd:new-project` + `/fsd:roadmap` split creation from maintenance for the roadmap.

`/fsd:plan` owns `planning/ARCHITECTURE.md` end-to-end: on its first invocation with no architecture file present, it offers to lazy-create one seeded from the plan's technical decisions. On every subsequent invocation, it offers to append ADR-style entries to the `## Decisions` section (newest-first) and/or append content to the other six sections in place. The engineer decides what lands in ARCHITECTURE.md versus what stays phase-local. `loadProjectContext` surfaces the file alongside PROJECT.md and ROADMAP.md so any future skill can read it.

When PROJECT.md and ROADMAP.md are both present and their frontmatter validates, the session-start hook prints a one-line header: `Project: <name> — Milestone: <current> (v<version>)`. If either file is absent or invalid, the header is hidden (no noisy errors at session start — use `/fsd:validate` for that). ARCHITECTURE.md is not surfaced in the header in v1.

**PROJECT.md schema**

Required: `project` (non-empty string), `id` (kebab-case), `title` (non-empty), `status` (`draft|active|archived`), `created` (ISO date).

Optional: `updated`, `tags` (kebab-case array), `vision` (string), `target_users` (array of strings), `verification` (repo-wide verification command map consumed by `/fsd:execute-plan`).

**`verification:`** is a one-level object with optional string subfields `tests`, `validate`, `typecheck`, `lint`. Unknown subfields parse but surface as validator warnings. Plans may override at the plan level (same field, plan frontmatter); `/fsd:execute-plan`'s discovery order is plan-frontmatter > PROJECT.md > ask engineer.

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
verification:
  tests: bash plugin/tests/run-tests.sh
  validate: node plugin/scripts/validate.js plugin
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

The validator enforces frontmatter format only; it does **not** check that `current_milestone` references an existing heading in the body, or that phase ids point at real specs/plans (mirroring the artifact-schema stance — cross-ref resolution will land with `/fsd:roadmap` in FSD-007).

**ARCHITECTURE.md schema**

Required: all the PROJECT.md common fields (`project`, `id`, `title`, `status`, `created`). No artifact-specific extensions in v1. By convention the `id:` is `architecture` and the title is `<ProjectName> Architecture`.

```yaml
---
project: My Project
id: architecture
title: My Project Architecture
status: active
created: 2026-04-24
updated: 2026-04-24
---

# My Project Architecture

## Stack & Technical Details

Node 20+, zero dependencies, atomic file writes via tmp + rename.

## Decisions

### 2026-04-24 — Use native plan mode for /fsd:plan

**Context:** The planning skill needs engineer approval before writing artifacts.

**Decision:** Skill invokes `EnterPlanMode` early; the drafted plan is the `ExitPlanMode` payload.

**Consequences:** Approval gate is enforced by the harness; bypassing plan mode is a security boundary violation.

## Code Examples
...

## References
...

## Standards
...

## Glossary
...

## Open architectural questions
...
```

Append semantics (enforced by `/fsd:plan`): the `## Decisions` section grows newest-first with `### YYYY-MM-DD — <title>` ADR entries (Context / Decision / Consequences sub-fields). The other six sections are edited in place — first append strips the italic placeholder, subsequent appends land at the end.

### Artifact Schemas

Storage-kind artifacts (`spec`, `plan`, `research`) are markdown files with YAML frontmatter. The framework does not load them at session start — they are passive data, scanned on demand by `/fsd:validate --artifacts` and consumed by the corresponding authoring skills (`/fsd:spec`, `/fsd:plan`, `/fsd-research`).

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

Plan-only optional fields: `task` (string, often an FSD-NNN reference), `depends_on` (array of plan ids), `estimate` (string), `supersedes` (array of plan ids), `verification` (object — same shape as PROJECT.md's `verification:`; overrides the PROJECT.md-level commands at execute time).

Plans are authored by `/fsd:plan`, which hard-requires a `related: spec/<id>` entry pointing at an existing spec. Archived specs are refused; unapproved specs require explicit engineer opt-in (the validator itself is format-only — the hard-require is enforced at author time).

**Phase checkbox convention (consumed by `/fsd:execute-plan`).** The `## Phases` body section is structured as a list of top-level checkbox entries:

```
## Phases

- [ ] **Phase 01** — Validator extension
  - Add helper
  - Wire it in
- [ ] **Phase 02** — Skill retrofit
  - Update SKILL.md
```

Numbering is two-digit zero-padded; freeform prose between phases is tolerated (only the checkbox lines are parsed via `parsePhases` in `plan-update.js`). `/fsd:execute-plan` flips each `- [ ]` to `- [x]` as that phase's verification passes; the Acceptance section is flipped the same way via a substring matcher against each AC line.

**`adr:` chat prefix (mid-execution ADR capture).** During `/fsd:execute-plan`'s phase loop, the engineer can surface an architecture decision by prefacing a chat message with `adr:` followed by a one-line title. The executor captures the title into an in-memory scratch list and — at the end-of-run ACK gate — prompts for Context / Decision / Consequences per entry before appending them to `planning/ARCHITECTURE.md`'s `## Decisions` section via `architecture.appendDecision`. No mid-phase writes; every ADR is engineer-confirmed before it lands.

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

### Core workflow

| Skill | Purpose |
|-------|---------|
| **brainstorm** | Explore ideas and requirements before implementation |
| **plan** | Break a design into ordered, testable tasks |
| **execute** | Implement tasks with TDD and atomic commits |
| **verify** | Confirm work meets requirements and passes tests |
| **debug** | Systematic diagnosis with evidence-based reasoning |

### Authoring surface

Long-lived project context and artifacts. Pair-shaped where each pair splits creation from maintenance (`/fsd:new-project` writes + `/fsd:roadmap` maintains; `/fsd:spec` writes + `/fsd:spec-update` maintains; `/fsd:plan` writes + `/fsd:plan-update` maintains). Every writer pre-validates via the matching `validate*` before touching disk; failed writes leave the file byte-unchanged.

| Skill | Purpose |
|-------|---------|
| **new-project** | One-time kickoff — writes `planning/PROJECT.md` + `planning/ROADMAP.md` |
| **roadmap** | Roadmap maintenance (`add-milestone` / `add-phase` / `advance` / `complete-phase` / `bump-version`) |
| **spec** | Create a new spec artifact (six body sections, auto-injects `project:`) |
| **spec-update** | Edit a spec (`update` / `approve` / `archive` / `supersede`) |
| **plan** | Guided technical plan in native plan mode; also owns `planning/ARCHITECTURE.md` |
| **plan-update** | Edit a plan (`update` / `archive` / `supersede` / `flip-phase` / `flip-ac`) |
| **execute-plan** | Drive a plan to completion — phase loop, AC walkthrough, pipeline close-out (CHANGELOG + version bump + plan archive + spec approve + todo.md flip + optional ADRs) |
| **add-task** | Capture an `FSD-NNN` task into `planning/to do/todo.md` (quick-add or `--detail`) |
| **do-task** | Plan or execute a tracked `FSD-NNN` task end-to-end |
| **restructure** | Rename `.fsd/` content-kind directories and update `config.yaml` safely |

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

See `planning/2026-03-02-fsd-framework-design.md` for the full design and evolution roadmap, and `CHANGELOG.md` for the shipped history.

Shipped:

- **v0.2** -- Schema validation, strategic config merge, `/fsd:validate`
- **v0.3** -- Configurable `.fsd/` structure, `/fsd:restructure`, `/fsd:add-task`
- **v0.4** -- Storage kinds (`spec/`, `plan/`, `research/`), `SCANNABLE_KINDS` / `STORAGE_KINDS` split
- **v0.5** -- Artifact metadata schemas, `/fsd:validate --artifacts`
- **v0.6** -- `planning/PROJECT.md` + `planning/ROADMAP.md`, `/fsd:new-project`, session-start project header
- **v0.7** -- `/fsd:roadmap` maintenance ops (add-milestone / add-phase / advance / complete-phase / bump-version)
- **v0.8** -- `/fsd:spec` (create-only spec authoring)
- **v0.9** -- `/fsd:spec-update` (update / approve / archive / supersede)
- **v0.10** -- `/fsd:plan` in native plan mode, `planning/ARCHITECTURE.md`, ADR appends
- **v0.11** (current) -- `/fsd:plan-update` (update / archive / supersede), `validatePlan.supersedes`

Planned:

- Git-based import/export system for sharing content across projects
- Workflow engine (chaining skills into composable sequences)
- Organization/team config tiers, model profiles
- Parallel execution, session continuity, multi-runtime adapters

## License

MIT
