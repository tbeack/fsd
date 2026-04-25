---
name: plan
description: Guided technical-implementation planning inside Claude Code's native plan mode. Engineer-led; the skill reads the linked spec (hard-required), PROJECT.md, ROADMAP.md, ARCHITECTURE.md, the frontmatter of existing plans, and files the spec explicitly names, then runs a Socratic discussion to fill gaps. On ExitPlanMode approval, writes `.fsd/<structure.plan>/<id>.md` and — if the engineer opted in — appends ADR-style decisions to `planning/ARCHITECTURE.md` (or seeds it the first time). Refuses without a spec linkage. Create-only; a future `/fsd:plan-update` skill will handle edits.
argument-hint: `[spec-id]`
---

# FSD Plan Skill

You help an engineer draft a **technical implementation plan** — the "how"
that `/fsd:execute-plan` (FSD-009, planned) will read to drive execution.
Plans live under `<projectPath>/<structure.plan>/<id>.md` with validated
YAML frontmatter and six `##` body sections (Context / Approach / Phases /
Risks / Acceptance / Open questions).

This skill is a **create-only**, **engineer-led**, **plan-mode** tool:

- **Create-only.** If a plan with the chosen id already exists, stop and
  tell the engineer. Editing is a future `/fsd:plan-update` concern.
- **Engineer-led.** The engineer provides direct technical, architectural,
  and implementation guidance. Your job is to absorb prior context, ask
  pointed questions only where prior context doesn't give strict guidance,
  and synthesize the result into a plan artifact.
- **Plan-mode.** You enter Claude Code's native plan mode in Step 2. Every
  subsequent read is read-only. Writes happen only AFTER `ExitPlanMode`
  is approved.

You also own `planning/ARCHITECTURE.md` — a long-lived project-level
artifact that captures stack, ADR-style decisions, code examples,
references, standards, glossary, and open architectural questions. You
LAZILY CREATE it the first time it's missing (with engineer opt-in) and
APPEND to it on subsequent plan runs when the engineer names decisions
worth recording cross-phase.

## Step 1: Preconditions (before entering plan mode)

### 1a. PROJECT.md must exist and validate

Read `planning/PROJECT.md` via the loader:

```bash
node -e '
const { loadProjectContext } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
const path = require("path");
const ctx = loadProjectContext({ planningDir: path.join(process.cwd(), "planning") });
process.stdout.write(JSON.stringify(ctx));
'
```

- **`ctx.project === null`** → ask: "PROJECT.md not found — run
  `/fsd:new-project` first? (yes/no)". On yes, invoke `/fsd:new-project`
  via the Skill tool and resume. On no, abort: "PROJECT.md is required
  for plan authoring — aborting."
- **`ctx.project.validation.valid === false`** → print errors verbatim,
  suggest `/fsd:validate` or a manual fix, abort. Do NOT chain-invoke
  `/fsd:new-project` (it refuses to overwrite).
- **Both PROJECT and ROADMAP present and valid** → continue.
- **ROADMAP.md missing but PROJECT valid** → soft warning, proceed.

### 1b. Resolve the spec (hard-require)

Parse `$ARGUMENTS`. The first whitespace-separated token, if present, is
the spec id.

- **Spec id provided** → continue with that id.
- **Spec id not provided** → list specs in `<fsdDir>/<structure.spec>/`
  with titles and statuses (read via `scanArtifacts`), then ask: "Which
  spec is this plan for?". Do not guess.

Verify the spec precondition:

```bash
node -e '
const { checkSpecPrecondition } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/plan.js");
const path = require("path");
const fsdDir = path.join(process.cwd(), ".fsd");
const result = checkSpecPrecondition({ fsdDir, specId: process.argv[1] });
process.stdout.write(JSON.stringify(result));
' "<spec-id>"
```

Interpret:

- **`ok: false` + missing** → abort: "Linked spec not found. Create it
  with `/fsd:spec <title>` first, then re-invoke `/fsd:plan <spec-id>`."
- **`ok: false` + archived** → abort: "Linked spec is archived. Pick an
  active spec, or supersede the archived one first via
  `/fsd:spec-update supersede`."
