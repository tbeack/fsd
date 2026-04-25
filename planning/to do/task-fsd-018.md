# FSD-018 — Remove `fsd-` prefix from all framework skills

## Source

User observation: the FSD plugin uses namespace `fsd`, so skills are addressed as
`fsd:<name>`. Skills currently named `fsd-plan`, `fsd-spec`, etc. produce the
double-prefix convention `fsd:fsd-plan` — confusing and inconsistent with the five
generic skills (`brainstorm`, `debug`, `execute`, `plan`, `verify`) that don't have
the prefix.

## Summary

Rename the 11 FSD-specific skill directories (and their `name:` frontmatter fields)
from `fsd-X` → `X`, so all framework skills are consistently addressable as
`fsd:<skill-name>`. Update every cross-reference in SKILL.md bodies, test files, and
docs to reflect the new names.

## Assessment

### Skills to rename

`plugin/skills/` currently contains:

| Old (directory + frontmatter `name:`) | New |
|---|---|
| `fsd-add-task` | `add-task` |
| `fsd-do-task` | `do-task` |
| `fsd-execute-plan` | `execute-plan` |
| `fsd-help` | `help` |
| `fsd-new-project` | `new-project` |
| `fsd-plan` | `plan` ⚠️ **naming conflict — see below** |
| `fsd-plan-update` | `plan-update` |
| `fsd-restructure` | `restructure` |
| `fsd-roadmap` | `roadmap` |
| `fsd-spec` | `spec` |
| `fsd-spec-update` | `spec-update` |

### ⚠️ Naming conflict: `plan`

`plugin/skills/plan/SKILL.md` already exists. It is the generic workflow skill
("break down tasks into an ordered list before coding"). Renaming `fsd-plan` → `plan`
would collide with it.

**Recommended resolution — rename the generic skill to `workflow-plan`.**

This preserves both skills, lets `fsd-plan` take the `plan` slot (consistent with
`fsd-spec`, `fsd-roadmap`, etc.), and keeps the generic skill accessible as
`fsd:workflow-plan`. Total renames: 12 directories (11 `fsd-X` + 1 generic `plan`).

Alternative: keep `fsd-plan` as-is (only rename the other 10). This is simpler but
leaves one skill with the double prefix.

**This decision must be confirmed by the user before implementation starts.**

### Cross-references in SKILL.md bodies

Many SKILL.md files reference other skills inline, e.g. `use \`/fsd-plan\` to create
new plans`. After the rename these should read `/fsd:plan`. Affected files span all 11
renamed skills plus the fsd-help index.

Known reference patterns:
- `plugin/skills/fsd-plan-update/SKILL.md` — 7 references to `/fsd-plan`, `/fsd-spec-update`
- `plugin/skills/fsd-spec-update/SKILL.md` — 5 references to `/fsd-spec`, `/fsd-roadmap`
- `plugin/skills/fsd-plan/SKILL.md` — 10+ references to `/fsd-execute-plan`, `/fsd-plan-update`, `/fsd-new-project`, `/fsd-spec-update`, `/fsd-spec`
- `plugin/skills/fsd-spec/SKILL.md` — references to `/fsd-new-project`, `/fsd-spec-update`, `/fsd-plan`, `/fsd-roadmap`
- `plugin/skills/fsd-roadmap/SKILL.md` — references to `/fsd-new-project`
- `plugin/skills/fsd-help/SKILL.md` — full skill index; all 8 workflow skill names hardcoded in body

### Test files

8 test files hard-code `fsd-` skill paths and frontmatter assertions. Several share
base names with existing script-level tests (`test-plan.js`, `test-spec.js`, etc.),
so they must be renamed to `test-skill-*.js` to avoid collisions:

