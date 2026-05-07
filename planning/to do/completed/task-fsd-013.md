# FSD-013 — Extend `.fsd/` structure with `spec/`, `plan/`, `research/` storage kinds

## Source
User request during the FSD-003 wrap-up session. Logical continuation of the FSD-003 work (which locked the groundwork by deferring "add new content kinds" per decision #3) and sets up FSD-006 / FSD-008 / FSD-010 (the upcoming `fsd-spec`, `fsd-plan`, `fsd-research` skills, which will read/write under these dirs).

## Summary
Add three new subdirectories — `spec/`, `plan/`, `research/` — to the set of `.fsd/` structure kinds the framework manages. Distinguish them from existing kinds: they are **storage** (artifacts produced by skills) rather than **scannable** (activatable content). The loader does **not** scan them. But init scaffolds them, the `structure:` config can rename them, and `/fsd-restructure` handles renames safely.

## Assessment

### Current state (after FSD-003)
- `STRUCTURE_KEYS = ['skills', 'agents', 'commands']` in `plugin/scripts/validator.js`
- `DEFAULT_STRUCTURE = { skills, agents, commands }` in `plugin/scripts/config.js`
- `CONFIG_TEMPLATE` in `init.js` has a commented `structure:` section listing the same 3
- `init.js` loops over `getStructure(config)` keys → scaffolds 3 dirs
- `loader.js` has 3 named `scan*` functions, explicitly named in `loadContent`
- `add.js` routes content for the 3 kinds
- `restructure.js` handles renames for all kinds in `STRUCTURE_KEYS`
- Validator rejects unknown kinds per `STRUCTURE_KEYS` allowlist

### Two classes of kinds after this change

| Class | Kinds | Loader scans? | `/fsd:add` supports? | `/fsd-restructure` supports? | Created by `/fsd:init`? |
|---|---|---|---|---|---|
| **Scannable** | `skills`, `agents`, `commands` | ✅ | ✅ | ✅ | ✅ |
| **Storage** | `spec`, `plan`, `research` | ❌ | ❌ (owned by future skills) | ✅ | ✅ |

The framework treats both classes uniformly for structure/config/rename purposes; the distinction only matters for loading and authoring flows.

## Decisions locked in this plan

1. **Storage kinds are NOT scanned by the loader.** Artifact files under these dirs are time-series / task-keyed, not name-keyed single-item content. The future `fsd-spec`/`fsd-plan`/`fsd-research` skills will read/write them directly.
2. **`/fsd:add` does NOT support storage kinds.** Authoring goes through the future skills. Attempts to `add spec foo` should error with a clear message.
3. **`/fsd-restructure` DOES support renaming storage kinds.** Renames work identically — physical rename + config rewrite + stale-reference flagging. Existing tests cover this once `STRUCTURE_KEYS` is extended.
4. **`init.js` scaffolds all 6 dirs** (3 scannable + 3 storage). Each storage dir gets a `.gitkeep` marker so git tracks it after scaffold (unlike the existing scannable dirs which are tracked once content is added).
5. **Internal architecture:** split `STRUCTURE_KEYS` into two constants — `SCANNABLE_KINDS` and `STORAGE_KINDS`. The union stays as `STRUCTURE_KEYS`. This keeps future callers from accidentally scanning storage dirs.
6. **Version bump:** 0.3.0 → 0.4.0 (minor). New config keys are additive and backward-compatible per the bump rules in CHANGELOG — existing installs without `spec`/`plan`/`research` in `structure:` keep working with defaults.

## Plan

**Phase A — Introduce the storage-kind distinction and extend constants**

1. **`plugin/scripts/validator.js`** — split `STRUCTURE_KEYS` into:
   ```js
   const SCANNABLE_KINDS = ['skills', 'agents', 'commands'];
   const STORAGE_KINDS = ['spec', 'plan', 'research'];
   const STRUCTURE_KEYS = [...SCANNABLE_KINDS, ...STORAGE_KINDS];
   ```
   Keep `validateStructure` using `STRUCTURE_KEYS` (accepts all 6). Export `SCANNABLE_KINDS` and `STORAGE_KINDS` for other modules.

2. **`plugin/scripts/config.js`** — extend `DEFAULT_STRUCTURE`:
   ```js
   const DEFAULT_STRUCTURE = Object.freeze({
     skills: 'skills', agents: 'agents', commands: 'commands',
     spec: 'spec', plan: 'plan', research: 'research',
   });
   ```
   No other changes — `getStructure` already iterates keys generically.

3. **`plugin/scripts/init.js`**:
   - Already iterates `Object.keys(structure)` for `mkdirSync` — automatically scaffolds all 6 once DEFAULT_STRUCTURE is extended.
   - Add `.gitkeep` to each storage dir after scaffold (so empty dirs are committable).
   - Update `CONFIG_TEMPLATE` to document all 6 with commented defaults, grouped by class:
     ```yaml
     structure:
       # Scannable kinds (loaded and activated by the framework):
       # skills: skills
       # agents: agents
       # commands: commands
       # Storage kinds (artifacts written by /fsd-spec, /fsd-plan, /fsd-research):
       # spec: spec
       # plan: plan
       # research: research
     ```

4. **`plugin/scripts/add.js`** — guard against storage kinds explicitly:
   ```js
   if (STORAGE_KINDS.includes(type)) {
     return { success: false, message: `${type} content is managed by the /fsd-${type} skill, not /fsd:add` };
   }
   ```
   Keep `VALID_TYPES = ['skill', 'agent', 'command']` unchanged (singular forms used by `/fsd:add` type argument). Alternatively add guard using plural `STORAGE_KINDS` match after normalization.

5. **`plugin/scripts/loader.js`** — **no change.** `loadContent` explicitly names `skills`, `agents`, `commands` — it does not iterate `STRUCTURE_KEYS`. Storage kinds stay invisible to the loader by design.

6. **`plugin/scripts/restructure.js`** — no code changes required. It already iterates `STRUCTURE_KEYS` for rename ops and uses `validateStructure` for input validation. Extending the constants propagates automatically. Verify via tests.

**Phase B — Tests**

7. **`test-validator.js`**: add tests asserting `structure: { spec: 'whiteboard' }` (and same for plan/research) is valid; unknown kinds still rejected; aliases across scannable/storage still rejected.
8. **`test-config.js`**: `getStructure({})` now returns all 6 defaults; partial overrides for storage kinds work identically.
9. **`test-init.js`**: init creates all 6 subdirs; each storage dir contains `.gitkeep`; CONFIG_TEMPLATE mentions `spec:`, `plan:`, `research:`.
10. **`test-add.js`**: `addContent({ type: 'spec', ... })` is rejected with an informative message pointing to the owning skill.
11. **`test-restructure.js`**: rename `spec` → `specifications` works end-to-end (physical dir + config).
12. **`test-loader.js`**: asserts the loader **does not** scan `spec/`, `plan/`, `research/` — a fake `spec/SKILL.md` under a fixture should not show up in `loadContent` output (defensive test against future drift).

**Phase C — Docs & release**

13. **`README.md`** — extend the Configuration section's `structure:` example to include `spec`, `plan`, `research` (commented), with a note that they're storage kinds for artifacts produced by future skills.
14. **`plugin/commands/init.md`** — list all 6 scaffolded subdirectories, grouped by class.
15. **`plugin/skills/fsd-restructure/SKILL.md`** — update the skill body to note that all 6 kinds are valid rename targets (currently says "Only support the 3 known kinds"). Sync to `~/.claude/skills/fsd-restructure/`.
16. **`CHANGELOG.md`** — add `[0.4.0] - <today>` entry under Added / Changed / Compatibility.
17. **`plugin/.claude-plugin/plugin.json`** — bump version to `0.4.0`.
18. **`README.md`** — update the version header from `0.3.0` to `0.4.0` with the new release date.

**Phase D — Commit & push**

19. Three logical commits:
    - `refactor: introduce SCANNABLE_KINDS / STORAGE_KINDS split in validator + config`
    - `feat: scaffold spec/, plan/, research/ on init; guard /fsd:add against storage kinds`
    - `chore(release): v0.4.0 — spec/plan/research storage kinds + docs`
20. Push to `origin/main`.

## Acceptance Criteria

- [x] `SCANNABLE_KINDS` and `STORAGE_KINDS` exported from `validator.js`; `STRUCTURE_KEYS` = their union. Verified by new validator test 32 (disjointness + union coverage).
- [x] `DEFAULT_STRUCTURE` contains all 6 keys mapping to their default dir names (`config.js:9-16`).
- [x] `/fsd:init` on a fresh project creates 6 subdirs under `.fsd/` (skills, agents, commands, spec, plan, research). Storage dirs contain `.gitkeep`. Verified by smoke test + new init tests 8-12.
- [x] `CONFIG_TEMPLATE` written by init documents all 6 with commented defaults, grouped by class. Verified in smoke test output + new init test 11.
- [x] `/fsd-restructure` applies `spec=specifications` cleanly: dir + `.gitkeep` rename, config updated. Verified in smoke test + new restructure tests 17-19.
- [x] `/fsd:add spec foo` returns `"spec content is managed by the /fsd-spec skill, not /fsd:add"` and creates no directory. Verified in smoke test + new add test 12.
- [x] Loader never returns content from `spec/`, `plan/`, `research/` — a SKILL.md file inside any of them is ignored. Verified by new defensive loader test 11.
- [x] Fresh `/fsd:init` produces the 6-dir layout directly — no migration logic or `--create-missing` flag (no existing v0.3.0 deployments).
- [x] All 9 test files green. +13 tests added (validator: 4, init: 5, add: 1 [loop over 3 kinds], restructure: 3, loader: 1).
- [x] `CHANGELOG.md` has a `[0.4.0]` entry with Added/Changed/Compatibility sections; `README.md` header reads `Version 0.4.0`; `plugin.json` version is `0.4.0`.

## Migration / backward compatibility

None needed. User confirmed no v0.3.0 deployments exist in the wild, so there are no existing `.fsd/` installs to migrate. Fresh `/fsd:init` produces the 6-dir layout directly; no `--create-missing` flag or silent-migration logic is in scope.

## Relationship to other tasks
- **Unblocks FSD-006** (`fsd-spec`), **FSD-008** (`fsd-plan`), **FSD-010** (`fsd-research`) — those skills now have defined homes under `.fsd/`.
- **Informs FSD-004** (metadata schema for project files) — the schema now has three more content kinds to describe.
- **Compatible with FSD-003** — reuses `structure:` config, `getStructure`, `validateStructure`, and `/fsd-restructure` without regressions.
