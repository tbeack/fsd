---
name: execute-plan
argument-hint: `[plan-id]`
description: Stateful plan executor. Consumes an approved plan artifact, walks its `- [ ] **Phase NN**` inline checkboxes, runs per-phase verification commands resolved in the order phase-body-hint → plan frontmatter `verification:` → PROJECT.md `verification:` → ask engineer, progressively flips phase + acceptance checkboxes as each passes, and closes out the full pipeline behind one final ACK — CHANGELOG entry, version alignment across `plugin.json` + README + CHANGELOG, todo.md task flip, plan `status → archived`, linked spec `approved → true` (if still false), optional `ARCHITECTURE.md` ADR appends. No auto-commit; engineer owns the release boundary.
---

# FSD Execute Plan Skill

You drive implementation of an approved plan artifact end-to-end. The plan is the contract; your job is to walk its phases, prove each one with verification evidence, mark progress in the plan file itself, and — after a single final ACK — land the close-out pipeline (CHANGELOG, version bump, plan archive, spec approve, todo.md flip, optional ADRs).

This skill pairs with `/fsd:plan` (FSD-008) and `/fsd:plan-update` (FSD-015): `/fsd:plan` writes the plan, `/fsd:plan-update` surgically edits it, and `/fsd:execute-plan` consumes it to completion.

**Non-negotiables.** No silent execution. No skipping the pre-flight gate. No flipping a checkbox without evidence. No auto-commits. No edits to make verification pass. See Guardrails at the bottom — all of them are load-bearing.

## Step 1: Preconditions

### 1a. PROJECT.md must be present and valid

```bash
node -e '
const { loadProjectContext } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
const path = require("path");
const ctx = loadProjectContext({ planningDir: path.join(process.cwd(), "planning") });
process.stdout.write(JSON.stringify(ctx));
'
```

- **`ctx.project === null`** → abort: "PROJECT.md not found — run `/fsd:new-project` first, then re-invoke `/fsd:execute-plan`." Do NOT chain-invoke `/fsd:new-project` from here (unlike `/fsd:plan`, the executor does not bootstrap project scaffolding).
- **`ctx.project.validation.valid === false`** → abort with errors verbatim; suggest `/fsd:validate`.

### 1b. Resolve the plan id

Parse `$ARGUMENTS`. The first whitespace-separated token, if present, is the plan id.

- **Plan id provided** → continue with that id.
- **Plan id not provided** → list non-archived plans and ask which one:

  ```bash
  node -e '
  const { scanArtifacts } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/loader.js");
  const { loadConfig, resolveLayerPaths, getStructure } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/config.js");
  const path = require("path");
  const config = loadConfig(resolveLayerPaths());
  const dirName = getStructure(config).plan;
  const plans = scanArtifacts({ fsdDir: path.join(process.cwd(), ".fsd"), kind: "plan", dirName });
  const pick = plans.filter(p => p.status !== "archived").map(p => ({ id: p.id, title: p.title, status: p.status }));
  process.stdout.write(JSON.stringify(pick, null, 2));
  '
  ```

  Render the list as `<id> — <title> (<status>)` and ask: "Which plan should I execute?". Do not guess.

### 1c. Precondition check

```bash
node -e '
const { checkPlanPrecondition } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/plan.js");
const path = require("path");
const fsdDir = path.join(process.cwd(), ".fsd");
const result = checkPlanPrecondition({ fsdDir, planId: process.argv[1] });
process.stdout.write(JSON.stringify(result));
' "<plan-id>"
```

- **`ok: false`** → abort. Print `reason` verbatim. Refuse conditions:
  - Plan file missing → pointer to `/fsd:plan`.
  - Plan `status: archived` → pointer: "unarchive via `/fsd:plan-update` or pick another plan".
  - Plan has zero `- [ ] **Phase NN**` entries → pointer to `/fsd:plan-update`.
  - Plan has zero open `- [ ]` acceptance entries → pointer to `/fsd:plan-update`.
  - Linked spec missing or archived → pointer to spec-side remediation.
- **`ok: true` + non-empty `warnings`** → surface each warning and ask: "Proceed anyway? (yes/no)". On no, abort. Typical warnings: plan status is `draft` (executable but uncommon); linked spec `approved: false` (pipeline close-out will flip it on success).

## Step 2: Pre-flight summary + yes/no gate

Read the full plan body (already returned by `checkPlanPrecondition`). Also read `planning/ARCHITECTURE.md` if present (for the end-of-run ADR append path).

### 2a. Resolve verification commands

Discovery order (first source wins, but all phases inherit the plan-level map as fallback):

