---
name: fsd-help
description: Overview and quick reference for the FSD framework. No args → full workflow + skill index. Pass a skill name for a focused cheat sheet (e.g. `/fsd-help fsd-plan`).
argument-hint: `[skill-name]`
---

# FSD Help Skill

You are the entry point and quick reference for the FSD (Full Stack Development) framework. When invoked, you present the right level of detail based on `$ARGUMENTS`:

- **No args** → print the full overview: intro, core workflow, skill index, common patterns.
- **Skill name provided** (e.g. `fsd-plan`, `fsd-spec`) → print the focused cheat sheet for that skill only.
- **Unknown skill name** → list the available skill names and suggest `/fsd-help` with no args for the full overview.

Do not read any files. Do not invoke other skills. All content is baked into this skill — present it directly.

---

## Overview mode (no `$ARGUMENTS`)

Print the following sections in order when invoked with no arguments.

### Introduction

FSD is a structured workflow plugin for Claude Code. It gives engineering teams a consistent, schema-validated path through the full development lifecycle — from capturing project context once, to writing specs and plans, to executing those plans with evidence-backed verification, to shipping releases. Every skill is a named, versioned unit with a SKILL.md contract; the framework validates that contract at discovery time.

**Who it's for:** Any engineer using Claude Code on a project that benefits from structured planning artifacts — specs, plans, architecture decisions, and roadmaps — persisted in the repo alongside code.

### Core Workflow

The canonical FSD path, in order:

```
1. /fsd-new-project     — One-time project kickoff. Creates PROJECT.md + ROADMAP.md.
2. /fsd-spec <title>    — Write a spec for a feature or change (the "what/why").
3. /fsd-plan <spec-id>  — Write an implementation plan tied to the spec (the "how").
4. /fsd-execute-plan    — Execute the plan: phase loop, verification, full close-out pipeline.
```

Ongoing maintenance branches:

```
/fsd-roadmap <op>       — Add milestones, advance phases, bump versions in ROADMAP.md.
/fsd-spec-update <op>   — Edit, approve, archive, or supersede existing specs.
/fsd-plan-update <op>   — Edit, archive, or supersede existing plans.
/fsd-restructure        — Reconfigure the .fsd/ directory layout (config-driven).
```

### Skill Index

| Skill | When to use | Key argument(s) | Prerequisite |
|---|---|---|---|
| `/fsd-new-project` | Project kickoff (once per repo) | `[--force-dir=<path>]` | None |
| `/fsd-roadmap` | Add milestones/phases, advance progress, bump versions | `<add-milestone\|add-phase\|advance\|complete-phase\|bump-version>` | `planning/ROADMAP.md` |
| `/fsd-spec` | Write a new spec artifact | `[spec title]` | `planning/PROJECT.md` |
| `/fsd-spec-update` | Edit an existing spec | `<update\|approve\|archive\|supersede> <id>` | Target spec exists |
| `/fsd-plan` | Write an implementation plan for a spec | `[spec-id]` | Spec exists + `planning/PROJECT.md` |
| `/fsd-plan-update` | Edit an existing plan | `<update\|archive\|supersede> <id>` | Target plan exists |
| `/fsd-execute-plan` | Execute a plan end-to-end | `[plan-id]` | Plan exists + `planning/PROJECT.md` |
| `/fsd-restructure` | Reconfigure `.fsd/` directory structure | None | `.fsd/config.yaml` exists |
| `/fsd-help` | This overview or a per-skill cheat sheet | `[skill-name]` | None |

### Common Patterns

**Starting a new project**

```
/fsd-new-project
```
Creates `planning/PROJECT.md` (identity, scope, tech context, success metrics, anti-goals, verification commands) and `planning/ROADMAP.md` (first milestone + phase). Run once. All downstream skills read from these files.

**Adding a feature**

```
/fsd-spec "User authentication via OAuth"
/fsd-plan auth-via-oauth
/fsd-execute-plan auth-via-oauth
```
Write a spec first, then a plan that links to it, then execute. The executor closes the full pipeline: phases, verification, CHANGELOG, version bump, status flips.

**Revising a spec mid-flight**

```
/fsd-spec-update update auth-via-oauth --target=section --section=requirements
/fsd-spec-update approve auth-via-oauth
```
Surgical edits to one field or section at a time. `approve` flips `approved: true`. If requirements changed substantially, `supersede` it with a new spec.

**Updating the roadmap**

```
/fsd-roadmap add-phase --milestone=v1 --id=v1.3 --title="Performance hardening"
/fsd-roadmap advance
/fsd-roadmap complete-phase --id=v1.2
```
Keeps `planning/ROADMAP.md` current without touching goal prose.

**Finding your place in a project**

```
/fsd-help                      — see the full skill map
node plugin/scripts/validate.js plugin --artifacts   — scan all artifacts
/fsd-plan-update update <id> --target=status         — flip plan active
```

---

## Deep-dive mode (`$ARGUMENTS` non-empty)

