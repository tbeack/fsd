# FSD-003 — Config-driven project directory structure + `/fsd-restructure` skill

## Source
Own idea. Grew out of the observation that directory structure is duplicated in 4 places (`init.js`, `init.md`, `README.md`, framework design doc) and is currently hardcoded in every script that touches the filesystem. User wants to be able to reshape the structure **after** install without manual surgery.

## Summary
Make the FSD project directory structure **data-driven** via a new `structure:` section in `.fsd/config.yaml`. Refactor every hardcoded path in the plugin scripts to read from config. Add a new `/fsd-restructure` skill that lets the user change structure safely — preview, confirm, physically rename directories, rewrite config, and warn about stale references.

## Assessment

### Current state (hardcoded paths)

| File | Lines | Hardcodes |
|---|---|---|
| `plugin/scripts/init.js` | 34-46 | `.fsd/`, `skills/`, `agents/`, `commands/`; CONFIG_TEMPLATE has no `structure:` key |
| `plugin/scripts/config.js` | 85-86 | `.fsd` as top-level dir name (both user `~/.fsd/` and project `.fsd/`) |
| `plugin/scripts/loader.js` | `scanSkills`/`scanAgents`/`scanCommands` | `'skills'`, `'agents'`, `'commands'` literals for each scan path |
| `plugin/scripts/add.js` | 94-98 | `skills/`, `agents/`, `commands/` literals for routing |
| `plugin/scripts/validator.js`, `validate.js` | — | Consume loader output; keyed by `skills` / `agents` / `commands` |
| `plugin/commands/init.md` | 13-16 | Human-readable description of the four paths |
| `README.md` | 13-18, 100 | User-facing scope-layer explanation |
| `planning/2026-03-02-fsd-framework-design.md` | 45, 91-135 | Design-doc trees for all four layers |

### Current `.fsd/config.yaml` schema (from `CONFIG_TEMPLATE`)
```yaml
workflow: plan-execute-verify
disabled: []
required: []
conventions: {}
```
No structure-related keys exist.

### What "cascade" means mechanically
If user renames `skills/` → `capabilities/`:
1. `config.yaml` records the new name
2. Loader, init, add, list, validate all read the new name from config
3. On-disk directory is physically renamed (if content exists)
4. User content that references the old path (inside skill/agent/command files) is **flagged**, not auto-rewritten — rewriting arbitrary user prose is out of scope

## Decisions locked in the plan

1. **Configurable surface (MVP):** rename-only for the 3 known content kinds (`skills`, `agents`, `commands`). Adding new content kinds is out of scope — deferred to future task.
2. **Top-level dir name (`.fsd/`) stays fixed.** Changing it risks breaking Claude Code plugin discovery, user-space `~/.fsd/`, and git conventions. Not worth the complexity.
3. **Cascade scope:** plugin scripts + config.yaml + CONFIG_TEMPLATE. Documentation (init.md, README.md, design doc) is updated once, manually, in Phase C. User content referencing old paths is **flagged with a warning list**, not rewritten.
4. **Backwards compatibility:** If config.yaml has no `structure:` key, loader uses the current hardcoded defaults. Existing installs keep working without re-init.
5. **Layer precedence:** `structure:` lives in all 3 config layers (core / user / project). Strategic merge rules apply (project > user > core). This matches existing config behavior.
6. **Safety:** `/fsd-restructure` refuses to proceed if (a) target dir name already exists, (b) repo has uncommitted changes touching `.fsd/` (override flag available).

## Plan

**Phase A — Make structure config-driven (refactor, no user-visible change)**

1. **Define the `structure:` schema.** Add to `plugin/scripts/validator.js`:
   ```yaml
   structure:
     skills: skills        # dir name for skills content
     agents: agents        # dir name for agents content
     commands: commands    # dir name for commands content
   ```
   Validation rules: values must be valid POSIX path segments (no `/`, no leading `.`, non-empty); all 3 keys required if `structure:` is present at all; aliases (two keys pointing to same dir) rejected.

2. **Add `getStructure(config)` helper** in `plugin/scripts/config.js`. Returns a plain `{skills, agents, commands}` object, defaulting to the current hardcoded names if config has no `structure:` key. Single chokepoint — every other script reads through this.

