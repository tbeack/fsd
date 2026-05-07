# FSD-004 — Metadata schema for storage-kind artifacts (`.fsd/spec/`, `.fsd/plan/`, `.fsd/research/`)

## Source
Original backlog item. Natural follow-on to FSD-013: now that `.fsd/spec/`, `.fsd/plan/`, and `.fsd/research/` exist as homes for artifacts, we need a consistent frontmatter schema so the framework can validate them and so future `fsd-spec` / `fsd-plan` / `fsd-research` skills (FSD-006 / 008 / 010) have a contract to author against.

## Summary

Define per-storage-kind YAML frontmatter schemas for `.fsd/spec/*.md`, `.fsd/plan/*.md`, `.fsd/research/*.md`. Add `validateSpec` / `validatePlan` / `validateResearch` to `plugin/scripts/validator.js`. Extend `/fsd:validate` with an `--artifacts` filter (plus `--specs` / `--plans` / `--research` for per-kind) that scans the storage dirs on demand and reports schema violations. Validation is **on-demand** — the session-start loader stays unchanged; artifacts are not activated, only indexed when explicitly requested.

**Out of scope for this task** (flagged for follow-up):
- Cross-artifact reference resolution (whether `plan.depends_on` points at a real plan) — validator enforces *format* only; existence checking deferred
- An index file or auto-generated TOC
- The authoring skills themselves (FSD-006 / 008 / 010)
- Adding `roadmap` as a 4th storage kind (see open questions)

## Assessment

**Current state:**
- `.fsd/spec/`, `.fsd/plan/`, `.fsd/research/` exist and each contains `.gitkeep` (FSD-013)
- Zero schema enforcement for artifact files — anything can land in those dirs
- `validator.js` has schemas for skill/agent/command frontmatter (`validateSkill`, `validateAgent`, `validateCommand`) but no artifact validators
- `/fsd:validate` supports `--skills` / `--agents` / `--commands` filters but has no artifact surface
- `loader.js` explicitly does not scan storage kinds (defensive test in place since FSD-013)

**What needs to exist:**
- Per-kind frontmatter schemas
- Validator functions matching the existing `validateSkill`-style shape (returns `{valid, errors, warnings}`)
- An on-demand scanner that reads artifact files and runs the validators
- CLI surface via `/fsd:validate --artifacts`
- Docs so humans know what fields their spec/plan/research files should have

**Deliberately not needed:**
- A runtime activation mechanism — artifacts are passive data, consumed by the owning skills, not loaded into session context

## Schema design

### Common fields (all three kinds)

**Required:**
- `project` — project/product name this artifact belongs to. Free-form non-empty string (preserves case and whitespace — project names are human identifiers like `"Acme Platform"` or `"payments-api"`, not slugs). Scoping label for artifacts; useful in monorepos and for future cross-project aggregation.
- `id` — unique within the kind, kebab-case, **must match the filename stem** (e.g., `id: auth-v2` → `.fsd/spec/auth-v2.md`). Mismatch is a hard error.
- `title` — free-form human-readable title, non-empty string
- `status` — enum: `draft` | `active` | `archived`
- `created` — ISO 8601 date (`YYYY-MM-DD`)

**Optional:**
- `updated` — ISO 8601 date
- `tags` — array of kebab-case strings
- `related` — array of cross-references in the form `<kind>/<id>` where `<kind> ∈ STORAGE_KINDS` (e.g., `plan/auth-v2-migration`)

### Kind-specific fields

**`spec` (optional):**
- `approved` — boolean
- `supersedes` — array of spec `id` strings (no kind prefix; own kind implied)

**`plan` (optional):**
- `task` — string, typically an FSD-NNN reference or external task ID
- `depends_on` — array of plan `id` strings
- `estimate` — string (free-form human estimate)

**`research` (optional):**
- `sources` — array of URL strings
- `conclusion` — string (short one-paragraph answer)

## Plan

**Phase A — Validator functions**

