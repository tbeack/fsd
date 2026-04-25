---
name: add-task
description: Add a new FSD task to the project task tracker at planning/to do/todo.md. Defaults to quick-add (just appends a numbered line); use `--detail` to also gather source/summary/plan/acceptance-criteria and create planning/to do/task-fsd-NNN.md. Use when the user wants to add a task, track a TODO, or capture an idea for the FSD project.
argument-hint: `[--detail] [brief task title]`
---

# Add FSD Task Skill

You help the user add new FSD tasks to the project task tracker. This skill has two modes; default is **quick-add**.

## Modes

- **Quick-add (default)** — Steps 1, 2, 3, 6 only. Appends a one-line entry to `planning/to do/todo.md`. No task file. No detail questions. Optimized for batch capture.
- **Detail mode** — All steps (1–6). Triggered by `--detail` in `$ARGUMENTS`, or explicit request ("with details", "full workup"). Gathers context and creates `planning/to do/task-fsd-NNN.md`.

If `$ARGUMENTS` starts with `--detail`, strip the flag before using the remainder as the task title.

## Step 1: Get the next FSD number

Read `planning/to do/todo.md` to find the highest existing `FSD-###` number. Increment by 1. Format as 3 digits with leading zeros (e.g., `FSD-031`, not `FSD-31`).

## Step 2: Get the task title

If the user provided a title in `$ARGUMENTS`, use that. Otherwise, ask:
> "What's the task title? (one-liner)"

## Step 3: Add the entry to todo.md

Append a new line at the end of the `## Backlog` list in `planning/to do/todo.md`.

- **Quick-add format:** `- [ ] \`FSD-NNN\` — [Title]`
- **Detail-mode format:** `- [ ] \`FSD-NNN\` — [Title] ([task-fsd-NNN](task-fsd-NNN.md))`

Use the `Edit` tool with unique surrounding context. Match the existing backtick-wrapped `` `FSD-NNN` `` style and em-dash separator already in the file.

## Step 4: Gather task details *(detail mode only)*

Ask these questions **one at a time** (not all at once):

1. **Source** — Where did this task come from? (e.g., user feedback, bug report, own idea, design doc). Skip if not applicable.
2. **Summary** — What needs to change and why? 1–3 sentences.
3. **Assessment** — Current state? Does related code/content already exist? Where?
4. **Plan** — Step-by-step implementation. Include file paths and line numbers where possible.
5. **Acceptance Criteria** — Bullet list of verification steps. Use `- [ ]` checkboxes.

If the user says "use your best judgment" or "fill it in", proceed without blocking — infer reasonably from the title and repo context.

## Step 5: Create the task file *(detail mode only)*

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

## Step 6: Confirm completion

- **Quick-add:** Tell the user the new FSD number and that the entry was added to `planning/to do/todo.md`. One line, no fanfare.
- **Detail mode:** Also mention the task file at `planning/to do/task-fsd-NNN.md`.

## Conventions to Match

- **FSD number format:** 3 digits with leading zeros (`FSD-031`, not `FSD-31`).
- **todo.md entry:** Single line with backtick-wrapped `` `FSD-NNN` ``, em-dash separator. Link to task file only in detail mode.
- **Task file location:** `planning/to do/task-fsd-NNN.md` (lowercase, hyphenated).
- **Task file heading:** `# FSD-NNN — [Title]` (em-dash, not hyphen).
- **Sections match existing tasks:** Source (optional), Summary, Assessment, Plan, Acceptance Criteria.

## Guardrails

- **Always read `planning/to do/todo.md` first** — don't guess the next FSD number.
- **Don't duplicate titles** — scan existing tasks for similar entries before creating.
- **Never add a link to a task file you haven't created** — dead links in quick-add mode are the bug this skill's default was chosen to avoid.
- **One question at a time** in detail mode — don't dump a form on the user.
- **Don't implement the task** — only create the planning artifacts. The user will implement separately.
