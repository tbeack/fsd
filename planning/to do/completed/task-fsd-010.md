# FSD-010 — Create a new `fsd-research` skill

## Source

Own backlog. Sixth skill in the FSD workflow chain: `/fsd:new-project` →
`/fsd:spec` → `/fsd:plan` → `/fsd:execute-plan` → **`/fsd:research`** →
`/fsd:ship`. Completes the research-artifact authoring surface whose schema
has already been defined in `validator.js`.

## Summary

Add a `/fsd:research` skill that interviews the user one question at a time
and writes a validated research artifact to `.fsd/<structure.research>/<id>.md`.
The skill parallels `/fsd:spec` in structure: a new `research.js` backing
module owns render + validate + atomic write; the SKILL.md orchestrates the
interview and calls the module. Research artifacts capture technical
investigation, spikes, and findings with sections Question / Context / Method
/ Findings / Conclusion / Open questions. The existing `validateResearch` in
`validator.js` already defines the frontmatter schema (`sources`, `conclusion`
plus common artifact fields) — no validator changes are needed.

## Assessment

**Existing infrastructure (already in place):**

- `plugin/scripts/validator.js` exports `validateResearch(meta)` — validates
  `sources` (array of http(s) URLs, optional), `conclusion` (non-empty string,
  optional), plus `validateArtifactCommon` (project, id, kebab-case, title,
  status, created, updated, tags, related).
- `plugin/scripts/config.js` `DEFAULT_STRUCTURE` already includes
  `research: 'research'` — resolves to `.fsd/research/` by default.
- `plugin/scripts/loader.js` `scanArtifacts({ fsdDir, kind: 'research', dirName })`
  works today for listing existing research artifacts.
- `plugin/scripts/spec.js` — the direct template: `renderSpec` / `resolveSpecPath`
  / `writeSpecFile` / CLI. `research.js` mirrors this exactly.

**What does NOT yet exist:**

- `plugin/scripts/research.js` — the backing module (new).
- `plugin/skills/research/SKILL.md` — the skill (new).
- `plugin/tests/test-research.js` — module tests (new).
- `plugin/tests/test-skill-research.js` — skill SKILL.md sanity tests (new).
- README Commands section entry for `/fsd:research`.
- CHANGELOG / version bump.

**Current plugin version:** `0.14.1`. This task bumps to `0.15.0` (minor
additive — new skill + new script module, no breaking changes).

**Location of analogous module:** `plugin/scripts/spec.js` — full reference.
**Location of analogous skill:** `plugin/skills/spec/SKILL.md` — full reference.

## Plan

**Phase A — `plugin/scripts/research.js` backing module**

1. Create `plugin/scripts/research.js` mirroring `spec.js` in structure:

   - `today()` — ISO date helper (copy from spec.js).
   - `SECTION_ORDER` — `['question', 'context', 'method', 'findings', 'conclusion', 'open_questions']`.
   - `SECTION_META` — heading + placeholder for each section:

     | Key             | Heading          | Placeholder                                          |
     |-----------------|------------------|------------------------------------------------------|
     | `question`      | `Question`       | `_What is being investigated?_`                      |
     | `context`       | `Context`        | `_Why this research is needed and what prompted it._` |
     | `method`        | `Method`         | `_How the investigation was approached._`             |
     | `findings`      | `Findings`       | `_What was discovered._`                              |
     | `conclusion`    | `Conclusion`     | `_The final recommendation or answer._`              |
     | `open_questions`| `Open questions` | `_Follow-up unknowns._`                               |

   - `yamlLine(key, value)` — same as spec.js (array or scalar serializer).
   - `renderResearch(data)` — builds full file content. Extra frontmatter
     fields beyond `validateArtifactCommon`:
     - `sources` (array of URL strings) — emitted as a YAML list when set.
     - `conclusion` (string) — emitted as a scalar when set.
     Both are optional; absent fields are not emitted.
   - `resolveResearchPath({ projectPath, config, id })` — mirrors
     `resolveSpecPath`, uses `getStructure(config).research`.
   - `writeResearchFile({ projectPath, config, planningDir, researchData })` —
     mirrors `writeSpecFile` exactly:
     - Auto-inject `project:` from `planning/PROJECT.md` when absent.
     - Refuse to overwrite existing target file.
     - Validate via `validateResearch` before touching disk.
     - Atomic write (tmp + `fs.renameSync`).
     - Returns `{ ok, written?, skipped?, reason? }`.
   - CLI entry point — same arg shape as `spec.js`:
     `node scripts/research.js <projectPath> [--json=<path> | --id=... --title=... ...]`
     Extra flags: `--sources=<csv of URLs>`, `--conclusion=<string>`.
   - `module.exports` — `{ renderResearch, writeResearchFile, resolveResearchPath, today, SECTION_ORDER, SECTION_META }`.

