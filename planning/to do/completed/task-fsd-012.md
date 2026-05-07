# FSD-012 — Change directory naming convention from `/docs/plans` to `/planning`

## Source
Own idea / convention refactor — shorter top-level name, signals the directory's purpose without being nested under `docs/`.

## Summary
Move all planning artifacts out of `docs/plans/` into a top-level `planning/` directory, and update every reference in the repo and in the installed FSD plugin so tools keep working after the move.

## Assessment

**Current state** (as of FSD-012 being written):

Planning content lives at `docs/plans/`:
- `docs/plans/todo.md` — this task tracker
- `docs/plans/task-fsd-012.md` — this file (will move with its parent)
- `docs/plans/2026-03-02-fsd-framework-design.md`
- `docs/plans/2026-03-02-fsd-implementation-plan.md`
- `docs/plans/2026-03-26-fsd-v02-implementation-plan.md`

`docs/` has no other content — only `docs/plans/` and a `.DS_Store`.

**References to `docs/plans` that must be rewritten** (scope found via `grep -rn "docs/plans"`):

1. `README.md:344` — `See \`docs/plans/2026-03-02-fsd-framework-design.md\` …`
2. `docs/plans/2026-03-26-fsd-v02-implementation-plan.md:7` — `**Architecture reference:** \`docs/plans/2026-03-02-fsd-framework-design.md\` …`
3. `plugin/skills/fsd-add-task/SKILL.md` — 10 occurrences: frontmatter `description`, mode descriptions, steps 1/3/5/6, Conventions, Guardrails.
4. `~/.claude/skills/fsd-add-task/SKILL.md` — mirror of the plugin copy, must be re-synced after (3).

**Relative links inside `todo.md`** — line 6 currently points to `../../ignore/issues/2026-03-27_0001.md` (i.e. repo root `ignore/issues/`). From `docs/plans/` that's two `..` hops; from `planning/` it's one. The link must become `../ignore/issues/2026-03-27_0001.md`.

**Decision:** After the move, `docs/` will contain only `.DS_Store`. Delete the empty `docs/` directory — it can be recreated any time if non-planning docs are added later.

## Plan

Sequential — do not reorder. Each step is atomic and verifiable.

1. **Create `planning/` at repo root.**
   - `mkdir planning`

2. **Move files with `git mv` (preserves history).**
   - `git mv docs/plans/todo.md planning/todo.md`
   - `git mv docs/plans/task-fsd-012.md planning/task-fsd-012.md`
   - `git mv docs/plans/2026-03-02-fsd-framework-design.md planning/2026-03-02-fsd-framework-design.md`
   - `git mv docs/plans/2026-03-02-fsd-implementation-plan.md planning/2026-03-02-fsd-implementation-plan.md`
   - `git mv docs/plans/2026-03-26-fsd-v02-implementation-plan.md planning/2026-03-26-fsd-v02-implementation-plan.md`

3. **Fix the relative link in `planning/todo.md`.**
   - `planning/todo.md:6` — change `(../../ignore/issues/2026-03-27_0001.md)` → `(../ignore/issues/2026-03-27_0001.md)`.

4. **Fix the cross-reference inside `planning/2026-03-26-fsd-v02-implementation-plan.md`.**
   - Line 7 — change `\`docs/plans/2026-03-02-fsd-framework-design.md\`` → `\`planning/2026-03-02-fsd-framework-design.md\``.

5. **Fix `README.md:344`.**
   - Change `\`docs/plans/2026-03-02-fsd-framework-design.md\`` → `\`planning/2026-03-02-fsd-framework-design.md\``.

6. **Update `plugin/skills/fsd-add-task/SKILL.md` — replace all `docs/plans/` with `planning/`.**
   - Verify with `grep -n "docs/plans" plugin/skills/fsd-add-task/SKILL.md` → must return zero matches.

7. **Sync to the installed/global copy.**
   - `cp plugin/skills/fsd-add-task/SKILL.md ~/.claude/skills/fsd-add-task/SKILL.md`
   - `diff plugin/skills/fsd-add-task/SKILL.md ~/.claude/skills/fsd-add-task/SKILL.md` → empty output.

8. **Delete the now-empty `docs/` directory.**
   - `rm docs/.DS_Store && rmdir docs`

9. **Repo-wide verification.**
   - `grep -rn "docs/plans" --exclude-dir=node_modules --exclude-dir=ignore --exclude-dir=.git` → must return zero matches (ignoring this task file's own historical context section, which stays as-is).
   - `ls planning/` — confirms all 5 files present.

10. **Commit.**
    - Single atomic commit: `refactor: rename docs/plans/ → planning/ and update all references` (or split file-move from reference-update commits if preferred — move commit first preserves cleaner history).

## Acceptance Criteria

*Note: a follow-up request during execution moved `todo.md` and task files one level deeper into `planning/to do/`. Paths below reflect that final layout; all original criteria satisfied in spirit.*

- [x] All 5 files exist outside `docs/plans/` — 3 design docs in `planning/`, `todo.md` + `task-fsd-012.md` in `planning/to do/`.
- [x] Rename lineage preserved: `git status` shows `RM docs/plans/todo.md -> planning/to do/todo.md` (git-tracked rename). `git log --follow` will resolve post-commit; pre-move commit `17e3a34` is reachable.
- [x] `grep -rn "docs/plans"` returns only one non-historical match — the title of `FSD-012` in `planning/to do/todo.md:16`, which is semantic content naming this refactor, not a live path reference.
- [x] Relative link in `planning/to do/todo.md:6` resolves to `/…/fsd/ignore/issues/2026-03-27_0001.md` (verified via `realpath`; file exists). Path is `../../ignore/issues/2026-03-27_0001.md` (two `..` hops because of the `to do/` subdirectory).
- [x] `/fsd-add-task` skill description in the tool registry now reads "… at planning/to do/todo.md" (confirmed via session skill list); skill body references `planning/to do/todo.md` 6×, `planning/to do/task-fsd-NNN.md` 4×. Functional invocation deferred to next session.
- [x] `~/.claude/skills/fsd-add-task/SKILL.md` is byte-identical to `plugin/skills/fsd-add-task/SKILL.md` (`diff` returns empty).
- [x] README target `planning/2026-03-02-fsd-framework-design.md` exists locally. GitHub render not verified (requires push).
- [x] `docs/` directory no longer exists at repo root.

## Notes for future skills
Skills `FSD-006` through `FSD-011` (`fsd-spec`, `fsd-roadmap`, `fsd-plan`, `fsd-execute-plan`, `fsd-research`, `fsd-ship`) will likely also need to read/write under `planning/`. Land FSD-012 before those so the new skills bake in the new path from day one rather than needing a follow-up refactor.
