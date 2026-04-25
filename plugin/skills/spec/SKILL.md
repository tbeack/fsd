---
name: fsd:spec
description: Create a new spec artifact under `.fsd/<structure.spec>/<id>.md`. Interviews the user one question at a time for frontmatter (id, title, status, approved, related, tags) and six body sections (Problem, Goals, Non-goals, Requirements, Acceptance, Open questions). Auto-injects `project:` from `planning/PROJECT.md`. Refuses to overwrite. When PROJECT.md is missing, offers to chain-invoke `/fsd:new-project`. Create-only — editing existing specs is handled by a separate `/fsd:spec-update` skill (future).
argument-hint: `[spec title]`
---

# FSD Spec Skill

You help the user create a new spec artifact — the "what/why" contract that
`/fsd:plan` (FSD-008, planned) reads to derive implementation work. Specs
live under `<projectPath>/<structure.spec>/<id>.md` and have validated YAML
frontmatter plus six `##` body sections.

This is a **create-only** skill. If a spec with the chosen id already exists,
stop and tell the user to edit it directly (or, once it lands,
`/fsd:spec-update`). Never clobber an authored file.

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
  a one-line message: "PROJECT.md is required for spec authoring — aborting."
- **`ctx.project.validation.valid === false`** → `PROJECT.md` exists but
  the frontmatter fails validation. Print `ctx.project.validation.errors`
  verbatim, suggest `/fsd:validate` or a manual fix, and abort. Do NOT
  chain-invoke `/fsd:new-project` — it refuses to overwrite an existing
  PROJECT.md and would just fail.
- **`ctx.project` valid, `ctx.roadmap === null`** → soft warning:
  "ROADMAP.md missing — spec can still be written, but `/fsd:roadmap`
  or `/fsd:new-project` later would unlock session-start context." Proceed.
- **Both present and valid** → continue to Step 2.

## Step 2: Gather frontmatter — one question at a time

Do **not** dump the form. Ask each question, wait for the answer, then move
to the next. Let the user say "use your best judgment" / "fill it in" to
fast-path any question; infer reasonably from title + PROJECT.md context.

1. **Title** — if `$ARGUMENTS` is non-empty, use it as the title and skip
   this question. Otherwise ask: "What's this spec called? (1-line title)"
2. **Id** — derive a kebab-case slug from the title (lowercase, trim
   punctuation, hyphens for spaces). Confirm:
   > "Confirm id: `<derived>` — accept or override?"
   If the user overrides, validate against `^[a-z0-9]+(-[a-z0-9]+)*$`.
   Re-prompt on a bad override.
3. **Status** — "Status? (`draft`/`active`/`archived` — default `draft`)"
4. **Approved** — "Approved? (yes/no — default no)"
5. **Related refs** — "Related refs? (comma-separated `spec/…`, `plan/…`,
   `research/…`, or 'none')". Each must match
   `^(spec|plan|research)\/[a-z0-9]+(-[a-z0-9]+)*$`. Re-prompt on a bad entry.
6. **Tags** — "Tags? (comma-separated kebab-case, or 'none')". Each must
   match `^[a-z0-9]+(-[a-z0-9]+)*$`. Re-prompt on a bad entry.

**Do not ask about `project:`** — it is auto-injected from PROJECT.md by
the backing module.

## Step 3: Gather body sections — one question at a time

1. **Problem** — "What's the problem this spec addresses? (1–3 sentences)"
2. **Goals** — "What should this accomplish? (bullet list or short paragraph)"
3. **Non-goals** — "What is this deliberately NOT doing? (optional — skip
   with 'none')"
4. **Requirements** — "Falsifiable requirements? (numbered or bulleted;
   each must be something you could prove true or false)"
5. **Acceptance** — "How will we know it's done? (use `- [ ]` checkboxes,
   one per verification step)"
6. **Open questions** — "Any unknowns to surface? (optional — skip with
   'none')"

A skipped section keeps its italicized placeholder in the rendered file so
the structure is present for later editing.

