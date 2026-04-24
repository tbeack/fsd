---
name: fsd-plan-update
description: Edit an existing plan artifact under `.fsd/<structure.plan>/<id>.md`. Dispatches three subcommands — `update` (surgical title/status/related/tags/depends_on/task/estimate/section rewrite), `archive` (idempotent `status: archived`), and `supersede` (adds `oldId` to new plan's `supersedes:` + archives old plan). Every op re-validates via `validatePlan` before writing and preserves untouched sections byte-for-byte. Refuses to run if the target plan doesn't exist — use `/fsd-plan` to create new plans.
argument-hint: `<update|archive|supersede> [--key=value ...]`
---

# FSD Plan Update Skill

You help the user edit an existing plan artifact. Mirrors `/fsd-spec-update`'s
shape: a small set of surgical operations, one question at a time to gather
missing args, a preview before writing, atomic write with re-validation.

This is the **edit** counterpart to `/fsd-plan`. If the target plan doesn't
exist, stop and point the user at `/fsd-plan` — never clobber or create from
this skill.

## Step 1: Parse the op from `$ARGUMENTS`

Accept one of: `update | archive | supersede`. If `$ARGUMENTS` is empty or
the first token is unrecognized, show the usage block:

```
Usage:
  /fsd-plan-update update <id> [--target=title|status|related|tags|depends_on|task|estimate|section] [...]
  /fsd-plan-update archive <id>
  /fsd-plan-update supersede <new-id> --replaces <old-id>
```

Resolve `projectPath` = `<cwd>/.fsd`. Resolve the plan dir from
`getStructure(config).plan` so config overrides apply.

## Step 2: Locate the plan

Before asking any further questions, check that the target plan file exists
under `<projectPath>/<structure.plan>/<id>.md`. If it doesn't, refuse with
the backing module's `plan not found` reason verbatim and point the user at
`/fsd-plan` as the create surface. Do NOT offer to create the file from
this skill.

## Step 3: Gather missing args — one question at a time

Do NOT dump the form. Ask each question, wait for the answer, then move on.
If the user says "use your best judgment" / "fill it in", infer reasonably.

### For `update`

1. **`id`** — "Which plan id?" (unless provided in `$ARGUMENTS`).
2. **`target`** — "What do you want to change?" Offer the menu:
   - `title` — rewrite the plan title
   - `status` — flip between `draft` and `active` (use `archive` op to archive)
   - `related` — add or remove one cross-reference
   - `tags` — add or remove one tag
   - `depends_on` — add or remove one plan-id dependency
   - `task` — set or clear the FSD-NNN task reference
   - `estimate` — set or clear the free-form estimate string
   - `section` — rewrite one of the six body sections
3. **Per-target follow-up:**
   - `title`: "New title?"
   - `status`: "New status? (draft / active)"
   - `related`: "Add or remove?" → "Value? (e.g. `spec/auth-v2`)"
   - `tags`: "Add or remove?" → "Value? (kebab-case)"
   - `depends_on`: "Add or remove?" → "Value? (kebab-case plan id)"
   - `task`: "Set or clear?" → if set: "Value? (e.g. `FSD-042`)"
   - `estimate`: "Set or clear?" → if set: "Value? (e.g. `~3 days`)"
   - `section`: "Which section? (context / approach / phases / risks / acceptance / open_questions)" → "New content for that section?"

### For `archive`

1. **`id`** — "Which plan id?"

### For `supersede`

1. **`new-id`** — "Id of the new plan that supersedes another?"
2. **`old-id`** — "Id of the old plan being superseded?"

## Step 4: Preview the change

Before writing, show the user what will change:

- For frontmatter edits (title, status, related, tags, depends_on, task,
  estimate, archive): print a two-line before/after of the affected
  field(s) plus the new `updated:` date.
- For a section rewrite: print the section heading + the new body inside a
  fenced code block (so newlines are visible).
- For `supersede`: print BOTH plans' frontmatter diffs (new plan gains an
  entry in `supersedes:`; old plan's `status` flips to `archived`; both
  `updated:` bump).

Ask: **"Apply? (yes/no)"**. On "no", abort cleanly with a one-line message.

## Step 5: Invoke the backing module

On confirmation, call the CLI entry point:

