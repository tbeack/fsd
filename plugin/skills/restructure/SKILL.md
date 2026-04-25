---
name: restructure
description: Rename content-kind directories inside the project's `.fsd/` space (scannable kinds skills/agents/commands, or storage kinds spec/plan/research) and update `config.yaml` so the loader, add, list, validate, session-start hook, and artifact-producing skills all see the new layout. Use when the user wants to reshape their FSD project directory structure after install — e.g. rename `skills/` to `capabilities/` or `spec/` to `specifications/`. Preview-first, confirmation-gated, flags stale references in content but does NOT auto-rewrite them.
argument-hint: `[kind=newname ...]  [--apply]  [--force]`
---

# FSD Restructure Skill

You help the user rename content-kind directories inside `.fsd/` safely. **Always preview first**, confirm with the user, then apply. Never rewrite user-authored content — only flag stale references.

## Guardrails (non-negotiable)

- **Do not skip the preview step.** The preview surfaces errors and stale references that could break user content.
- **Do not auto-rewrite the body of user files** that reference old directory names. Flag them in the confirmation step; let the user decide.
- **Refuse to run** if the repo has uncommitted changes under `.fsd/` and the user didn't pass `--force`. Renaming directories in a dirty tree risks losing work.
- **Only support the 6 known kinds**:
  - Scannable: `skills`, `agents`, `commands`
  - Storage: `spec`, `plan`, `research`
  Adding new kinds is out of scope for this skill.
- **Never rename the top-level `.fsd/` directory itself.**

## Workflow

### Step 1: Locate `.fsd/`

Use the current working directory. If `.fsd/` does not exist there, tell the user:
> "No `.fsd/` found in the current directory. Run `/fsd:init` first, or `cd` into an FSD project."

Stop.

### Step 2: Check for uncommitted changes

Run:
```bash
git status --short .fsd/ 2>/dev/null
```

If the output is non-empty and the user did not pass `--force` in `$ARGUMENTS`, tell the user:
> "The `.fsd/` tree has uncommitted changes. Commit or stash them first, or re-run with `--force` to override."

Stop.

### Step 3: Generate a preview

Run the preview script:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/restructure.js" . kind1=newname1 kind2=newname2 ...
```

Pass whatever `kind=newname` pairs the user supplied in `$ARGUMENTS`. If `$ARGUMENTS` contains no rename pairs, ask the user which kind(s) they want to rename and what the new names should be, then run the script.

### Step 4: Show the preview to the user

The script output has three sections. Relay them verbatim to the user, and add:

- **If there are errors**: show them and stop. Do not proceed to apply.
- **If there are stale references**: list each file and the matched lines, then say:
  > "These files reference the old directory name(s) in their body. I will **not** rewrite them automatically — review them after the rename to decide whether they need updating."
- **If there are no errors**: ask for confirmation:
  > "Apply these renames? (yes/no)"

### Step 5: Apply (only on explicit confirmation)

Only after the user confirms, run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/restructure.js" . --apply kind1=newname1 kind2=newname2 ...
```

The script will:
- Validate again (belt-and-braces).
- Physically rename each present directory with `fs.renameSync`.
- Rewrite `.fsd/config.yaml` with the new `structure:` block (preserving surrounding content).
- Print a one-line summary of what was renamed.

If the script reports failure, show the errors. Do not claim success.

### Step 6: Post-apply audit

After a successful apply, run `/fsd:list` (or `node "${CLAUDE_PLUGIN_ROOT}/scripts/list.js"`) to confirm the loader finds content in the new locations. Relay the output to the user.

If any content appears to have been lost (was there before, missing after), stop and warn the user — do not attempt to undo automatically. The script's own rollback only covers failure during apply; post-apply issues indicate something more complex.

## Examples

### User wants to rename `skills` → `capabilities`
```
User: /fsd:restructure skills=capabilities
You: [run git status check → clean]
You: [run preview script]
You: "Current structure:
         skills    → capabilities
         agents    (unchanged)
         commands  (unchanged)
       Rename ops: skills → capabilities
       Stale references: none
       Apply? (yes/no)"
User: yes
You: [run --apply]
You: "Applied. `.fsd/skills/` renamed to `.fsd/capabilities/`, config.yaml updated.
       Running /fsd:list to confirm..."
You: [relay /fsd:list output]
```

### User wants to rename multiple kinds
```
User: /fsd:restructure skills=capabilities agents=bots
```
Pass both pairs in a single `restructure.js` invocation.

### User has uncommitted changes
Tell them to commit/stash, or re-run with `--force`.

### User passes an invalid rename
The preview script surfaces the error (reserved name, alias, slash in path, target exists, etc.). Relay it and stop. Do not attempt to apply.

## What this skill does NOT do

- Does not add new content kinds (add a `docs/` subdirectory, etc.)
- Does not rename the top-level `.fsd/` directory
- Does not rewrite user-authored content bodies
- Does not migrate `~/.fsd/` (user space) or the core plugin — project-level only
- Does not update `disabled:` / `required:` entries in config.yaml — those reference kinds semantically (`skills/foo`), not paths, so they survive renames unchanged