## Step 4: Preview + confirm

Assemble the full rendered spec content by calling `renderSpec`:

```bash
node -e '
const { renderSpec } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/spec.js");
const { loadProjectContext } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
const path = require("path");
const ctx = loadProjectContext({ planningDir: path.join(process.cwd(), "planning") });
const data = JSON.parse(process.argv[1]);
data.project = ctx.project.meta.project;
process.stdout.write(renderSpec(data));
' "<spec-json>"
```

Print the full rendered file to the user. Resolve the target path with:

```bash
node -e '
const { resolveSpecPath } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/spec.js");
const { loadConfig, resolveLayerPaths } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/config.js");
const config = loadConfig(resolveLayerPaths());
const projectPath = require("path").join(process.cwd(), ".fsd");
process.stdout.write(resolveSpecPath({ projectPath, config, id: process.argv[1] }));
' "<id>"
```

Ask: "Write to `<resolved-path>`? (yes/no)". On **no**, abort — the user
can re-invoke and start over.

## Step 5: Write via the backing module

On confirmation, call `writeSpecFile` via a `node -e` invocation, passing
the assembled spec data as JSON:

```bash
node -e '
const { writeSpecFile } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/spec.js");
const { loadConfig, resolveLayerPaths } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/config.js");
const path = require("path");
const projectPath = path.join(process.cwd(), ".fsd");
const planningDir = path.join(process.cwd(), "planning");
const config = loadConfig(resolveLayerPaths());
const specData = JSON.parse(process.argv[1]);
const result = writeSpecFile({ projectPath, config, planningDir, specData });
process.stdout.write(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
' "<spec-json>"
```

Or use the CLI entry point for scripted invocation:

```bash
node plugin/scripts/spec.js <projectPath> --json=<payload.json>
```

On `{ ok: false, reason }`, relay the reason verbatim and stop. Do NOT
retry with a different id or overwrite flag.

## Step 6: Confirm + point at the next step

On success:

- Print the written path (from `result.written[0]`).
- "Run `/fsd:validate --artifacts` to confirm the new spec is picked up
  by the scanner."
- "When `/fsd:plan` lands (FSD-008), it will read this spec's
  Requirements and Acceptance sections automatically."

## Conventions to match

- **Frontmatter id ⇄ filename:** the `id:` field must equal the filename
  stem. `validateSpec` + `scanArtifacts` treat a mismatch as a hard error.
  The backing module derives the filename from `id`, so this invariant is
  automatic unless a future refactor breaks it.
- **Status values:** `draft`/`active`/`archived`. Default `draft` for a
  newly-authored spec — the user will flip it to `active` once the
  requirements are stable (future `/fsd:spec-update` territory).
- **ISO dates:** `YYYY-MM-DD`. `created:` is set by the backing module;
  do not ask the user.
- **Related refs:** always the shape `<spec|plan|research>/<kebab-id>`.
  Bare kebab ids (no prefix) are invalid.

## Guardrails (non-negotiable)

- **Never overwrite an existing spec.** The backing module refuses; the
  skill must honor that. If the target file exists, stop and suggest
  editing it directly or waiting for `/fsd:spec-update`.
- **Never ask about `project:`.** Always auto-inject from PROJECT.md. If
  PROJECT.md is missing → Step 1's precondition path. If invalid → abort.
- **One question at a time** in both the frontmatter and body interviews.
  Do not dump a multi-question form.
- **Never auto-approve.** `approved: true` requires an explicit user "yes"
  answer. Default to `false`.
- **Never modify `planning/PROJECT.md` or `planning/ROADMAP.md`.** This
  skill reads them and nothing else under `planning/`.
- **Never write to a path outside `<projectPath>/<structure.spec>/`.** The
  backing module resolves this; do not second-guess by passing explicit
  paths.
- **Do not start writing plans or research in the same invocation.** This
  skill captures the "what/why"; `/fsd:plan` (future) handles the "how".
