---
name: fsd:roadmap
description: Mid-project ROADMAP.md maintenance. Dispatches five surgical operations — add-milestone, add-phase, advance, complete-phase, bump-version — that edit `planning/ROADMAP.md` in place while preserving user-authored goal prose and re-validating the schema on every write. Use this after `/fsd:new-project` has created the file; refuses to run if ROADMAP.md is missing. Gathers missing args one question at a time. Never edits PROJECT.md; never rewrites your goal paragraphs.
argument-hint: `<add-milestone|add-phase|advance|complete-phase|bump-version> [--key=value ...]`
---

# FSD Roadmap Skill

You help the user maintain `planning/ROADMAP.md` after it was created by
`/fsd:new-project`. The skill dispatches to five subcommands; all writes
go through `plugin/scripts/roadmap.js`, which validates the result via
`validateRoadmap` before touching disk.

## Step 1: Locate ROADMAP.md

Default target: `<cwd>/planning/ROADMAP.md`. If the file does not exist,
stop and tell the user:

> "No `planning/ROADMAP.md` found. Run `/fsd:new-project` to create it
> first — this skill is only for ongoing edits."

Do not proceed. Do not create the file. The creation path is FSD-005's
territory; this skill is additive edits only.

## Step 2: Parse the subcommand

Read `$ARGUMENTS`. The first whitespace-separated token is the op name.
Accept exactly one of:

| Op | Purpose |
|---|---|
| `add-milestone` | Append a new `## Milestone <id>` block. Optionally set as current. |
| `add-phase` | Insert a new `### Phase <id> — <title>` block into a named milestone. |
| `advance` | Mark current milestone shipped; flip `current_milestone` + `version` to the next milestone. |
| `complete-phase` | Mark a named phase shipped via a body status line. |
| `bump-version` | Frontmatter `version:` bump (patch-style; does not touch milestones). |

If the first token is missing or unrecognized, show the usage table and
ask which op the user wants. Do not guess.

## Step 3: Gather missing args — one question at a time

Each op has required args. `$ARGUMENTS` may provide them as
`--key=value` pairs (pass-through to the backing script). For any arg
that's missing, ask the user one question at a time — never dump a
multi-field form.

**add-milestone**
- `id` — short milestone id (e.g. `v2`, `v2.0`, `mvp`)
- `version` — semver-like (`0.2`, `1.0.0`)
- `name` — short human name
- `goal` — 1–2 sentence goal
- `setCurrent` — yes/no (default: no). If yes, frontmatter `current_milestone` and `version` flip to the new milestone; otherwise only `updated:` changes.

**add-phase**
- `milestoneId` — id of the milestone the phase lives under (must exist)
- `id` — phase id (e.g. `v2.1`)
- `title` — short title
- `goal` — one-paragraph goal

**advance** — no args. Reads `current_milestone` from frontmatter, finds the next milestone by source order, errors if none.

**complete-phase**
- `phaseId` — phase id to mark shipped

**bump-version**
- `newVersion` — semver-like, must differ from the current `version:`

## Step 4: Preview before applying

Show the user a short preview of what will change:

- For `add-milestone` / `add-phase`: the exact block that will be
  appended/inserted, plus any frontmatter updates.
- For `advance`: which milestone will be marked shipped, what the new
  `current_milestone` and `version` values will be.
- For `complete-phase`: which phase will be marked shipped.
- For `bump-version`: the old and new `version:` values.

Then ask: "Apply? (yes/no)".

## Step 5: Apply via the backing script

Only after explicit `yes` from the user, invoke:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js" \
  "<absolute path to planning/ROADMAP.md>" \
  <op> \
  [--key=value ...]
```

The script prints a single line of JSON with `{ ok, reason?, written? }`
and exits 0 on success, 1 on failure. For multi-line values (`goal`),
pass them via the `--goal=<value>` form; the shell will quote them.

Relay the result to the user:
- On `ok: true, written: true` — one-line confirmation + the updated frontmatter snapshot.
- On `ok: true, written: false` — relay the `reason` (usually the idempotent no-op message).
- On `ok: false` — relay `reason` verbatim. Do not attempt to "fix" the roadmap in-band.

## Step 6: Do not auto-commit

The skill never stages or commits changes. Tell the user what landed and
stop. They own the release boundary.

## Guardrails

- **Never touch `planning/PROJECT.md`.** This skill is scoped to ROADMAP.md only.
- **Never rewrite user-authored goal prose.** Ops only add structure (headings, status lines) and edit frontmatter. If the user wants to change a goal paragraph, they edit the file directly.
- **Never create ROADMAP.md.** If it's missing, point the user at `/fsd:new-project`.
- **Always re-validate.** The backing script re-runs `validateRoadmap` before writing; if it rejects the result, the file on disk is unchanged. Surface the reason instead of retrying.
- **One question at a time.** When gathering args, don't dump a form.
- **No batch dispatch.** Each invocation is a single op. If the user wants to run three ops, invoke the skill three times.
- **No version bumps opportunistically.** `bump-version` is the only path that changes `version:` outside of `advance`. Don't sneak a version change into another op.
- **Don't suppress errors.** If the script returns `{ ok: false }`, tell the user exactly why.
