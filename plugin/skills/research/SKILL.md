---
name: fsd:research
description: Create a new research artifact under `.fsd/<structure.research>/<id>.md`. Interviews the user one question at a time for frontmatter (id, title, status, related, tags, sources, conclusion) and six body sections (Question, Context, Method, Findings, Conclusion, Open questions). Auto-injects `project:` from `planning/PROJECT.md`. Refuses to overwrite. Create-only — editing existing research artifacts is handled by a separate skill (future).
argument-hint: `[research title]`
---

# FSD Research Skill

You help the user create a new research artifact — technical investigation
notes, spike findings, or reference material that lives under
`<projectPath>/<structure.research>/<id>.md` and has validated YAML
frontmatter plus six `##` body sections.

This is a **create-only** skill. If a research artifact with the chosen id
already exists, stop and tell the user to edit it directly. Never clobber
an authored file.

## Step 1: Precondition — PROJECT.md must exist and validate

Read `planning/PROJECT.md` via the loader:

```bash
node -e '
const { loadProjectContext } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
const path = require("path");
const planningDir = path.join(process.cwd(), "planning");
const ctx = loadProjectContext({ planningDir });
process.stdout.write(JSON.stringify(ctx));
'
```

Interpret the result:

- **`ctx.project === null`** → `PROJECT.md` is missing. Ask the user:
  > "PROJECT.md not found — run `/fsd:new-project` first? (yes/no)"
  On **yes**, invoke `/fsd:new-project` via the Skill tool and resume this
  skill after it returns (re-read `ctx` to confirm). On **no**, abort with
  a one-line message: "PROJECT.md is required for research authoring — aborting."
- **`ctx.project.validation.valid === false`** → `PROJECT.md` exists but
  the frontmatter fails validation. Print `ctx.project.validation.errors`
  verbatim, suggest `/fsd:validate` or a manual fix, and abort. Do NOT
  chain-invoke `/fsd:new-project` — it refuses to overwrite an existing
  PROJECT.md and would just fail.
- **`ctx.project` valid, `ctx.roadmap === null`** → soft warning:
  "ROADMAP.md missing — research artifact can still be written, but
  `/fsd:roadmap` or `/fsd:new-project` later would unlock session-start
  context." Proceed.
- **Both present and valid** → continue to Step 2.

## Step 2: Gather frontmatter — one question at a time

Do **not** dump the form. Ask each question, wait for the answer, then move
to the next. Let the user say "use your best judgment" / "fill it in" to
fast-path any question; infer reasonably from title + PROJECT.md context.

1. **Title** — if `$ARGUMENTS` is non-empty, use it as the title and skip
   this question. Otherwise ask: "What's this research called? (1-line title)"
2. **Id** — derive a kebab-case slug from the title (lowercase, trim
   punctuation, hyphens for spaces). Confirm:
   > "Confirm id: `<derived>` — accept or override?"
   If the user overrides, validate against `^[a-z0-9]+(-[a-z0-9]+)*$`.
   Re-prompt on a bad override.
3. **Status** — "Status? (`draft`/`active`/`archived` — default `draft`)"
4. **Related refs** — "Related refs? (comma-separated `spec/…`, `plan/…`,
   `research/…`, or 'none')". Each must match
   `^(spec|plan|research)\/[a-z0-9]+(-[a-z0-9]+)*$`. Re-prompt on a bad entry.
5. **Tags** — "Tags? (comma-separated kebab-case, or 'none')". Each must
   match `^[a-z0-9]+(-[a-z0-9]+)*$`. Re-prompt on a bad entry.
6. **Sources** — "Source URLs? (comma-separated http(s) links, or 'none')".
   Each must match `^https?://`. Re-prompt on a bad entry.
7. **Conclusion** — "One-line conclusion or recommendation? (or 'skip')".
   On 'skip', omit the frontmatter field. On a value, use it as-is (non-empty
   string). This is a terse summary; the full conclusion goes in the body
   section below.

**Do not ask about `project:`** — it is auto-injected from PROJECT.md by
the backing module.

## Step 3: Gather body sections — one question at a time

1. **Question** — "What is being investigated? (1–3 sentences describing
   the research question)"
2. **Context** — "Why is this research needed? What prompted it?
   (background and motivation)"
3. **Method** — "How was the investigation approached? (what you tried,
   what you read, what you built)"
