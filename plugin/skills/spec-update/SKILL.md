---
name: spec-update
description: Edit an existing spec artifact under `.fsd/<structure.spec>/<id>.md`. Dispatches four subcommands — `update` (surgical title/status/related/tags/section rewrite), `approve` (idempotent `approved: true`), `archive` (idempotent `status: archived`), and `supersede` (adds `oldId` to new spec's `supersedes:` + archives old spec). Every op re-validates via `validateSpec` before writing and preserves untouched sections byte-for-byte. Refuses to run if the target spec doesn't exist — use `/fsd:spec` to create new specs.
argument-hint: `<update|approve|archive|supersede> [--key=value ...]`
---

# FSD Spec Update Skill

You help the user edit an existing spec artifact. Mirrors `/fsd:roadmap`'s
shape: a small set of surgical operations, one question at a time to gather
missing args, a preview before writing, atomic write with re-validation.

This is the **edit** counterpart to `/fsd:spec`. If the target spec doesn't
exist, stop and point the user at `/fsd:spec` — never clobber or create from
this skill.

## Step 1: Parse the op from `$ARGUMENTS`

Accept one of: `update | approve | archive | supersede`. If `$ARGUMENTS` is
empty or the first token is unrecognized, show the usage block:

```
Usage:
  /fsd:spec-update update <id> [--target=title|status|related|tags|section] [...]
  /fsd:spec-update approve <id>
  /fsd:spec-update archive <id>
  /fsd:spec-update supersede <new-id> --replaces <old-id>
```

Resolve `projectPath` = `<cwd>/.fsd`. Resolve the spec dir from
`getStructure(config).spec` so config overrides apply.

## Step 2: Gather missing args — one question at a time

Do NOT dump the form. Ask each question, wait for the answer, then move on.
If the user says "use your best judgment" / "fill it in", infer reasonably.

### For `update`

1. **`id`** — "Which spec id?" (unless provided in `$ARGUMENTS`).
2. **`target`** — "What do you want to change?" Offer the menu:
   - `title` — rewrite the spec title
   - `status` — flip between `draft` and `active` (use `archive` op to archive)
   - `related` — add or remove one cross-reference
   - `tags` — add or remove one tag
   - `section` — rewrite one of the six body sections
3. **Per-target follow-up:**
   - `title`: "New title?"
   - `status`: "New status? (draft / active)"
   - `related`: "Add or remove?" → "Value? (e.g. `plan/auth-v2-migration`)"
   - `tags`: "Add or remove?" → "Value? (kebab-case)"
   - `section`: "Which section? (problem / goals / non_goals / requirements / acceptance / open_questions)" → "New content for that section?"

### For `approve`

1. **`id`** — "Which spec id?"

### For `archive`

1. **`id`** — "Which spec id?"

### For `supersede`

1. **`new-id`** — "Id of the new spec that supersedes another?"
2. **`old-id`** — "Id of the old spec being superseded?"

## Step 3: Preview the change

Before writing, show the user what will change:

- For frontmatter edits (title, status, related, tags, approved, archive):
  print a two-line before/after of the affected field(s) plus the new
  `updated:` date.
- For a section rewrite: print the section heading + the new body inside a
  fenced code block (so newlines are visible).
- For `supersede`: print both specs' frontmatter diffs (new spec gains an
  entry in `supersedes:`; old spec's `status` flips to `archived`; both
  `updated:` bump).

Ask: **"Apply? (yes/no)"**. On "no", abort cleanly with a one-line message.

## Step 4: Invoke the backing module

On confirmation, call the CLI entry point:

```bash
# update title
node plugin/scripts/spec-update.js <projectPath> update --id=<id> --target=title --value="<new-title>"

# update status
node plugin/scripts/spec-update.js <projectPath> update --id=<id> --target=status --value=<draft|active>

# update related|tags
node plugin/scripts/spec-update.js <projectPath> update --id=<id> --target=<related|tags> --action=<add|remove> --value=<value>

# update section
node plugin/scripts/spec-update.js <projectPath> update --id=<id> --target=section --section-id=<section-id> --content="<body>"

# approve / archive
node plugin/scripts/spec-update.js <projectPath> approve --id=<id>
node plugin/scripts/spec-update.js <projectPath> archive --id=<id>

# supersede
node plugin/scripts/spec-update.js <projectPath> supersede --new-id=<new-id> --old-id=<old-id>
```

Each CLI call prints a single line of JSON and exits 0 on success, 1 on
operation failure, 2 on usage/invocation error. Parse the JSON to get
`{ ok, reason?, written? }`.

## Step 5: Report the result

On `{ ok: true, written: true }`:
- Print a one-line confirmation: op + id + what changed (e.g. `approved spec "auth-v2"` or `updated spec "auth-v2" title to "Auth v2 — Rev 2"`).
- Suggest `/fsd:validate --artifacts` to confirm round-trip validation (it
  already ran as part of `writeSpecAtomic`, but this gives the user a
  visible confirmation surface).

On `{ ok: true, written: false, reason }`:
- Print the no-op reason verbatim (e.g. "already approved", "no change
  (status already draft)"). Don't frame it as a failure.

On `{ ok: false, reason }`:
- Print the reason verbatim. Do NOT retry with a different value. The user
  decides how to proceed.

## Conventions to match

- **Spec id ⇄ filename:** the `id:` field equals the filename stem. This
  skill never renames the file; `rename-id` is an explicit out-of-scope for
  v1 (captured as a future FSD if needed).
- **Status enum:** `draft | active | archived`. `update status` accepts
  only `draft` or `active`; archive transitions go through the `archive`
  op (one-way, matches FSD-014 decision).
- **Section ids:** `problem`, `goals`, `non_goals`, `requirements`,
  `acceptance`, `open_questions` — the same SECTION_ORDER `/fsd:spec` uses.
- **ISO dates:** `updated:` is set by the backing module to today on every
  write; do not ask the user.
- **`related` / `tags` values:** always validated against `CROSS_REF` /
  `KEBAB_CASE` respectively. Backing module will refuse bad values.

## Guardrails (non-negotiable)

- **Never create a new spec from this skill.** If the target spec doesn't
  exist, the backing module returns `{ ok: false, reason: /spec not found/ }`.
  Relay the reason and point the user at `/fsd:spec` (create) — do not
  silently fall through to creation.
- **Never modify `planning/PROJECT.md` or `planning/ROADMAP.md`.** This
  skill only touches files under `<projectPath>/<structure.spec>/`.
- **Never rename the spec file.** `id:` rewrite is excluded from the
  `update` target list for this reason — file rename is a future FSD.
- **Never auto-flip `status` to `archived` via `update`.** The dedicated
  `archive` op is the only path; this keeps intent explicit.
- **One question at a time.** Don't dump a multi-question form. The
  subcommand choice already narrows what's asked — ask sequentially inside
  it.
- **Always show a preview before writing.** Silent writes are surprising;
  the preview + confirmation is non-negotiable.
- **Never auto-commit.** Edits land on disk; commits are the user's call.
- **Never retry on `{ ok: false }`.** The reason is authoritative; relay it
  and let the user decide.