**Phase B — `plugin/skills/research/SKILL.md` skill**

2. Create `plugin/skills/research/SKILL.md` with frontmatter:

   ```yaml
   ---
   name: fsd:research
   description: Create a new research artifact under `.fsd/<structure.research>/<id>.md`. Interviews the user one question at a time for frontmatter (id, title, status, related, tags, sources, conclusion) and six body sections (Question, Context, Method, Findings, Conclusion, Open questions). Auto-injects `project:` from `planning/PROJECT.md`. Refuses to overwrite. Create-only — editing existing research artifacts is handled by a separate skill (future).
   argument-hint: `[research title]`
   ---
   ```

3. Skill body — 6 steps mirroring `/fsd:spec`:

   **Step 1: Precondition — PROJECT.md must exist and validate**
   - Load via `loadProjectContext`. Missing → ask "run `/fsd:new-project` first?",
     chain-invoke on yes. Invalid → print errors, abort (don't chain-invoke).
   - ROADMAP.md missing is a soft warning; proceed.

   **Step 2: Gather frontmatter — one question at a time**
   - Title: use `$ARGUMENTS` if non-empty, else ask.
   - Id: derive kebab-case slug, confirm or let user override.
   - Status: `draft`/`active`/`archived`, default `draft`.
   - Related refs: comma-separated `<spec|plan|research>/<kebab-id>`, or 'none'.
   - Tags: comma-separated kebab-case, or 'none'.
   - Sources: "Source URLs? (comma-separated http(s) links, or 'none')".
     Validate each against `^https?://`. Re-prompt on a bad entry.
   - Conclusion: "One-line conclusion or recommendation? (or 'skip')".
     On 'skip', omit the field. On value, validate non-empty.
   - Do NOT ask about `project:` — auto-injected.

   **Step 3: Gather body sections — one question at a time**
   - Question, Context, Method, Findings, Conclusion, Open questions.
   - Skipped sections keep their italic placeholder.
   - Note: the "Conclusion" body section is freeform prose; the frontmatter
     `conclusion:` field is a one-line summary. Both may coexist.

   **Step 4: Preview + confirm**
   - Assemble via `renderResearch`, resolve target path via `resolveResearchPath`.
   - Print full file, ask "Write to `<path>`? (yes/no)". Abort on no.

   **Step 5: Write via the backing module**
   - Call `writeResearchFile` via `node -e` or the CLI entry point.
   - On `{ ok: false, reason }`, relay verbatim and stop.
   - Do NOT retry with an overwrite flag.

   **Step 6: Confirm + point at next step**
   - Print written path.
   - "Run `/fsd:validate --artifacts` to confirm the new research artifact
     is picked up by the scanner."
   - "Link it to a spec or plan via `related:` in the artifact's frontmatter
     to surface it in `/fsd:execute-plan`'s context."

4. Guardrails section — non-negotiable:
   - Never overwrite an existing research artifact.
   - Never ask about `project:`.
   - One question at a time — no multi-question dump.
   - Never modify `planning/PROJECT.md`, `planning/ROADMAP.md`, or
     any spec/plan artifact.
   - Never write outside `<projectPath>/<structure.research>/`.
   - Do not auto-commit or push.

**Phase C — Tests**

5. `plugin/tests/test-research.js` — ~12 tests covering:
   - `renderResearch` renders all six `##` sections with placeholders when
     `sections` is empty.
   - `renderResearch` inserts user content when sections are provided.
   - `renderResearch` emits `sources:` YAML list when set; omits when absent.
   - `renderResearch` emits `conclusion:` scalar when set; omits when absent.
   - `resolveResearchPath` returns correct path under `.fsd/research/`.
   - `writeResearchFile` happy path — creates file at expected path, returns
     `{ ok: true, written: [...] }`.
   - `writeResearchFile` auto-injects `project:` from `planning/PROJECT.md`.
   - `writeResearchFile` refuses to overwrite existing file.
   - `writeResearchFile` returns `{ ok: false }` when `projectPath` missing.
   - `writeResearchFile` returns `{ ok: false }` on invalid frontmatter.
   - CLI entry: `node research.js <projectPath> --id=... --title=...` exits 0
     and prints `{ ok: true, written: [...] }`.
   - CLI entry: invalid args exit 1 and print `{ ok: false, reason }`.

6. `plugin/tests/test-skill-research.js` — ~6 tests covering:
   - SKILL.md exists at `plugin/skills/research/SKILL.md`.
   - Frontmatter `name: fsd:research`.
   - Frontmatter `argument-hint` present.
   - Description ≥ 20 chars.
   - SKILL.md documents all 6 steps (Step 1–6 headings present).
   - SKILL.md documents sources and conclusion frontmatter prompts.
   - Guardrails section present and mentions no-overwrite.

7. Verify `plugin/tests/run-tests.sh` picks up both new files automatically
   (glob `test-*.js`).

**Phase D — Docs + release**

8. `README.md` Commands section: add `/fsd:research [title]` one-liner. Place
   it between `/fsd:execute-plan` and `/fsd:ship` (or after the current last
   command if those aren't yet documented). Cross-reference
   `/fsd:validate --artifacts`.

9. `CHANGELOG.md` new `[0.15.0] - 2026-05-06` entry:
   ```
   ### Added
   - `/fsd:research` skill — create research artifacts under `.fsd/research/<id>.md`;
     guided interview for six body sections (Question / Context / Method / Findings /
     Conclusion / Open questions) plus frontmatter `sources` (URL array) and `conclusion`
     (one-line summary); backed by a new `research.js` script module (mirrors `spec.js`).
   - `plugin/scripts/research.js` — `renderResearch`, `writeResearchFile`,
     `resolveResearchPath` exports + CLI entry point.
   ```

10. Version bump to `0.15.0` across all five required files:
    - `plugin/.claude-plugin/plugin.json` — `"version": "0.15.0"`
    - `.claude-plugin/plugin.json` (root) — `"version": "0.15.0"`
    - `.claude-plugin/marketplace.json` — `"version": "0.15.0"` inside the `plugins` array entry
    - `README.md` — `**Version 0.15.0**` header line
    - `CHANGELOG.md` — `[0.15.0]` heading (written in step 9)

All criteria verified 2026-05-06 before commit.

## Acceptance Criteria

- [x] `plugin/scripts/research.js` exists and exports `renderResearch`,
      `writeResearchFile`, `resolveResearchPath`, `today`, `SECTION_ORDER`,
      `SECTION_META`
- [x] `renderResearch` produces a file with all six `##` section headings:
      Question, Context, Method, Findings, Conclusion, Open questions
- [x] `renderResearch` emits `sources:` as a YAML list when set; omits the
      field when absent
- [x] `renderResearch` emits `conclusion:` as a scalar when set; omits the
      field when absent
- [x] `writeResearchFile` creates `.fsd/research/<id>.md` atomically (tmp + rename)
- [x] `writeResearchFile` refuses to overwrite an existing file and returns
      `{ ok: false, reason }`
- [x] `writeResearchFile` auto-injects `project:` from `planning/PROJECT.md`
      when not supplied in `researchData`
- [x] `writeResearchFile` validates via `validateResearch` before touching disk
- [x] CLI entry `node research.js <projectPath> --id=... --title=...` exits 0
      on success; exits 1 with `{ ok: false, reason }` on failure
- [x] `plugin/skills/research/SKILL.md` exists with frontmatter `name: fsd:research`,
      `argument-hint`, and description ≥ 20 chars
- [x] Skill description mentions research artifact, guided interview, and
      six body sections
- [x] Skill Step 1 documents the PROJECT.md precondition (chain-invoke on missing,
      abort on invalid)
- [x] Skill Step 2 documents the sources and conclusion frontmatter prompts
      including validation rules and 'skip' escape for conclusion
- [x] Skill Step 3 documents all six body section prompts
- [x] Skill Step 4 documents the preview + confirm flow with the write path
- [x] Skill Step 5 documents the `writeResearchFile` invocation and error relay
- [x] Skill Step 6 documents the handoff with `/fsd:validate --artifacts` pointer
- [x] Skill Guardrails section enumerates: no-overwrite, no project: prompt,
      one-question-at-a-time, no writes outside research dir, no auto-commit
- [x] `plugin/tests/test-research.js` passes with ≥ 10 test assertions
- [x] `plugin/tests/test-skill-research.js` passes with ≥ 6 test assertions
- [x] Full test suite stays green: `bash plugin/tests/run-tests.sh`
- [x] `README.md` Commands section documents `/fsd:research`
- [x] `CHANGELOG.md` has a `[0.15.0]` entry with the `/fsd:research` addition
- [x] All five version files aligned at `0.15.0`:
      `plugin/.claude-plugin/plugin.json`, `.claude-plugin/plugin.json`,
      `.claude-plugin/marketplace.json`, `README.md`, `CHANGELOG.md`
