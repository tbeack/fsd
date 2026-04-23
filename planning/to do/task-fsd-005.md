# FSD-005 — `fsd-new-project` skill + `/fsd:init` suggestion: capture project context as `planning/PROJECT.md` + `planning/ROADMAP.md`

## Source
Own backlog idea.

## Summary

Add the post-init "what now?" step that gathers project context interactively and writes two persistent files — `planning/PROJECT.md` (identity, scope, tech context, success metrics, anti-goals) and `planning/ROADMAP.md` (versioned milestones containing numbered phases). The files are surfaced as a one-line session-start header so every downstream skill (`spec`, `plan`, `research`, `execute`, `verify`) starts with project framing in scope. Triggered both manually (`/fsd-new-project`) and as a recommendation in the `/fsd:init` post-init message.

## Assessment

**Current state:**
- `/fsd:init` (`plugin/scripts/init.js`, `plugin/commands/init.md`) scaffolds `.fsd/{config.yaml, skills/, agents/, commands/, spec/, plan/, research/}` — and stops.
- No `PROJECT.md`, `ROADMAP.md`, or `new-project`-shaped skill/command/hook exists.
- Hook system is single-purpose: only the SessionStart loader (`plugin/hooks/hooks.json` → `plugin/hooks/scripts/session-start.sh`).
- Artifact frontmatter pattern shipped in FSD-004 (`validateSpec` / `validatePlan` / `validateResearch`, regex constants `KEBAB_CASE` / `ISO_DATE` / `CROSS_REF`) is the schema to mirror.
- Prior art for the same idea exists in GSD (`gsd-roadmapper` agent, `PROJECT.md` references in `gsd-doc-writer`, `gsd-domain-researcher`) — useful comparison input.

**What needs to exist:**
- Two new validators (`validateProject`, `validateRoadmap`) + reusable loader helper.
- An interactive skill (`/fsd-new-project`) that gathers context one question at a time, writes both files, refuses to overwrite.
- A post-init recommendation (no auto-execution — user opts in).
- Session-start integration that surfaces a single-line project header when both files are present and valid; full bodies are read on demand by downstream skills (cost-conscious by default).

**Locked decisions (gathered during plan-mode interview):**
- **Trigger model:** **both** — manual `/fsd-new-project` skill *plus* a recommendation in the `/fsd:init` post-init message. No auto-execution; user always opts in.
- **File locations:** `planning/PROJECT.md` and `planning/ROADMAP.md` (groups with the existing `planning/to do/` convention).
- **PROJECT.md fields:** Identity / Scope / Tech context / Success metrics / Anti-goals. Field set is intentionally additive — extra sections allowed later.
- **ROADMAP.md shape:** frontmatter (mirroring artifact schema) + milestones (versioned, e.g. `1.0`, `1.1`) → numbered phases (`Phase 1.0.1`).
- **Downstream consumption:** loader injection at session start (option 1 from the interview). The session-start hook prints a one-line summary; full content is read on demand by skills that need deep context.

**Out of scope** (flagged for follow-up):
- A `/fsd-roadmap` authoring skill for editing the roadmap mid-project — covered by FSD-007.
- Cross-file reference resolution (whether a phase entry actually points at a real spec/plan id) — validator enforces format only, mirroring FSD-004's stance.
- Multi-project support (one PROJECT.md per repo for now).

## Plan

**Phase A — Schemas + helpers**

1. Extend `plugin/scripts/validator.js`:
   - Add `validateProject(meta)` — required: `project`, `id` (kebab-case), `title`, `status`, `created`. Optional: `updated`, `tags`, `vision` (string), `target_users` (array of strings).
   - Add `validateRoadmap(meta)` — required: `project`, `id`, `title`, `status`, `created`, `version` (semver-ish string `^\d+\.\d+(\.\d+)?$`), `current_milestone` (string id matching one milestone defined in the body via convention `## Milestone <id>`). Optional: `updated`, `tags`.
   - Reuse the FSD-004 helpers (`validateArtifactCommon`, `KEBAB_CASE`, `ISO_DATE`) — refactor minimally; do not duplicate logic.
   - Add `SEMVER_LIKE` regex constant.
   - Export both validators plus the new regex constant.

2. Add `loadProjectContext({ planningDir })` to `plugin/scripts/loader.js` (or a new sibling `project-context.js` if loader.js gets too crowded — judgment call at write time).
   - Returns `{ project: { meta, body, path } | null, roadmap: { meta, body, path } | null, validation: { project, roadmap } }`.
   - Both files independently optional. No throw on absence.
   - Body is the markdown after the frontmatter (same `extractFrontmatter` helper).

**Phase B — `fsd-new-project` skill**

3. Create `plugin/skills/fsd-new-project/SKILL.md`. Mirror the structure of `fsd-add-task` and the new `fsd-do-task` (one question at a time, judgment-friendly, guardrails section). Sections to ask:
   - **PROJECT.md questions** (one at a time): name + one-line vision → target users → scope (in/out) → tech context (language, framework, key constraints) → success metrics → anti-goals.
   - **ROADMAP.md questions:** initial milestone (id, version, name, goal in 1–2 sentences) → at least one phase under it (number, title, one-paragraph goal). User can request "fill in more later" to stop after the first milestone+phase.

4. Skill writes both files with the agreed frontmatter + section structure. Hard refuse to overwrite if either file already exists (suggest editing manually or running `/fsd-do-task`-style follow-on tasks instead).

5. Skill announces the next-step pointers: `/fsd:validate` to confirm schemas pass, and (when those skills land) `/fsd-spec` to start the first spec.

**Phase C — Init suggestion**

6. Update `plugin/commands/init.md` post-init explainer: after listing the scaffolded dirs, append a recommendation block calling out `/fsd-new-project` as the natural next step, with a one-sentence rationale ("captures the project's vision and roadmap so every downstream skill starts with shared context").