- **`ok: true` + `warnings.length > 0`** (spec unapproved) → surface the
  warnings verbatim and ask: "The spec hasn't been approved yet. Plans
  drafted against unapproved specs may need rework if the spec shifts.
  Proceed anyway? (yes/no)". On **no**, abort. On **yes**, remember to
  pass `acknowledgeUnapproved: true` at write time.
- **`ok: true` + no warnings** → continue.

### 1c. Refuse overlap with an existing plan

Compute the default plan id (the spec id). Check
`<fsdDir>/<structure.plan>/<id>.md`:

- **Exists** → ask: "A plan with id `<id>` already exists. Pick a
  different id or stop and let the engineer edit the existing plan."
- **Absent** → continue.

## Step 2: Enter native plan mode

Invoke the `EnterPlanMode` tool. All subsequent reads, discussion, and
drafting happen inside plan mode. Do not read anything before this step.
Do not write anything until Step 6.

## Step 3: Gather context (read-only)

Inside plan mode, gather a narrow and relevant set of context before
drafting. **Artifacts + narrowly-hinted code — no broad repo scans.**

### 3a. Read the artifacts

1. Linked spec (full body, not just frontmatter).
2. `planning/PROJECT.md` and `planning/ROADMAP.md` (from the Step 1 load).
3. `planning/ARCHITECTURE.md` if present (from the Step 1 load). Note its
   status for Step 5 — missing means lazy-create is available; present
   means append-mode.
4. Frontmatter + title of every plan in `<fsdDir>/<structure.plan>/*.md`:

   ```bash
   node -e '
   const { scanArtifacts } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
   const { loadConfig, resolveLayerPaths, getStructure } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/config.js");
   const path = require("path");
   const config = loadConfig(resolveLayerPaths());
   const dirName = getStructure(config).plan;
   const plans = scanArtifacts({ fsdDir: path.join(process.cwd(), ".fsd"), kind: "plan", dirName });
   process.stdout.write(JSON.stringify(plans, null, 2));
   '
   ```

### 3b. Read narrowly-hinted code

Scan the spec body for explicit file paths (e.g. backtick-wrapped paths
like `plugin/scripts/foo.js`) and symbol names (camelCase or PascalCase
identifiers mentioned in Requirements / Acceptance / Approach).

- Read each named file in full.
- Grep the repo for each named symbol and read the top one or two hits.

Do not go beyond what the spec points at. The engineer will ask you to
read more during Step 4 if they want you to.

### 3c. Report the synthesis

Print a single short paragraph back to the engineer:

> "Pulled: spec `<id>` (full), PROJECT.md, ROADMAP.md,
> ARCHITECTURE.md (<present|missing>), N existing plans, M files hinted
> by the spec. Anything else I should read before we draft?"

Wait for the engineer's answer. If they point at more, read it. If they
say "go ahead", move to Step 4.

## Step 4: Socratic discussion + draft iteration

Draft the plan section-by-section. Do not dump the whole draft at once.

**Phase checkbox convention.** Structure the `## Phases` section so
`/fsd:execute-plan` can track progress deterministically: each phase is a
top-level checkbox line with two-digit zero-padded numbering, steps
indented beneath. Example:

```
- [ ] **Phase 01** — Validator extension
  - Add helper in validator.js
  - Wire into validateProject + validatePlan
- [ ] **Phase 02** — Skill retrofit
  - Update SKILL.md
```

The executor matches `- [ ] **Phase NN**` entries via `parsePhases` and
flips each `[ ]` to `[x]` as verification passes. Freeform prose between
phases is tolerated — only the checkbox lines are parsed.

For **each** of the six body sections (Context, Approach, Phases, Risks,
Acceptance, Open questions):

1. Synthesize an initial draft from Step 3's context.
2. Present it to the engineer.
3. Ask pointed clarifying questions ONLY where the context is thin. Good
   questions name specific ambiguities and offer concrete options:
   > "The spec says 'use the existing error-handling pattern'. I see two:
   > `tryCatchAndReturn` at `src/lib/errors.js:14` and
   > `wrapWithErrorBoundary` at `src/components/ErrorBoundary.tsx:22`.
   > Which applies here?"