1. Extend `plugin/scripts/validator.js`:
   - Export `ARTIFACT_STATUSES = ['draft', 'active', 'archived']`
   - Add internal helper `validateArtifactCommon(meta)` that returns `{errors, warnings}` for the common required + optional fields
   - Add `validateSpec(meta)`, `validatePlan(meta)`, `validateResearch(meta)` — each calls `validateArtifactCommon` then adds kind-specific checks
   - Regex constants: `KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/`, `ISO_DATE = /^\d{4}-\d{2}-\d{2}$/`, `CROSS_REF = /^(spec|plan|research)\/[a-z0-9-]+$/`
   - Each validator's signature mirrors the existing ones: `(meta) => { valid, errors, warnings }`
   - Export new functions plus the regex constants for reuse in tests

2. Validator rules (full list):
   - `project` — required, non-empty string (no format constraint beyond non-empty; preserves human casing)
   - `id` — required, non-empty, matches `KEBAB_CASE`
   - `title` — required, non-empty string
   - `status` — required, must be in `ARTIFACT_STATUSES`
   - `created` — required, matches `ISO_DATE`
   - `updated` — if present, matches `ISO_DATE`
   - `tags` — if present, array of strings each matching `KEBAB_CASE`
   - `related` — if present, array of strings each matching `CROSS_REF`
   - `spec.approved` — if present, boolean
   - `spec.supersedes` — if present, array of strings each matching `KEBAB_CASE`
   - `plan.task` — if present, non-empty string (format free)
   - `plan.depends_on` — if present, array of strings each matching `KEBAB_CASE`
   - `plan.estimate` — if present, non-empty string
   - `research.sources` — if present, array of URL-shaped strings (starts with `http://` or `https://`)
   - `research.conclusion` — if present, non-empty string

**Phase B — On-demand artifact scanner**

3. Add `scanArtifacts({ fsdDir, kind, dirName })` to `plugin/scripts/loader.js`:
   - Reads `fsdDir/dirName/*.md`, skipping `.gitkeep` and any non-`.md` files
   - For each file: extract frontmatter, run the matching `validate{Spec|Plan|Research}`, compare filename stem to `meta.id`
   - Returns `[{ id, title, status, kind, path, validation }, ...]`
   - If `meta.id` doesn't match the filename stem, adds a validation error (hard failure)
   - Does **not** participate in `loadContent` — used only by `validate.js`

4. Export `scanArtifacts` from `loader.js`.

**Phase C — `/fsd:validate --artifacts` extension**

5. Extend `plugin/scripts/validate.js`:
   - Parse new filters: `--artifacts` (all three kinds), `--specs`, `--plans`, `--research`
   - For each requested kind, call `scanArtifacts({ fsdDir: paths.projectPath, kind, dirName: structure[kind] })`
   - Render section per kind identical in style to existing SKILLS/AGENTS/COMMANDS sections
   - Roll up artifact counts into the existing `Summary:` line (separate totals or combined — pick combined for symmetry)
   - `--artifacts` without any narrower filter: show all three. A single narrow filter (e.g., `--specs`): show only that kind.

6. Extend `plugin/commands/validate.md` to document the new flags.

**Phase D — Tests**

7. New test file `plugin/tests/test-artifact-validator.js`:
   - Valid minimal artifact for each kind passes
   - Valid full artifact for each kind passes (all optional fields)
   - Missing `id` / `title` / `status` / `created` each rejected
   - Invalid `status` rejected with message listing valid values
   - Bad-format `created` / `updated` rejected
   - Non-kebab-case `id` rejected with clear message
   - `tags` with non-kebab-case items rejected
   - `related` with malformed cross-ref rejected (missing kind prefix, unknown kind, bad id)
   - Kind-specific: `spec.approved` non-bool rejected; `spec.supersedes` with bad id rejected; `plan.depends_on` bad id rejected; `research.sources` non-URL rejected; `research.conclusion` empty rejected (if present)

8. Extend `plugin/tests/test-loader.js`:
   - `scanArtifacts` returns empty array when the dir has only `.gitkeep`
   - Finds `.md` files, skips `.gitkeep`
   - Returns validation info per file
   - Detects `id`-vs-filename mismatch as an error
   - Does NOT affect `loadContent` output (defensive regression)

9. Integration test (inline in `test-artifact-validator.js` or a new `test-validate-artifacts.js`):
   - Init a fixture project, write a valid and an invalid artifact to each kind, invoke `validate.js` with `--artifacts`, assert output contains expected ok/err lines and exit code reflects invalid count.