```bash
# update title
node plugin/scripts/plan-update.js <projectPath> update --id=<id> --target=title --value="<new-title>"

# update status
node plugin/scripts/plan-update.js <projectPath> update --id=<id> --target=status --value=<draft|active>

# update related | tags | depends_on
node plugin/scripts/plan-update.js <projectPath> update --id=<id> --target=<related|tags|depends_on> --action=<add|remove> --value=<value>

# update task | estimate (set / clear)
node plugin/scripts/plan-update.js <projectPath> update --id=<id> --target=<task|estimate> --action=set --value="<value>"
node plugin/scripts/plan-update.js <projectPath> update --id=<id> --target=<task|estimate> --action=clear

# update section
node plugin/scripts/plan-update.js <projectPath> update --id=<id> --target=section --section-id=<section-id> --content="<body>"

# archive
node plugin/scripts/plan-update.js <projectPath> archive --id=<id>

# supersede
node plugin/scripts/plan-update.js <projectPath> supersede --new-id=<new-id> --old-id=<old-id>
```

Each CLI call prints a single line of JSON and exits 0 on success, 1 on
operation failure, 2 on usage/invocation error. Parse the JSON to get
`{ ok, reason?, written? }`.

## Step 6: Report the result — do not auto-commit

On `{ ok: true, written: true }`:
- Print a one-line confirmation: op + id + what changed (e.g. `archived plan "auth-v2-migration"` or `updated plan "auth-v2-migration" title to "Auth v2 — Migration Plan (Rev 2)"`).
- Suggest `/fsd:validate --artifacts` to confirm round-trip validation (it
  already ran as part of `writePlanAtomic`, but this gives the user a
  visible confirmation surface).

On `{ ok: true, written: false, reason }`:
- Print the no-op reason verbatim (e.g. "already archived", "no change
  (status already draft)"). Don't frame it as a failure.

On `{ ok: false, reason }`:
- Print the reason verbatim. Do NOT retry with a different value. The user
  decides how to proceed.

**Stop there.** The engineer owns the release boundary — never auto-commit
or push.

## Conventions to match

- **Plan id ⇄ filename:** the `id:` field equals the filename stem. This
  skill never renames the file; `rename-id` is explicitly out-of-scope for
  v1 (captured as a future FSD if needed).
- **Status enum:** `draft | active | archived`. `update status` accepts
  only `draft` or `active`; archive transitions go through the `archive`
  op (one-way, matches FSD-014 decision).
- **Section ids:** `context`, `approach`, `phases`, `risks`, `acceptance`,
  `open_questions` — the same SECTION_ORDER `/fsd-plan` uses.
- **ISO dates:** `updated:` is set by the backing module to today on every
  write; do not ask the user.
- **`related` / `tags` / `depends_on` values:** validated against
  `CROSS_REF` / `KEBAB_CASE` / `KEBAB_CASE` respectively. Backing module
  will refuse bad values.
- **`task` / `estimate`:** free-form non-empty strings. `action=clear`
  removes the key from frontmatter entirely.

## Guardrails (non-negotiable)

- **Never create a new plan from this skill.** If the target plan doesn't
  exist, the backing module returns `{ ok: false, reason: /plan not found/ }`.
  Relay the reason and point the user at `/fsd-plan` (create) — do not
  silently fall through to creation.
- **Never modify `planning/PROJECT.md`, `planning/ROADMAP.md`,
  `planning/ARCHITECTURE.md`, or the linked spec.** This skill only
  touches files under `<projectPath>/<structure.plan>/`.
- **Never rewrite user-authored body prose except in the explicit
  `update section` op.** Every other op edits frontmatter only.
- **Never rename the plan file.** `id:` rewrite is excluded from the
  `update` target list for this reason — file rename is a future FSD.
- **Never auto-flip `status` to `archived` via `update`.** The dedicated
  `archive` op is the only path; this keeps intent explicit.
- **Never auto-unarchive or auto-un-supersede.** Strict one-way ops in v1;
  engineer hand-edits the file if they need to reverse.
- **`update remove-related` does NOT special-case the spec-hard-require
  link** that `/fsd-plan` enforces at create time. Removing the only
  `spec/<id>` entry from `related:` will leave the plan unauthor-able by
  `/fsd-plan` — the engineer takes responsibility.
- **One question at a time.** Don't dump a multi-question form. The
  subcommand choice already narrows what's asked — ask sequentially
  inside it.
- **Always show a preview before writing.** Silent writes are surprising;
  the preview + confirmation is non-negotiable.
- **Never auto-commit or push.** Edits land on disk; commits are the
  user's call.
- **Never retry on `{ ok: false }`.** The reason is authoritative; relay
  it and let the user decide.