4. Revise. Move on when the engineer is satisfied.

During Phases drafting, surface the existing-plan list from Step 3a and
ask: **"Any of these plans need to finish before this one?"**. Record
the engineer's answer as `depends_on:` (array of kebab-case plan ids).
This is NOT a separate frontmatter prompt — it's part of the Socratic
flow.

### Frontmatter interview (brief)

Once the sections converge, confirm frontmatter values. Ask only for
what the context doesn't already give you:

- `title` — default: the spec's title. Confirm or override.
- `id` — default: the spec id. Confirm or override.
- `status` — default: `draft`. "Mark this plan `active`, or leave as
  `draft` until phases are locked?"
- `task` — "FSD task id this plan addresses? (e.g. `FSD-012`, or
  'none')". Optional.
- `estimate` — "Rough effort? (e.g. `~2 days`, `~4 hours`, or 'skip')".
  Optional.
- `tags` — "Any tags? (comma-separated kebab-case, or 'none')".
  Optional.
- `verification` — "Plan-specific verification commands that override
  PROJECT.md? `/fsd:execute-plan` runs these after each phase. Reply like
  `tests: ..., validate: ...` using any subset of
  `tests | validate | typecheck | lint`, or 'skip' to inherit from
  PROJECT.md." Parse the comma-separated reply into an object. On 'skip',
  omit the field — the executor falls back to PROJECT.md's
  `verification:` or prompts the engineer.

Do NOT ask about `project:` (auto-injected) or `related:` (fixed from
the spec hard-require + any additional related refs the engineer names).

## Step 5: Architecture delta

Decide what, if anything, to record in `planning/ARCHITECTURE.md`.

### 5a. Branch on presence

- **ARCHITECTURE.md is present** → skip to 5b (append path).
- **ARCHITECTURE.md is missing** → ask: "No `planning/ARCHITECTURE.md`
  yet — this is a long-lived project-level artifact that captures stack,
  ADR-style decisions, code examples, references, standards, glossary,
  and open architectural questions. Create it now and seed it with
  decisions from this plan? (yes/no)". On **no**, skip Step 5 entirely.
  On **yes**, proceed with the lazy-create path.

### 5b. Append-to-existing path

Ask: **"Any technical decisions from this plan to record in
`ARCHITECTURE.md`'s `## Decisions` section? (yes/no)"**. If yes, for
each decision the engineer names, draft an entry with four fields:

- **Title** — short declarative sentence (e.g. "Use atomic tmp+rename
  writes for all artifact files").
- **Context** — one or two sentences on why the choice arose.
- **Decision** — the choice made.
- **Consequences** — what it enables or costs.

Then ask: **"Anything to add to the other architecture sections? (stack,
code examples, references, standards, glossary, open questions)"**.
If yes, collect `{ sectionId, content }` pairs.

### 5c. Lazy-create path

Seed `ARCHITECTURE.md` from this plan's technical content:

- `stack` — populate from the spec's technical hints + files you read in
  Step 3b. Keep it factual (languages, frameworks, hosting).
- `decisions` — seed with any ADR-style entries the engineer wants from
  the 5b flow above.
- `code_examples` / `references` / `standards` / `glossary` /
  `open_questions` — leave as placeholders unless the engineer names
  content for one.

## Step 6: ExitPlanMode + write

### 6a. ExitPlanMode with the full payload

Call `ExitPlanMode` with a single human-readable payload that includes:

1. **The plan content** — the full rendered markdown that will land at
   `<fsdDir>/<structure.plan>/<id>.md`.
2. **The architecture delta** — either:
   - Create: "Will create `planning/ARCHITECTURE.md` with these decisions
     and placeholders elsewhere" (show the rendered content).
   - Append: "Will prepend these ADR entries under `## Decisions`; will
     append to these other sections".
   - None: state it explicitly.
3. **The target paths** for each write.

The harness will ask the engineer to approve. On approval, continue to
6b. On rejection, stop — do not write anything.

### 6b. Write the plan

