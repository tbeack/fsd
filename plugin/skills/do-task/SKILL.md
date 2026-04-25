---
name: do-task
description: Execute or plan an FSD task by identifier. Reads `planning/to do/todo.md`, finds the entry, and either drafts the missing `task-fsd-NNN.md` plan or executes the existing one (verify ACs, mark complete in both the task file and todo.md). Use when the user says "do FSD-004", "execute FSD-031", "work on task FSD-007", or similar — anything that names an FSD-NNN identifier and asks to make progress.
argument-hint: `<FSD-NNN | NNN | N>`
---

# Do FSD Task Skill

You help the user make progress on a single FSD task identified by its
`FSD-NNN` number. The skill is **mode-switching**:

- **Plan mode** — task entry exists in `planning/to do/todo.md` but no
  `task-fsd-NNN.md` workup file exists yet. Draft the plan (no code).
- **Execute mode** — both the entry and the task file exist. Implement
  the plan, run the verification suite, mark each AC `[x]`
  progressively as it passes, write the CHANGELOG entry the plan
  calls for, mark the entry complete in `todo.md`. Stop before
  committing — let the user trigger commits separately.

The skill is the natural follow-on to `add-task` (which captures
the entry) and pairs with the existing `execute` skill (which provides
the TDD discipline this skill borrows from in execute mode).

## Step 1: Resolve the task identifier

Read `$ARGUMENTS` and normalize to canonical form `FSD-NNN`:

| Input | Canonical |
|-------|-----------|
| `FSD-004` | `FSD-004` |
| `fsd-4`   | `FSD-004` |
| `004`     | `FSD-004` |
| `4`       | `FSD-004` |

Always 3-digit zero-padded with uppercase `FSD-` prefix. If
`$ARGUMENTS` is empty, ask:
> "Which FSD task? (e.g., FSD-004)"

Do not guess. Do not pick "the next open one" without being asked.

## Step 2: Verify the task exists in the tracker

Read `planning/to do/todo.md`. Find the line containing the canonical
`FSD-NNN` identifier under the `## Backlog` list.

- **Not found** — Tell the user the task isn't in the tracker and
  suggest `/fsd:add-task` to create it first. Stop.
- **Already checked (`- [x]`)** — Tell the user it's marked complete.
  Ask whether to re-execute (rare; usually a mistake). Default: stop.
- **Open (`- [ ]`)** — Continue.

## Step 3: Branch on whether the task file exists

Check for `planning/to do/task-fsd-NNN.md`.

- **File missing** → go to Step 4 (Plan mode).
- **File exists** → read it end-to-end first. If it has no `## Plan`
  section or no `## Acceptance Criteria`, treat it as incomplete and
  continue in Plan mode (ask the user to confirm before overwriting).
  Otherwise, go to Step 5 (Execute mode).

State the mode before continuing: "Task file missing — entering plan
mode" or "Task file found — entering execute mode."

## Step 4: Plan mode — draft the workup

Mirror the detail-mode flow of `add-task`. Ask these questions
**one at a time** (not all at once):

1. **Source** — Where did this task come from? (skip if not applicable)
2. **Summary** — What needs to change and why? 1–3 sentences.
3. **Assessment** — Current state? Where does the relevant code live?
   Inspect the repo before asking the user — don't ask things you
   could verify yourself.
4. **Plan** — Step-by-step implementation. File paths and line
   numbers where possible. Group into phases if non-trivial.
5. **Acceptance Criteria** — `- [ ]` checkboxes. Falsifiable
   ("validateSpec exported and returns valid for minimal artifact"),
   not vague ("works correctly").

If the user says "use your best judgment" or "fill it in", proceed
without blocking — infer reasonably from the title and repo context.

Write `planning/to do/task-fsd-NNN.md` using this template:

```markdown
# FSD-NNN — [Task Title]

## Source
[Where the task came from — or omit this section if not applicable]

## Summary
[1–3 sentences: what's changing and why]

## Assessment
[Current state of the relevant code/content. Does it exist? Where? What needs to change?]

**Location:** `[file path]` — [section/line reference]

## Plan

1. [Step one]
2. [Step two]

## Acceptance Criteria
- [ ] [Verification step 1]
- [ ] [Verification step 2]
```

Update the `todo.md` entry to add the link to the new task file:

- Before: `- [ ] \`FSD-NNN\` — [Title]`
- After:  `- [ ] \`FSD-NNN\` — [Title] ([task-fsd-NNN](task-fsd-NNN.md))`

Use `Edit` with unique surrounding context. Match the existing style
of other linked entries in the file (em-dash, backtick-wrapped
identifier, parenthesized link).

**Stop here.** Tell the user the plan is ready at
`planning/to do/task-fsd-NNN.md` and that they can re-invoke
`/fsd:do-task FSD-NNN` to execute it. Do **not** start implementing.

## Step 5: Execute mode — implement the plan

### 5a. Review critically before touching code

Read the task file end-to-end. Identify any concerns — ambiguous
steps, missing context, dependencies on uncommitted work, factual
claims about the codebase that no longer hold (file paths moved,
exports renamed, etc.). If anything is unclear, raise it with the
user before starting. Do not guess.

### 5b. Build a working task list