Parse the first whitespace-separated token from `$ARGUMENTS`. Match it (case-insensitively, with or without the `fsd-` prefix) against the eight skills below:

| Input form | Matches |
|---|---|
| `fsd-plan`, `plan` | `/fsd-plan` cheat sheet |
| `fsd-spec`, `spec` | `/fsd-spec` cheat sheet |
| `fsd-new-project`, `new-project` | `/fsd-new-project` cheat sheet |
| `fsd-roadmap`, `roadmap` | `/fsd-roadmap` cheat sheet |
| `fsd-spec-update`, `spec-update` | `/fsd-spec-update` cheat sheet |
| `fsd-plan-update`, `plan-update` | `/fsd-plan-update` cheat sheet |
| `fsd-execute-plan`, `execute-plan` | `/fsd-execute-plan` cheat sheet |
| `fsd-restructure`, `restructure` | `/fsd-restructure` cheat sheet |

**No match:** Print:
> "`<token>` is not a recognized FSD skill. Available skills: fsd-new-project, fsd-roadmap, fsd-spec, fsd-spec-update, fsd-plan, fsd-plan-update, fsd-execute-plan, fsd-restructure. Run `/fsd-help` with no args for the full overview."

Print only the matched cheat sheet — do not print the full overview.

---

## Per-Skill Cheat Sheets

### /fsd-new-project

**Purpose:** One-time project kickoff. Creates `planning/PROJECT.md` (identity, scope, tech, metrics, anti-goals, verification commands) and `planning/ROADMAP.md` (first milestone + phase).

**Prerequisites:** None. Run right after cloning or initializing a repo.

**Argument syntax:**
```
/fsd-new-project
/fsd-new-project --force-dir=<path>   # target a subdirectory instead of ./planning/
```

**What it does:** Runs a one-question-at-a-time interview (project name, target users, scope, tech context, success metrics, anti-goals, verification commands), then an initial roadmap interview (first milestone + phase). Refuses to overwrite existing files.

**Common invocations:**
```
/fsd-new-project                         # default — writes to ./planning/
/fsd-new-project --force-dir=sub/plan    # writes to sub/plan/
```

**What to do next:** Run `/fsd-spec <title>` to write your first feature spec.

---

### /fsd-roadmap

**Purpose:** Ongoing maintenance of `planning/ROADMAP.md` after `/fsd-new-project` created it. Five surgical operations; never rewrites your goal prose.

**Prerequisites:** `planning/ROADMAP.md` must exist.

**Argument syntax:**
```
/fsd-roadmap add-milestone --id=<id> --version=<x.y> --name=<name> [--goal=<text>]
/fsd-roadmap add-phase --milestone=<id> --id=<phase-id> --title=<title> [--goal=<text>]
/fsd-roadmap advance
/fsd-roadmap complete-phase --id=<phase-id>
/fsd-roadmap bump-version --version=<x.y.z>
```

**Common invocations:**
```
/fsd-roadmap add-phase --milestone=v1 --id=v1.3 --title="Search"
/fsd-roadmap complete-phase --id=v1.2
/fsd-roadmap bump-version --version=0.8.0
```

**What to do next:** Write specs for the new phase's features with `/fsd-spec`.

---

### /fsd-spec

**Purpose:** Create a new spec artifact — the "what/why" contract that `/fsd-plan` reads. Lives at `.fsd/<structure.spec>/<id>.md`.

**Prerequisites:** `planning/PROJECT.md` must exist and validate. If missing, the skill offers to chain-invoke `/fsd-new-project`.

**Argument syntax:**
```
/fsd-spec <spec title>    # title passed directly; skips the title question
/fsd-spec                 # skill asks for the title interactively
```

**What it does:** Interviews you for frontmatter (id, title, status, approved, related, tags) and six body sections (Problem, Goals, Non-goals, Requirements, Acceptance, Open questions). One question at a time. Previews the rendered file before writing.

**Common invocations:**
```
/fsd-spec "OAuth login flow"
/fsd-spec "Rate limiting for API endpoints"
```

**What to do next:** Run `/fsd-plan <spec-id>` to write the implementation plan for this spec.

---

### /fsd-spec-update