**Phase E — Docs + release**

10. `README.md`:
    - New subsection **Artifact Schemas** under "Content Schemas" with example frontmatter for spec, plan, research
    - Mention the `/fsd:validate --artifacts` command in the Commands section

11. `plugin/commands/validate.md` — document the new filters.

12. `plugin/commands/init.md` — add a one-line pointer to the artifact schema in the post-init explanation.

13. `CHANGELOG.md` — `[0.5.0]` entry under Added (validators, scanner, CLI filter) and Changed (validate output format).

14. `plugin/.claude-plugin/plugin.json` — version bump 0.4.0 → 0.5.0.

15. `README.md` — update version header to `0.5.0`.

**Phase F — Commits + push**

16. Three logical commits:
    - `feat(validator): add metadata schemas for spec/plan/research artifacts`
    - `feat: /fsd:validate --artifacts with on-demand scanArtifacts`
    - `chore(release): v0.5.0 — artifact metadata schema + validate --artifacts`

17. Push to `origin/main`.

## Acceptance Criteria

All criteria verified 2026-04-23 before commit. Evidence in the verification table
below (reproducible via the `node -e` probes listed against each AC).

- [x] `validateSpec`, `validatePlan`, `validateResearch` exported from `validator.js`, each matching the `{ valid, errors, warnings }` shape of existing validators
- [x] `ARTIFACT_STATUSES` exported and enforces `draft | active | archived`
- [x] Common required fields (`project`, `id`, `title`, `status`, `created`) enforced for all three kinds; missing fields produce specific error messages
- [x] `project` is a non-empty string with no format constraint (preserves human casing and whitespace)
- [x] `id` must be kebab-case and match the filename stem; mismatch is a hard error (detected by `scanArtifacts`, not by the pure validator)
- [x] `created` and `updated` validated as `YYYY-MM-DD`
- [x] `tags` items validated as kebab-case
- [x] `related` items validated as `<spec|plan|research>/<kebab-id>`
- [x] Kind-specific optional fields validated (spec.approved bool; spec.supersedes ids; plan.depends_on ids; plan.task string; plan.estimate string; research.sources URL array; research.conclusion string)
- [x] `loader.js` exports `scanArtifacts({ fsdDir, kind, dirName })`; ignores `.gitkeep`; detects filename/id mismatches
- [x] `loadContent` output **unchanged** — no new `artifacts` key, session-start cost unaffected
- [x] `/fsd:validate --artifacts` shows all three kinds; `--specs` / `--plans` / `--research` narrow to one kind; exit code is non-zero if any validation errors
- [x] New test file `test-artifact-validator.js` with per-kind coverage; integration test for the CLI filter
- [x] Existing tests (10/10 files after adding the new test) continue to pass
- [x] README has an **Artifact Schemas** section with example frontmatter per kind
- [x] `plugin/commands/validate.md` documents the new `--artifacts` / `--specs` / `--plans` / `--research` flags
- [x] Version sources aligned at 0.5.0: CHANGELOG `[0.5.0]` entry, README header, `plugin.json`

## Decisions locked by user (pre-execution)

1. **`roadmap` kind** — deferred to a separate task timed with FSD-007 (`fsd-roadmap` skill).
2. **ID uniqueness** — enforced at scan time by `scanArtifacts` (not in the pure per-file validator).
3. **`project` field** — required across all three kinds. Free-form non-empty string (preserves human casing).
4. **Unknown frontmatter keys** — lenient. Validators pass unknown keys through without error (matches existing skill/agent/command behavior).
5. **Version bump** — 0.4.0 → 0.5.0 (minor).
6. **Cross-artifact references** — `/fsd:validate --artifacts` emits warnings (not errors) for dangling `related` / `supersedes` / `depends_on` references.

## Relationship to other tasks

- **Unblocks FSD-006** (`fsd-spec`), **FSD-008** (`fsd-plan`), **FSD-010** (`fsd-research`) — those skills will call the new validators before writing artifacts, and the schema is the contract they author against.
- **Extends FSD-013** (storage kinds) — gives the scaffolded dirs their semantic meaning.
- **Informs FSD-007** (`fsd-roadmap`) — if roadmap becomes a 4th kind, it'll mirror this pattern.