3. **Refactor `loader.js`.** Replace literal `'skills'` / `'agents'` / `'commands'` in `scanSkills` / `scanAgents` / `scanCommands` with values from `getStructure(config)`. The three functions already take `baseDir` — add a 3rd parameter `dirName` or have them read config internally (pick whichever is less invasive; recommendation: read config internally so call sites don't change).

4. **Refactor `add.js`.** Replace hardcoded path segments in lines 94-98 with `getStructure(config)` lookup.

5. **Refactor `init.js`.** Replace the three `fs.mkdirSync(path.join(fsdDir, '…'))` calls with a loop over `getStructure(DEFAULT_CONFIG)`. Update `CONFIG_TEMPLATE` to include the new `structure:` section (commented-out defaults).

6. **Update `list.js`, `validate.js`, `session-start-loader.js`** — search for any remaining `skills`/`agents`/`commands` literals used as path segments (not just object keys) and route through `getStructure`. The in-memory object keys (`content.skills`, etc.) stay fixed — they're API, not paths.

7. **Tests:** add to `plugin/tests/`:
   - `test-config.js` — `getStructure` returns defaults when key absent, returns custom when present, rejects invalid values
   - `test-loader.js` — loader reads from custom structure name (`capabilities/` instead of `skills/`) and still finds skills
   - `test-init.js` — init scaffolds default structure
   - `test-add.js` — add routes to custom structure dir when config specifies one

   Follow the repo's existing zero-dependency bash+node test pattern (`plugin/tests/run-tests.sh`).

8. **Commit A:** `refactor: make .fsd/ directory structure config-driven`

**Phase B — Build `/fsd-restructure` skill**

9. **Create `plugin/skills/fsd-restructure/SKILL.md`.** Workflow:
   - Read current `.fsd/config.yaml` and compute current structure (with defaults applied).
   - Show current structure to user:
     ```
     Current structure:
       .fsd/skills/    (3 items)
       .fsd/agents/    (1 item)
       .fsd/commands/  (0 items)
     ```
   - Ask what to rename. Accept either an interactive prompt per-kind, or a flag syntax `--skills=capabilities`.
   - **Preview**: show the full diff — physical rename ops, config.yaml changes, and a list of content files that mention the old dir name (grep through `.fsd/**` markdown bodies; matches are flagged, not rewritten).
   - Ask for confirmation.
   - Execute: `fs.renameSync` for each dir, rewrite config.yaml via yaml-parser serializer, print post-execution audit.
   - If config.yaml has no `structure:` section yet, write it explicitly (upgrading an implicit-default install to explicit config).

10. **Safety rules (hard-coded in skill body):**
    - Refuse if target dir already exists: "Can't rename `skills` → `capabilities`: `.fsd/capabilities/` already exists."
    - Refuse (with `--force` override) if `git status .fsd/` shows uncommitted changes.
    - Refuse reserved names: `config.yaml`, `.state.yaml`, anything starting with `.`.
    - Refuse aliases: two kinds can't point to the same dir.

11. **Register skill globally** — copy `plugin/skills/fsd-restructure/SKILL.md` → `~/.claude/skills/fsd-restructure/SKILL.md` (same install pattern used for `fsd-add-task`). Document in README.

12. **Tests:** script-level integration test that (a) init a fixture project, (b) invoke skill with a renamed structure, (c) verify on-disk renames match, config.yaml updated, loader still finds content. Pure-Node test — no need to invoke the skill through Claude; the skill body largely delegates to existing scripts plus the rename step, which can be tested directly.

13. **Commit B:** `feat(skill): add /fsd-restructure to reshape project layout`

**Phase C — Documentation sync**

14. **Update `plugin/commands/init.md`** — describe the new `structure:` section in `.fsd/config.yaml`.
15. **Update `README.md`** — add a short section under Configuration about renaming content kinds, point to `/fsd-restructure`.
16. **Add a note to `planning/2026-03-02-fsd-framework-design.md`** marking that dir names are now configurable (don't rewrite the trees — annotate with a sentence).

17. **Commit C:** `docs: document configurable directory structure and /fsd-restructure`

**Phase D — Acceptance**

18. **Manual smoke test** in a scratch dir:
    - `node plugin/scripts/init.js /tmp/fsd-test` — default structure scaffolded.
    - Add a dummy skill via `/fsd:add skill hello --project`.
    - Invoke `/fsd-restructure` to rename `skills` → `capabilities`.
    - Confirm `.fsd/capabilities/hello/SKILL.md` exists, `.fsd/skills/` is gone, `config.yaml` has `structure.skills: capabilities`.
    - `/fsd:list` — still shows the skill.
    - `/fsd:validate` — still passes.
    - Session-start hook still loads the skill (verify by restarting session in that dir).

19. **Regression check:** existing installs with no `structure:` key still work unchanged (add a separate fixture).

## Acceptance Criteria

- [x] `plugin/scripts/config.js` exports `getStructure(config)` with documented behavior and default fallback. (config.js:54-74)
- [x] No remaining literal `'skills'` / `'agents'` / `'commands'` strings used as path segments in any `plugin/scripts/` file. Audited via `grep "path\.join[^)]*'skills'"` → zero matches. Remaining occurrences are semantic (DEFAULT_STRUCTURE values, backward-compat default parameters, STRUCTURE_KEYS array).
- [x] `init.js` scaffolds subdirectories by iterating `getStructure(config)`, not hardcoded literals. (init.js:45-48)
- [x] `CONFIG_TEMPLATE` includes a commented `structure:` section with defaults shown. (init.js:14-18)
- [x] Validator rejects malformed `structure:` — aliases, slashes, leading dots, reserved names, unknown kinds, non-strings. Covered by `test-validator.js` tests 16-28.
- [x] Config with `structure: { skills: capabilities }` produces `.fsd/capabilities/` on init and is correctly scanned by the loader. Covered by `test-init.js:5` and `test-loader.js:8-10`.
- [x] `/fsd-restructure` skill exists at `plugin/skills/fsd-restructure/SKILL.md` and is byte-identical to `~/.claude/skills/fsd-restructure/SKILL.md` (`diff` empty, verified during install).
- [x] Skill refuses improper renames — target exists, reserved names, aliases enforced by `previewRestructure`. Uncommitted-changes check enforced by skill body (Step 2) with `--force` override. Covered by `test-restructure.js` tests 3-6.
- [x] Skill preview flags stale references in `.fsd/**/*.md` without rewriting. Covered by `test-restructure.js:7,16` and demonstrated in smoke test.
- [x] After `/fsd-restructure` in a fixture: physical rename + config update + `/fsd:list` and `/fsd:validate` still see content. Covered by end-to-end smoke test (verify-target skill found via `/fsd:validate` after skills→capabilities rename).
- [x] Existing installs with no `structure:` key continue to work unchanged. Covered by regression smoke test (stripped `structure:` block; legacy-skill added and listed successfully).
- [x] Docs updated: `README.md` (Configuration section with `structure:` example), `plugin/commands/init.md` (mention + link to `/fsd-restructure`), `planning/2026-03-02-fsd-framework-design.md` (annotation noting configurability).
- [x] Tests added: `test-config.js` +8 tests for `getStructure`, `test-validator.js` +13 tests for `validateStructure`, `test-loader.js` +3 for custom dir scanning, `test-init.js` +4 for structure-driven scaffolding, `test-add.js` +2 for custom dir routing, new `test-restructure.js` with 16 tests. **All 9 test files pass (was 8).**

## Decisions confirmed by user (pre-execution)

1. **Skill name:** `/fsd-restructure`.
2. **User content cascade:** flag references, don't auto-rewrite.
3. **Adding new content kinds:** out of scope here, deferred to follow-up task.
4. **Top-level `.fsd/` name:** stays fixed.

## Relationship to other tasks
- **Blocks FSD-004** (metadata schema for project files) — FSD-004's schema should include the `structure:` key defined here.
- **Should precede FSD-006 through FSD-011** (new `fsd-spec`/`fsd-roadmap`/etc. skills). Those skills will read/write under the new structure, so they should be designed against the config-driven paths from the start.