```bash
# Write planData as JSON to a tmp file, then delegate.
node -e '
const fs = require("fs");
const payload = { /* ...assembled planData... */ };
fs.writeFileSync("/tmp/fsd:plan-payload.json", JSON.stringify(payload));
'
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.js" \
  "$(pwd)/.fsd" \
  --json=/tmp/fsd:plan-payload.json \
  [--acknowledge-unapproved]
```

- Include `--acknowledge-unapproved` ONLY if Step 1b surfaced warnings
  and the engineer explicitly answered "yes" to proceeding.
- On `{ ok: false, reason }`, relay the reason verbatim. Do NOT retry
  with an overwrite flag (there isn't one).
- On `{ ok: true, written, warnings? }`, print the written path and any
  warnings.

### 6c. Write the architecture delta

If the Step 5 outcome was "none", skip this.

For lazy-create:

```bash
node -e '
const fs = require("fs");
const payload = { /* project, title, sections: { stack: "...", decisions: "<seeded ADRs>", ... } */ };
fs.writeFileSync("/tmp/fsd-arch-payload.json", JSON.stringify(payload));
'
node "${CLAUDE_PLUGIN_ROOT}/scripts/architecture.js" \
  "$(pwd)/planning" create \
  --json=/tmp/fsd-arch-payload.json
```

For each ADR to append:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/architecture.js" \
  "$(pwd)/planning" append-decision \
  --title="<title>" \
  --context="<context>" \
  --decision="<decision>" \
  --consequences="<consequences>"
```

For each non-Decisions section append:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/architecture.js" \
  "$(pwd)/planning" append-to-section \
  --section-id=<stack|code_examples|references|standards|glossary|open_questions> \
  --content="<content>"
```

### 6d. Confirm + next steps

On success, print:

- The written plan path.
- Any ARCHITECTURE.md operations that happened (create / N ADRs appended
  / M sections appended).
- "Run `/fsd:validate --artifacts` to confirm the plan is picked up."
- "When `/fsd:execute-plan` lands (FSD-009), it'll read this plan
  automatically."

## Conventions to match

- **Frontmatter `id` ⇄ filename:** the `id:` field must equal the
  filename stem. `validatePlan` + `scanArtifacts` treat a mismatch as a
  hard error. The backing module derives the filename from `id`, so this
  is automatic unless a future refactor breaks it.
- **Status values:** `draft` / `active` / `archived`. Default `draft`
  when authored. Engineer flips to `active` once phases are locked and
  execution is imminent (future `/fsd:plan-update` territory).
- **Related refs:** shape `<spec|plan|research>/<kebab-id>`. The
  hard-required spec link is always `spec/<id>`.
- **ISO dates:** `YYYY-MM-DD`. `created:` is set by the backing module.

## Guardrails (non-negotiable)

- **Never skip `EnterPlanMode`.** Plan mode is the approval contract for
  this skill. Bypassing it is a security boundary violation.
- **Never write before `ExitPlanMode` is approved.** Any write that
  happens outside the approval path is a bug.
- **Never overwrite an existing plan.** The backing module refuses; the
  skill must honor that. If the target path exists, stop and surface it
  — don't try a different id without asking the engineer.
- **Never drop the spec hard-require.** Missing, archived, or unapproved
  (without explicit ack) → stop. Don't "help" by offering to create a
  stub spec.
- **Never touch PROJECT.md, ROADMAP.md, or the linked spec.** Each has
  its own authoring surface (`/fsd:new-project`, `/fsd:roadmap`,
  `/fsd:spec` + `/fsd:spec-update`). This skill reads; it does not
  write to them.
- **Never auto-approve or auto-archive.** Status flips require explicit
  engineer input. Future `/fsd:plan-update` owns flips.
- **Never ask about `project:`.** Always auto-inject from PROJECT.md.
- **One question at a time** during Socratic discussion. Don't dump a
  multi-question form.
- **Don't scan the repo broadly.** Stay within the "artifacts plus
  narrowly-hinted code" contract. If the engineer wants you to read
  more, they will say so during Step 4.
- **Do not auto-commit or push.** The engineer owns the release
  boundary. Stop after Step 6d.
