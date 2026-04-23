---
name: fsd-new-project
description: Capture project context once — interactively gather identity, scope, tech context, success metrics, anti-goals, and an initial milestone + phase, then write `planning/PROJECT.md` and `planning/ROADMAP.md`. Use right after `/fsd:init` (or any time the repo is missing project framing). Refuses to overwrite existing files. Downstream skills (`fsd-spec`, `fsd-plan`, `fsd-research`, `fsd-execute-plan`, `fsd-ship`) read from these files, so doing this once up front makes every future session start with shared context.
argument-hint: `[--force-dir=<path>]`
---

# FSD New Project Skill

You help the user create the two project-context files the rest of the FSD
workflow reads from:

- `planning/PROJECT.md` — identity, scope, tech context, success metrics,
  anti-goals
- `planning/ROADMAP.md` — versioned milestones → numbered phases

This is a **one-time kickoff**. If either file already exists, stop — suggest
editing it directly or (once available) the dedicated `/fsd-roadmap` skill
for roadmap maintenance. Never clobber an authored file.

## Step 1: Confirm the target directory

Default target is `<cwd>/planning/`. Accept an override from `$ARGUMENTS` if
the user passed `--force-dir=<path>` (e.g. a sub-repo, a test fixture).

Check whether either target file already exists:

```bash
ls -la planning/PROJECT.md planning/ROADMAP.md 2>/dev/null
```

If **either** exists, tell the user which one is already there and stop. Do
not rewrite. Suggest editing it manually, or wait for `/fsd-roadmap`
(FSD-007) to land for incremental roadmap edits.

## Step 2: Gather PROJECT.md context — one question at a time

Ask these questions one at a time. Do not dump the full form. Let the user
say "use your best judgment" to fast-path any of them.

1. **Project name + one-line vision** — "What's this project called and what
   does it do in one sentence?"
2. **Target users** — "Who is this for? (primary audience; comma-separated
   is fine)"
3. **Scope** — "What's in-scope / out-of-scope for this project? Think in
   capabilities, not features."
4. **Tech context** — "Language, framework, key constraints we should know
   upfront?"
5. **Success metrics** — "How will we know this is working? (observable
   signals, not vanity metrics)"
6. **Anti-goals** — "What are we deliberately NOT doing? (optional — skip
   with 'none')"

Keep it conversational. If the user says "fill it in", infer reasonably from
the repo contents you've already seen this session.

Derive the frontmatter `id` from the project name as a kebab-case slug
(lowercase, hyphenated, trim punctuation). Validate it matches
`^[a-z0-9]+(-[a-z0-9]+)*$` — if the project name produces an unusable slug,
ask the user for an explicit id.

## Step 3: Gather ROADMAP.md context — one question at a time

7. **Initial milestone** — "What's the first milestone? Give me: an id (e.g.
   `v1`, `mvp`), a version number (e.g. `0.1`, `1.0`), a short name, and a
   1–2 sentence goal."
8. **First phase under that milestone** — "What's the first numbered phase?
   Give me: a phase id (e.g. `v1.1`), a title, and a one-paragraph goal."

The user may say "I'll fill in more phases later" — stop after the first
phase. Do not invent additional phases.

## Step 4: Write both files

Invoke the backing script with the gathered context. The script:

- validates the rendered frontmatter against the schemas in
  `plugin/scripts/validator.js`,
- refuses if either file already exists (belt-and-braces — Step 1 is the
  user-facing check),
- creates the `planning/` dir if needed,
- writes both files atomically.

```bash
node -e '
const { writeProjectFiles } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/new-project.js");
const result = writeProjectFiles({
  planningDir: process.argv[1],
  projectData: JSON.parse(process.argv[2]),
  roadmapData: JSON.parse(process.argv[3]),
});
process.stdout.write(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
' "<planning-dir>" '<project-json>' '<roadmap-json>'
```

Or use the `Write` tool directly if the backing script is unavailable — the
rendered frontmatter must still validate. Either way, **do not ship a file
that `validateProject` or `validateRoadmap` would reject.**

If the backing script returns `{ ok: false, reason }`, relay the reason to
the user and stop.

## Step 5: Confirm + point at the next step

On success, tell the user:

- Where the files were written (absolute or relative paths)
- Run `/fsd:validate` (or `node plugin/scripts/validate.js plugin`) to
  confirm the schemas pass end-to-end
- Once `fsd-spec` / `fsd-plan` / `fsd-research` land, those skills will
  read from these files automatically — no manual cross-referencing needed

## Conventions to match

- **Frontmatter id:** kebab-case slug. `id` matches filename stem for
  artifacts — but PROJECT.md / ROADMAP.md are *not* artifacts, so the
  filename is fixed and the id is free-form kebab-case (typically the
  project slug).
- **ROADMAP milestones:** each milestone gets a `## Milestone <id>` heading;
  the `current_milestone` frontmatter field points at one of these ids.
- **Status values:** `draft|active|archived`. Default to `active` once the
  user has answered the interview — they're committing to a real project,
  not journaling an idea.
- **ISO dates:** `YYYY-MM-DD`. Use today's date for `created` unless the
  user specifies otherwise.

## Guardrails (non-negotiable)

- **Never overwrite either file.** If either exists, stop and tell the user.
  The file-exists check happens *before* you start asking questions —
  don't let the user spend time answering only to be blocked at write time.
- **One question at a time** in the interview. Do not dump a multi-question
  form.
- **Write only to `planning/`** (or the `--force-dir` override). Do not
  scatter files under `.fsd/`; this is *planning*, not *artifact* content.
- **Do not auto-bump the roadmap version** or auto-add milestones after the
  initial write. That's `/fsd-roadmap`'s job (FSD-007).
- **Do not start writing specs or plans in the same invocation.** This skill
  captures the framing; the framing tells downstream skills what to work on
  next.