7. Optional: extend `plugin/scripts/init.js`'s success message to print the same suggestion line. Skip if it requires significant restructuring of the CLI output — the command-file message is the primary surface.

**Phase D — Loader + session-start integration**

8. Extend `plugin/scripts/loader.js` `loadContent` (or expose a new sibling export — judgment call) to also surface `projectContext` in its return shape:
   - `{ skills, agents, commands, validationSummary, projectContext }`
   - `projectContext` is the result of `loadProjectContext({ planningDir: path.join(projectPath, '..', 'planning') })` — i.e., relative to the repo root, not `.fsd/`.

9. Extend `plugin/hooks/scripts/session-start.sh` (and the JS formatter it calls, `session-start-loader.js`) to print a one-line `Project: <name> — Milestone: <current> (v<version>)` header when both files are present **and** validation passes. Header omitted entirely when either file is absent or invalid (no scary errors at session start; `/fsd:validate` is the place for that).

**Phase E — Tests + docs + release**

10. New `plugin/tests/test-project-context.js`:
    - Validator coverage: valid minimal/full project + roadmap, each missing required field rejected, bad semver rejected, missing `current_milestone` rejected, lenient unknown keys.
    - `loadProjectContext` coverage: both absent → both `null`; one present, one absent → mixed result; both present and valid → meta + body parsed; both present, one invalid → validation surfaced but no throw.

11. Lightly extend `plugin/tests/test-init.js` to assert the post-init message string (returned by `init.js` or read from `init.md`) mentions `/fsd-new-project`.

12. New `plugin/tests/test-fsd-new-project.js` (integration): run the skill against a fixture directory, assert both files written with valid frontmatter, refuse-to-overwrite path returns the expected message.

13. Docs:
    - **README.md** — new "Project Context" section under "Content Schemas" with example PROJECT.md + ROADMAP.md frontmatter + a worked example. Update Commands section to mention `/fsd-new-project`.
    - **CHANGELOG.md** — `[0.6.0]` entry under Added (validators, helper, skill, init suggestion, session-start header, tests) and Changed (loader return shape, session-start hook output).
    - **plugin/.claude-plugin/plugin.json** — version bump 0.5.0 → 0.6.0.
    - **README.md** — version header + release date bump.

14. Three logical commits, mirroring the FSD-004 pattern:
    - `feat(validator): add PROJECT.md / ROADMAP.md frontmatter schemas`
    - `feat: /fsd-new-project skill + session-start project header + init suggestion`
    - `chore(release): v0.6.0 — project context (PROJECT.md + ROADMAP.md)`

15. Push to `origin/main`.

## Acceptance Criteria

- [ ] `validateProject` and `validateRoadmap` exported from `validator.js`, each matching `{ valid, errors, warnings }` shape
- [ ] Required frontmatter enforced for both: `project`, `id` (kebab-case), `title`, `status`, `created`. Roadmap additionally requires `version` (semver-like) and `current_milestone`.
- [ ] `loadProjectContext({ planningDir })` returns `{ project, roadmap, validation }` with `null` for absent files; never throws on missing files
- [ ] `/fsd-new-project` skill exists at `plugin/skills/fsd-new-project/SKILL.md`, passes `/fsd:validate --skills`, and asks PROJECT + ROADMAP sections one at a time
- [ ] Skill writes `planning/PROJECT.md` and `planning/ROADMAP.md` with valid frontmatter; refuses to overwrite if either file already exists
- [ ] `/fsd:init` post-init message (in `plugin/commands/init.md`) mentions `/fsd-new-project` as the recommended next step
- [ ] Session-start output includes a one-line `Project: <name> — Milestone: <current> (v<version>)` header when both files are present and valid; absent when either file is missing or invalid
- [ ] `loadContent` return shape is additively extended: `projectContext` field present; existing fields (`skills`, `agents`, `commands`, `validationSummary`) unchanged
- [ ] No regression: full test suite stays green (≥12 test files passing); existing session-start output unchanged when PROJECT.md / ROADMAP.md are absent
- [ ] New `test-project-context.js` covers validators, loader helper, and refuse-to-overwrite path; integration test for `/fsd-new-project` exists
- [ ] README has a "Project Context" section with example frontmatter for both files; Commands section mentions `/fsd-new-project`
- [ ] Version sources aligned at 0.6.0: CHANGELOG `[0.6.0]` entry, README header, `plugin.json`

## Decisions locked by user (pre-execution)

1. **Trigger model** — both manual skill *and* `/fsd:init` post-init recommendation; no auto-execution.
2. **File locations** — `planning/PROJECT.md` and `planning/ROADMAP.md` (matches existing `planning/to do/` convention).
3. **PROJECT.md fields** — Identity, Scope, Tech context, Success metrics, Anti-goals. Additive.
4. **ROADMAP.md shape** — frontmatter mirroring artifact schema + milestones (versioned) → numbered phases.
5. **Downstream consumption** — loader injection at session start (one-line summary header); full bodies read on demand by skills.
6. **Version bump** — 0.5.0 → 0.6.0 (minor, additive).

## Relationship to other tasks

- **Unblocks the workflow phase skills (FSD-006 / 008 / 010 / 011)** — gives spec/plan/research/ship a stable project-context surface to read from instead of inferring from scratch each time.
- **Pairs with FSD-007 (`fsd-roadmap`)** — that skill will edit `planning/ROADMAP.md` mid-project (add milestones / phases / mark complete). This task creates the file; FSD-007 maintains it.
- **Extends FSD-004's pattern** — reuses `validateArtifactCommon` style, frontmatter conventions, and the on-demand-vs-session-start cost discipline.