Use `TaskCreate` to add one task per phase or per major step in the
plan. Mark each as `in_progress` before starting and `completed`
when its verification passes — don't batch.

### 5c. Implement the plan steps

Follow the plan's steps in order. When the plan provides a TDD cycle,
follow it; otherwise run the relevant test file after each meaningful
change so regressions surface early instead of piling up.

If the plan turns out to be wrong, **stop and re-plan with the user**
rather than silently deviating. Authorization stands for the scope
specified, not beyond.

### 5d. Run the verification suite

Once implementation is complete, run **every** verification surface
the plan calls for, plus the project's standard checks. For an FSD
task that typically means at minimum:

- `bash plugin/tests/run-tests.sh` — full test suite
- `node plugin/scripts/validate.js plugin` — schema validation across
  scannable kinds
- `node plugin/scripts/validate.js plugin --artifacts` — if the task
  touches storage-kind content

Plus any task-specific commands the plan names (smoke probes, CLI
end-to-end runs, etc.). Capture the output. If anything fails, stop
and report — do not skip ahead to AC marking.

### 5e. Verify acceptance criteria one-by-one

Walk through every AC in the task file and prove it with evidence
from Step 5d's runs (or a fresh probe if a particular AC needs one).
Print a verdict per AC: PASS with the evidence, or FAIL with what
broke.

As each AC passes, edit `planning/to do/task-fsd-NNN.md` to flip its
`- [ ]` to `- [x]`. **Mark them progressively**, not in a batch at
the end — that way a partial failure leaves an honest record of what
actually verified. Do not mark an AC verified that you did not
actually verify.

`Edit` requires unique surrounding context, and many AC lines share
the same `- [ ]` prefix — so include enough of the AC's text in the
`old_string` to make the match unambiguous. For tasks where a single
edit per AC is wasteful (≥3 ACs verified together at the end of a
phase), it's acceptable to replace the entire AC block in one Edit
call, provided you've already proven each AC individually with
evidence in this same step.

When all ACs are marked `[x]`, add a single header note immediately
above the AC list:

```
All criteria verified YYYY-MM-DD before commit.
```

If any AC fails, stop and report. Never edit the AC text to make it
pass.

### 5f. Update CHANGELOG.md

Once **all** ACs are marked `[x]`:

1. If the plan specifies a version bump and CHANGELOG content, write
   exactly that. Place the new entry above the most recent version
   block in `CHANGELOG.md`, matching the existing Keep-a-Changelog
   format (`## [X.Y.Z] - YYYY-MM-DD` with `### Added` / `### Changed`
   / `### Compatibility` subsections as appropriate).
2. If the plan does **not** specify CHANGELOG content (e.g., a task
   that doesn't ship publicly-visible changes — internal refactor,
   docs-only, planning churn), propose a one-paragraph entry to the
   user and wait for approval before writing. When in doubt, ask.
3. If the plan calls for a version bump, also update the version in
   `plugin/.claude-plugin/plugin.json` and the README header line, so
   all three sources stay aligned.

### 5g. Mark the task complete in todo.md

In `planning/to do/todo.md`, change the entry's `- [ ]` to `- [x]`.
Use `Edit` with unique surrounding context so the change is surgical.
Do not reorder lines or touch other entries.

### 5h. Hand off — do not auto-commit

Tell the user: implementation complete, ACs verified, CHANGELOG
updated, todo.md marked done. Suggest the commit boundaries the plan
calls for (if any), but **wait for the user to say "commit and push"**
before doing so. The user owns the release decision.

## Conventions to Match

- **Identifier format:** Always canonical `FSD-NNN` (3 digits, leading
  zeros, uppercase prefix) in messages, file names, and edits.
- **Task file location:** `planning/to do/task-fsd-NNN.md`.
- **todo.md edit shape:** Single line, em-dash separator,
  backtick-wrapped identifier, parenthesized link in detail mode.
- **AC checkbox style:** `- [ ]` / `- [x]`, matching existing files.
- **One question at a time** in plan mode — don't dump a form.

## Guardrails

- **Always read `planning/to do/todo.md` first** — do not infer
  whether a task exists or its state from memory.
- **Don't switch tasks mid-flow** — if the user changes their mind,
  re-invoke the skill with the new identifier.
- **Plan mode never writes code** — only the workup file and the
  todo.md link update. Stop and let the user re-invoke for execute.
- **Execute mode never edits the plan to match the implementation** —
  if reality drifts from the plan, raise it; don't quietly rewrite
  ACs to be passable.
- **Never mark an AC complete without evidence** — a command output,
  file location, or test result must back every `- [x]`.
- **Mark ACs progressively, not in a batch** — flip each `[ ]` to
  `[x]` as it passes, so a partial failure leaves an honest record.
- **Don't write a CHANGELOG entry the plan didn't anticipate without
  asking.** If the plan specified the entry, write it as-is. If it
  didn't, propose the wording and wait for user approval — surprise
  CHANGELOG churn is hard to undo cleanly.
- **Don't bump versions opportunistically** — only when the plan
  explicitly calls for it. When you do bump, keep all three sources
  aligned (`plugin.json`, README header, CHANGELOG).
- **Don't auto-commit or push.** Stop after marking complete and let
  the user trigger the release step.
- **Don't run destructive git operations** (force push, hard reset,
  branch delete) at any point. The skill is additive only.