4. **Findings** — "What was discovered? (facts, observations, data)"
5. **Conclusion** — "Full conclusion or recommendation? (freeform prose;
   this is distinct from the one-liner in frontmatter, or 'skip')"
6. **Open questions** — "Any follow-up unknowns? (optional — skip with
   'none')"

A skipped section keeps its italicized placeholder in the rendered file so
the structure is present for later editing.

**Note:** the `conclusion:` frontmatter field (Step 2) is a one-line
summary used by scanners and dashboards. The `## Conclusion` body section
is freeform prose. Both may coexist and cover different levels of detail.

## Step 4: Preview + confirm

Assemble the full rendered research content by calling `renderResearch`:

```bash
node -e '
const { renderResearch } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/research.js");
const { loadProjectContext } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
const path = require("path");
const ctx = loadProjectContext({ planningDir: path.join(process.cwd(), "planning") });
const data = JSON.parse(process.argv[1]);
data.project = ctx.project.meta.project;
process.stdout.write(renderResearch(data));
' "<research-json>"
```

Print the full rendered file to the user. Resolve the target path with:

```bash
node -e '
const { resolveResearchPath } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/research.js");
const { loadConfig, resolveLayerPaths } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/config.js");
const config = loadConfig(resolveLayerPaths());
const projectPath = require("path").join(process.cwd(), ".fsd");
process.stdout.write(resolveResearchPath({ projectPath, config, id: process.argv[1] }));
' "<id>"
```

Ask: "Write to `<resolved-path>`? (yes/no)". On **no**, abort — the user
can re-invoke and start over.

## Step 5: Write via the backing module

On confirmation, call `writeResearchFile` via a `node -e` invocation,
passing the assembled research data as JSON:

```bash
node -e '
const { writeResearchFile } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/research.js");
const { loadConfig, resolveLayerPaths } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/config.js");
const path = require("path");
const projectPath = path.join(process.cwd(), ".fsd");
const planningDir = path.join(process.cwd(), "planning");
const config = loadConfig(resolveLayerPaths());
const researchData = JSON.parse(process.argv[1]);
const result = writeResearchFile({ projectPath, config, planningDir, researchData });
process.stdout.write(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
' "<research-json>"
```

Or use the CLI entry point for scripted invocation:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/research.js" <projectPath> --json=<payload.json>
```

On `{ ok: false, reason }`, relay the reason verbatim and stop. Do NOT
retry with a different id or overwrite flag.

## Step 6: Confirm + point at the next step

On success:

- Print the written path (from `result.written[0]`).
- "Run `/fsd:validate --artifacts` to confirm the new research artifact is
  picked up by the scanner."
- "Link it to a spec or plan via `related:` in the artifact's frontmatter
  to surface it in `/fsd:execute-plan`'s context."

## Conventions to match

- **Frontmatter id ⇄ filename:** the `id:` field must equal the filename
  stem. `validateResearch` + `scanArtifacts` treat a mismatch as a hard
  error. The backing module derives the filename from `id`, so this
  invariant is automatic unless a future refactor breaks it.
- **Status values:** `draft`/`active`/`archived`. Default `draft` for a
  newly-authored artifact.
- **ISO dates:** `YYYY-MM-DD`. `created:` is set by the backing module;
  do not ask the user.
- **Related refs:** always the shape `<spec|plan|research>/<kebab-id>`.
  Bare kebab ids (no prefix) are invalid.
- **Sources:** must be valid http(s) URLs. Validate each one before
  accepting; re-prompt on a bad entry.

## Guardrails (non-negotiable)

- **Never overwrite an existing research artifact.** The backing module
  refuses; the skill must honor that. If the target file exists, stop and
  suggest editing it directly.
- **Never ask about `project:`.** Always auto-inject from PROJECT.md. If
  PROJECT.md is missing → Step 1's precondition path. If invalid → abort.
- **One question at a time** in both the frontmatter and body interviews.
  Do not dump a multi-question form.
- **Never modify `planning/PROJECT.md`, `planning/ROADMAP.md`, or any
  spec or plan artifact.** This skill reads them and nothing else under
  `planning/`.
- **Never write to a path outside `<projectPath>/<structure.research>/`.**
  The backing module resolves this; do not second-guess by passing explicit
  paths.
- **Do not auto-commit or push.** The engineer owns the release boundary.
  Stop after Step 6.