**Purpose:** Edit an existing spec. Four surgical operations — `update`, `approve`, `archive`, `supersede`. Never creates a new spec (that's `/fsd-spec`).

**Prerequisites:** Target spec must exist in `.fsd/<structure.spec>/`.

**Argument syntax:**
```
/fsd-spec-update update <id> --target=<title|status|related|tags|section> [--value=<v>]
/fsd-spec-update approve <id>
/fsd-spec-update archive <id>
/fsd-spec-update supersede <new-id> --replaces <old-id>
```

**Common invocations:**
```
/fsd-spec-update approve oauth-login
/fsd-spec-update update oauth-login --target=section --section=requirements
/fsd-spec-update archive old-rate-limiting
/fsd-spec-update supersede rate-limiting-v2 --replaces rate-limiting
```

**What to do next:** After approving, run `/fsd-plan <spec-id>` if you haven't already.

---

### /fsd-plan

**Purpose:** Write a technical implementation plan — the "how" that `/fsd-execute-plan` reads. Lives at `.fsd/<structure.plan>/<id>.md`. Requires a spec to link to.

**Prerequisites:** `planning/PROJECT.md` valid + target spec exists and is not archived.

**Argument syntax:**
```
/fsd-plan <spec-id>    # link to an existing spec
/fsd-plan              # skill lists available specs and asks you to pick
```

**What it does:** Enters Claude Code's native plan mode for read-only context gathering (spec, PROJECT.md, ROADMAP.md, ARCHITECTURE.md, existing plans, hinted code files). Runs a Socratic discussion to fill gaps section by section. Writes the plan on `ExitPlanMode` approval. Phases are emitted as inline checkboxes (`- [ ] **Phase 01** — <title>`) that `/fsd-execute-plan` parses.

**Common invocations:**
```
/fsd-plan oauth-login
/fsd-plan rate-limiting-v2
```

**What to do next:** Flip the plan to `active` when phases are locked (`/fsd-plan-update update <id> --target=status --value=active`), then execute with `/fsd-execute-plan <plan-id>`.

---

### /fsd-plan-update

**Purpose:** Edit an existing plan. Three surgical operations — `update`, `archive`, `supersede`. Never creates a new plan (that's `/fsd-plan`).

**Prerequisites:** Target plan must exist in `.fsd/<structure.plan>/`.

**Argument syntax:**
```
/fsd-plan-update update <id> --target=<title|status|related|tags|depends_on|task|estimate|section> [--value=<v>]
/fsd-plan-update archive <id>
/fsd-plan-update supersede <new-id> --replaces <old-id>
```

**Common invocations:**
```
/fsd-plan-update update oauth-login --target=status --value=active
/fsd-plan-update update oauth-login --target=estimate --value="~3 days"
/fsd-plan-update archive oauth-login
/fsd-plan-update supersede oauth-login-v2 --replaces oauth-login
```

**What to do next:** Once the plan is `active`, run `/fsd-execute-plan <plan-id>`.

---

### /fsd-execute-plan

**Purpose:** Drive a plan end-to-end. Walks the plan's `- [ ] **Phase NN**` checkboxes, runs per-phase verification, progressively flips checkboxes as each phase passes, then closes the full pipeline: CHANGELOG entry, version alignment, `todo.md` task flip, plan archive, spec approve, optional ARCHITECTURE.md ADR appends — all gated behind one final ACK. No auto-commit.

**Prerequisites:** `planning/PROJECT.md` valid + target plan exists and is not archived.

**Argument syntax:**
```
/fsd-execute-plan <plan-id>    # execute the named plan
/fsd-execute-plan              # skill lists non-archived plans and asks you to pick
```

**What it does:**
1. Pre-flight summary (plan title, phase count, verification commands, pipeline write list) + yes/no before starting.
2. Phase loop: implement each phase → run verification → flip phase checkbox.
3. AC walkthrough: prove each acceptance criterion with evidence → flip each AC checkbox.
4. Pipeline ACK: present a summary of all pending writes, wait for confirmation, then write CHANGELOG, bump version, flip plan `status → archived`, flip spec `approved → true`, mark FSD task `[x]` in `todo.md`, optionally append ADRs.
5. Handoff with suggested commit boundaries.

**Common invocations:**
```
/fsd-execute-plan oauth-login
/fsd-execute-plan                    # pick from list
```

**What to do next:** Commit when satisfied. If FSD tasks remain, start the next `/fsd-spec` → `/fsd-plan` → `/fsd-execute-plan` cycle.

---

### /fsd-restructure

**Purpose:** Reconfigure the `.fsd/` directory layout. Reads `.fsd/config.yaml`, validates the new structure, moves files, and updates config — without losing any authored artifacts.

**Prerequisites:** `.fsd/config.yaml` must exist (created by `/fsd-new-project` via `fsd:init`).

**Argument syntax:**
```
/fsd-restructure    # no args — reads config and walks you through the change interactively
```

**Common invocations:**
```
/fsd-restructure    # rename spec/ to specs/, plan/ to plans/, etc.
```

**What to do next:** Run `node plugin/scripts/validate.js plugin --artifacts` to confirm all artifacts are picked up under the new paths.

---

## Guardrails

- **Read-only.** This skill never reads files and never writes files. All content is baked in.
- **No chaining.** Never invoke another skill from within `/fsd-help`. If the user needs to run `/fsd-new-project` or any other skill, tell them the command — don't invoke it for them.
- **No guessing.** If `$ARGUMENTS` contains a skill name you don't recognize, list the known names and stop. Don't infer what the user meant.
- **One thing at a time.** If the user asks about two skills in the same invocation, pick the first token and note that they can invoke `/fsd-help <skill>` again for the second.
