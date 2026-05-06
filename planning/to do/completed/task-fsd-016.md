# FSD-016 — Create a `/fsd-help` skill to guide users how to effectively use the FSD framework

## Source

Organic need: users coming into a project with FSD installed have no single entry point to learn what skills exist, what order to use them, and what each one does. Every other skill assumes you already know where you are in the workflow.

## Summary

Add a pure content skill, `/fsd-help`, that explains the FSD framework to new users and serves as a quick reference for experienced ones. No backing script required — the skill SKILL.md IS the documentation. Two modes: overview (no args) prints the workflow + full skill index; deep-dive (`/fsd-help <skill-name>`) prints a curated cheat sheet for a specific skill.

## Assessment

No `/fsd-help` skill exists yet. The eight shipped skills are:

| Skill | SKILL.md location |
|---|---|
| `fsd-new-project` | `plugin/skills/fsd-new-project/SKILL.md` |
| `fsd-roadmap` | `plugin/skills/fsd-roadmap/SKILL.md` |
| `fsd-spec` | `plugin/skills/fsd-spec/SKILL.md` |
| `fsd-spec-update` | `plugin/skills/fsd-spec-update/SKILL.md` |
| `fsd-plan` | `plugin/skills/fsd-plan/SKILL.md` |
| `fsd-plan-update` | `plugin/skills/fsd-plan-update/SKILL.md` |
| `fsd-execute-plan` | `plugin/skills/fsd-execute-plan/SKILL.md` (FSD-009, pending) |
| `fsd-restructure` | `plugin/skills/fsd-restructure/SKILL.md` |

There is no test file for a skill with no backing script. The nearest analog is the SKILL.md sanity block inside `test-fsd-execute-plan.js` — a set of structural assertions on the SKILL.md itself (valid frontmatter, key sections present, cross-references correct). The test for FSD-016 follows that pattern.

**Location:** `plugin/skills/` — new subdirectory `fsd-help/`

## Plan

1. **Create `plugin/skills/fsd-help/SKILL.md`**

   Frontmatter:
   ```yaml
   name: fsd-help
   description: Overview and quick reference for the FSD framework. No args → full workflow + skill index. Pass a skill name for a focused cheat sheet (e.g. `/fsd-help fsd-plan`).
   argument-hint: `[skill-name]`
   ```

   Body structure:
   - **Introduction** — one paragraph on what FSD is and who it's for
   - **Core workflow** — numbered steps showing the canonical path: `fsd-new-project` → `fsd-spec` → `fsd-plan` → `fsd-execute-plan`; with branches for `fsd-roadmap`, `fsd-spec-update`, `fsd-plan-update`
   - **Skill index** — table with columns: Skill, When to use, Key argument(s), Related
   - **Deep-dive mode** — instructions on what to print when a `$ARGUMENTS` token is provided (skill name → curated cheat sheet per the per-skill sections below)
   - **Per-skill cheat sheets** — one `### /fsd-<name>` subsection for each of the 8 skills, each covering: purpose (1 line), prerequisites, argument syntax, common invocations, and what to run next
   - **Common patterns** — "Starting a new project", "Adding a feature", "Revising a spec mid-flight", "Checking what skills are available"
   - **Guardrails** — stay read-only; never write files; never chain-invoke another skill unprompted

2. **Write `plugin/tests/test-fsd-help.js`**

   Structural assertions on the SKILL.md (no backing script to probe):
   - File exists at the expected path
   - Frontmatter parses cleanly (name, description, argument-hint present)
   - `name` equals `fsd-help`
   - `argument-hint` is present
   - All 8 skill names appear in the body (`fsd-new-project`, `fsd-roadmap`, `fsd-spec`, `fsd-spec-update`, `fsd-plan`, `fsd-plan-update`, `fsd-execute-plan`, `fsd-restructure`)
   - "Overview" or "overview" section/heading present
   - "Deep-dive" or "deep-dive" or equivalent arg-dispatch section present
   - "Guardrails" section present
   - No `{{` / `}}` unfilled template markers

3. **Update CHANGELOG.md and version**

   New skill = MINOR bump. Current version is `0.11.0`. If FSD-009 (`fsd-execute-plan`) ships first, coordinate to avoid double-bumping — ship both under a single `0.12.0` entry or make this `0.13.0` accordingly. Whichever number is correct, update:
   - `plugin/.claude-plugin/plugin.json` → `"version": "X.Y.0"`
   - `README.md` header line
   - `CHANGELOG.md` → new `## [X.Y.0] - 2026-04-24` block

## Acceptance Criteria

- [x] `plugin/skills/fsd-help/SKILL.md` exists
- [x] Frontmatter has `name: fsd-help`, a non-empty `description`, and `argument-hint`
- [x] Overview mode documented: no-args path prints workflow + skill index
- [x] Deep-dive mode documented: `$ARGUMENTS` non-empty → per-skill cheat sheet for named skill
- [x] All 8 current skills (fsd-new-project, fsd-roadmap, fsd-spec, fsd-spec-update, fsd-plan, fsd-plan-update, fsd-execute-plan, fsd-restructure) have dedicated cheat sheet subsections
- [x] Common patterns section present (at least "Starting a new project" and "Adding a feature")
- [x] Guardrails section present (read-only, no writes, no unprompted skill chaining)
- [x] `plugin/tests/test-fsd-help.js` exists and passes (`node plugin/tests/test-fsd-help.js` exits 0)
- [x] Full test suite passes (`bash plugin/tests/run-tests.sh` exits 0)
All criteria verified 2026-04-24 before commit.

- [x] CHANGELOG.md has a new version entry covering FSD-016
- [x] `plugin/.claude-plugin/plugin.json` version and README header line match the CHANGELOG entry