| Old test file | New test file | What changes |
|---|---|---|
| `test-fsd-help.js` | `test-skill-help.js` | `skillPath`, `frontmatter.name`, `SKILL_NAMES` array (8 entries), cheat-sheet heading assertions |
| `test-fsd-spec.js` | `test-skill-spec.js` | `skillPath` |
| `test-fsd-spec-update.js` | `test-skill-spec-update.js` | `skillPath` |
| `test-fsd-plan.js` | `test-skill-plan.js` | `skillPath`, `frontmatter.name` assertion |
| `test-fsd-plan-update.js` | `test-skill-plan-update.js` | `skillPath` |
| `test-fsd-execute-plan.js` | `test-skill-execute-plan.js` | `skillPath`, `frontmatter.name` assertion |
| `test-fsd-new-project.js` | `test-skill-new-project.js` | `skillPath` |
| `test-fsd-roadmap.js` | `test-skill-roadmap.js` | `skillPath` |

### Documentation

- `README.md` — 30+ occurrences of `/fsd-plan`, `/fsd-spec`, etc. in skill reference tables and prose
- `CLAUDE.md` — skill references in skills system section and examples

**Location:** `plugin/skills/` — all SKILL.md files; `plugin/tests/` — 8 test files; `README.md`, `CLAUDE.md` — docs

## Plan

> **Prerequisite:** Confirm with user whether `fsd-plan` → `plan` (with generic `plan`
> renamed to `workflow-plan`), or skip renaming `fsd-plan`.

1. **Resolve `plan` conflict** — rename `plugin/skills/plan/` → `plugin/skills/workflow-plan/` and update its `name: plan` → `name: workflow-plan` (if user approves recommended resolution).

2. **Rename 11 skill directories** — `mv plugin/skills/fsd-X plugin/skills/X` for all 11 (or 10 if `fsd-plan` is excluded).

3. **Update `name:` frontmatter in each renamed SKILL.md** — change `name: fsd-X` → `name: X` in every moved file.

4. **Update cross-references in SKILL.md bodies** — replace all `/fsd-spec` → `/fsd:spec`, `/fsd-plan` → `/fsd:plan`, `/fsd-new-project` → `/fsd:new-project`, etc. across all SKILL.md files. Also update descriptions that contain the skill name.

5. **Rename test files** — copy/rename 8 `test-fsd-*.js` files to `test-skill-*.js` and delete the originals (the test runner picks up `test-*.js` by glob).

6. **Update test file internals** — for each renamed test: update `skillPath` dir segment, `frontmatter.name` equality assertions, `SKILL_NAMES` arrays, and cheat-sheet heading regex patterns.

7. **Update `README.md`** — change all `/fsd-plan` etc. slash-command references to `/fsd:plan`; update skill index table names.

8. **Update `CLAUDE.md`** — update skill references in skills system section.

9. **Run the full test suite** — `bash plugin/tests/run-tests.sh`. All tests must pass.

10. **CHANGELOG entry + version bump** — MINOR bump (11 skill renames are user-visible; addressing convention is the public API). Update `plugin/.claude-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md` version header, `CHANGELOG.md`.

## Acceptance Criteria

All criteria verified 2026-04-25 before commit.

- [x] All `fsd-X` skill directories renamed to `X` under `plugin/skills/` (10 or 11 depending on `plan` conflict resolution).
- [x] If recommended: generic `plan` skill renamed to `workflow-plan` (directory + frontmatter).
- [x] Each renamed SKILL.md has `name:` frontmatter matching its new directory name.
- [x] No remaining `/fsd-plan`, `/fsd-spec`, `/fsd-new-project` etc. slash-style references in any SKILL.md body (all updated to `/fsd:plan`, `/fsd:spec`, `/fsd:new-project` etc.).
- [x] 8 renamed test files exist as `test-skill-*.js`; old `test-fsd-*.js` files deleted.
- [x] Each renamed test file passes (`node plugin/tests/test-skill-X.js` exits 0).
- [x] `bash plugin/tests/run-tests.sh` reports 0 failures.
- [x] `README.md` skill table and prose use new skill names with `fsd:` prefix in slash-command references.
- [x] `CHANGELOG.md` has a new entry under the bumped version number.
- [x] All five version sources (`plugin/.claude-plugin/plugin.json`, root `.claude-plugin/plugin.json`, root `.claude-plugin/marketplace.json`, `README.md` header, `CHANGELOG.md`) show the same bumped version.