1. **Plan frontmatter `verification:`** — plan-specific override.
2. **PROJECT.md frontmatter `verification:`** — repo-wide default.
3. **Ask engineer** — prompt only if neither source provides at least `tests:`.

Per-phase, a single backtick-wrapped shell command in the phase body prefixed with `verify:` overrides the resolved default for that phase only (see Step 3).

Print which source each command came from, e.g.:
> "Verification: `tests` from plan frontmatter, `validate` from PROJECT.md."

### 2b. Summary

Print a single block showing:

- Plan title + id.
- N phases, with titles (`Phase 01 — Foo`, `Phase 02 — Bar`, ...).
- Resolved verification commands + source.
- Version target if the plan body names one (scan for `v\d+\.\d+\.\d+`), or "none — will ask at pipeline close-out".
- Linked spec id + current `approved` state.
- Linked FSD task id (from plan `task:` frontmatter) if present.
- Whether `planning/ARCHITECTURE.md` exists (so the engineer knows ADR append is available).
- The pipeline writes that will happen at the end (CHANGELOG, version bump, plan archive, spec approve, todo.md flip, optional ADRs).

### 2c. Gate

Ask **once**: "Proceed? (yes/no)". On no, stop — no writes. On yes, go to Step 3.

## Step 3: Phase execution loop

For each phase in order:

1. **Track.** `TaskCreate` one task per phase titled `Phase NN — <title>`. Mark `in_progress` before starting, `completed` after its verification passes.
2. **Announce.** Print "Entering Phase NN — `<title>`".
3. **Implement.** Follow the phase's steps in order. Apply the file changes the plan names. If a step is ambiguous, STOP and ask the engineer — never silently deviate. Authorization stands for the scope specified, not beyond.
4. **Per-phase verification.** Resolve commands:
   - If the phase body contains a backtick-wrapped shell command preceded by `verify:` (e.g. `verify: \`bash tests/phase-a.sh\``), use that.
   - Otherwise fall back to Step 2a's resolved commands.
   Run them in order; capture output.
5. **On any failure:** STOP the loop. Print the failing command, the last ~40 lines of output, and the phase number. Do NOT flip the checkbox. Do NOT move to the next phase. The engineer fixes the failure and re-invokes `/fsd:execute-plan <plan-id>` (the skill re-enters at the first open phase).
6. **On all pass:** flip the phase checkbox via the plan-update CLI:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-update.js" \
     "$(pwd)/.fsd" flip-phase --id=<plan-id> --phase-number=NN
   ```

   Verify `{ ok: true }`. Mark the `TaskCreate` entry `completed`.
7. **ADR capture.** While the phase runs, watch the engineer's chat messages for a line starting `adr:` (e.g. `adr: use atomic tmp+rename for plan flips`). Capture the title into an in-memory scratch list — do NOT prompt for Context / Decision / Consequences yet; that happens at Step 5.

After the **last** phase passes, run the full verification suite once more (every resolved command, not just the phase's subset) as a regression check. On failure, STOP and surface.

## Step 4: Acceptance walkthrough

Read the plan's `## Acceptance` section. For each `- [ ]` line:

1. Print the AC text verbatim.
2. Produce **concrete evidence**: a test command's stdout, a file path + grep, a direct probe. Never write "I believe this works" — the evidence must be something a skeptical reader could re-run.
3. On **pass**: flip the AC via the plan-update CLI:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-update.js" \
     "$(pwd)/.fsd" flip-ac --id=<plan-id> --line-matcher="<unique AC substring>"
   ```

   Verify `{ ok: true }`. Print `PASS — <evidence>`.
4. On **fail**: STOP. Print `FAIL — <what broke>`. Do NOT flip. Do NOT proceed to Step 5. Do NOT edit the AC text to make it pass.

After every AC is `[x]`, insert a single header line immediately above the AC list:

```
All criteria verified YYYY-MM-DD before commit.
```

Use a single `Edit` call against the plan file.

## Step 5: Pipeline close-out — single ACK gate

Assemble a preview of everything that will land, then ask for one yes/no before any of it runs. No silent application.

### 5a. Assemble the close-out preview

1. **Version target.** Scan the plan body for `v\d+\.\d+\.\d+` in a release-style section. If present, name the three sources that will be aligned: `plugin/.claude-plugin/plugin.json`, README header line, CHANGELOG heading. If absent, ask: "The plan doesn't name a target version. Skip the version bump, or specify one now?".
2. **CHANGELOG entry.** If the plan body prescribes specific CHANGELOG content, preview it verbatim. Otherwise, draft a one-paragraph entry from the phase titles + ACs and ask the engineer to approve or edit before Step 5b runs.
3. **Plan archive.** Current status → `archived` via `plan-update.update target=status value=archived` (status flip is implicit in the archive path; see Step 5b).
4. **Spec approve.** Only if the linked spec is currently `approved: false`. Otherwise skip silently.
5. **todo.md flip.** Only if the plan `task:` frontmatter is set. Resolve the line matching `` `FSD-NNN` `` in `planning/to do/todo.md` and flip `- [ ]` → `- [x]` via a single `Edit` with unique surrounding context.
6. **ADR appends.** Show the scratch-list titles collected during Step 3. For each, prompt the engineer inline for `Context`, `Decision`, and `Consequences` — or let them skip the entry. Never auto-fill.

### 5b. ACK

Ask **once**: "Apply the above? (yes / no / edit <field>)". On no, stop — the phase + AC checkbox flips from Steps 3 + 4 stay as they are (they're the honest record of what verified).

On yes, execute in order. Each write is independent; a later failure prints but does not roll back earlier writes:

1. Write the CHANGELOG entry. Append above the most-recent `## [X.Y.Z]` block, Keep-a-Changelog format.
2. Align version sources. Update `plugin/.claude-plugin/plugin.json`, the README header line (`**Version X.Y.Z**`), and the CHANGELOG heading.
3. Flip the linked FSD task `[x]` in `planning/to do/todo.md`.
4. Archive the plan:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/plan-update.js" \
     "$(pwd)/.fsd" archive --id=<plan-id>
   ```

5. Approve the linked spec (only if currently unapproved):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/spec-update.js" \
     "$(pwd)/.fsd" approve --id=<spec-id>
   ```

6. For each confirmed ADR:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/architecture.js" \
     "$(pwd)/planning" append-decision \
     --title="<title>" \
     --context="<context>" \
     --decision="<decision>" \
     --consequences="<consequences>"
   ```

### 5c. Post-flight summary

Print a single block:

- What landed (one line each).
- What was skipped (version bump not requested, no spec approve needed, no ADRs, etc.).
- Any write that failed.

## Step 6: Handoff

Print the commit boundary list from the plan body (often a Phase H-style release section) if present. Otherwise suggest a single commit covering the current diff.

Remind the engineer:

- "Review with `git diff`, commit at your discretion, then `git push origin main` when ready."
- "Do NOT auto-commit or push — you own the release boundary."

Run only read-only `git status` / `git diff` if you want to sanity-check the working tree. Do not run any git command that mutates state.

## Conventions to match

- **Plan id** — the first positional `$ARGUMENTS` token. If absent, list + ask.
- **Phase checkbox format** — `- [ ] **Phase NN** — <title>` at the top level of `## Phases`. Two-digit zero-padded. The `parsePhases` helper (in `plan-update.js`) is the single source of truth for matching; do not invent another parser.
- **AC flip matcher** — a short, unambiguous substring from the AC text. `flipAcceptance` substring-matches in `## Acceptance` only.
- **Verification discovery order** — phase-body `verify:` hint > plan frontmatter `verification:` > PROJECT.md `verification:` > ask engineer.
- **ADR capture prefix** — chat messages starting `adr:` during Step 3 are captured as scratch-list titles; full Context/Decision/Consequences are gathered at Step 5.
- **No chain-invoke of `/fsd:new-project`** — unlike `/fsd:plan`, the executor aborts when PROJECT.md is missing.

## Guardrails (non-negotiable)

- **Never skip the pre-flight summary or the yes/no gate.** No silent execution.
- **Never proceed past a failing phase verification.** Stop, surface, let the engineer decide.
- **Never flip a phase checkbox** without its verification passing end-to-end.
- **Never flip an AC checkbox** without concrete evidence — a test output, a file probe, or an equivalent observable.
- **Never edit the plan body** to make verification easier (changing phase titles, rewriting steps, softening constraints).
- **Never edit AC text** to make it pass. If an AC can't be satisfied, stop and raise it.
- **Never auto-commit, auto-push, or run destructive git operations** (`reset --hard`, `push --force`, branch delete, etc.).
- **Never apply pipeline close-out ops without the final ACK.** The phase + AC checkbox flips from Steps 3 + 4 are the only writes that can happen before Step 5b.
- **Never bump a version the plan doesn't name** — ask the engineer if the plan body is silent on a target.
- **Never append to `ARCHITECTURE.md` without the engineer confirming** the full Context / Decision / Consequences content. No silent ADR writes.
- **Never drop the linked-spec check.** Archived or missing spec → stop.
- **Never execute an archived plan.** The precondition refuses; the skill must honor that.
