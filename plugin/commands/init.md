---
name: fsd:init
description: Initialize .fsd/ project space in the current directory
---

Initialize an FSD project space in the current directory by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js"
```

Report the result to the user. If initialization succeeds, explain:

- `.fsd/config.yaml` — project config (edit to customize workflow, disable/require content, rename content directories)

Scannable kinds (activated by the framework at session start):
- `.fsd/skills/` — project-specific skills (highest priority, committed to git)
- `.fsd/agents/` — project-specific agents
- `.fsd/commands/` — project-specific commands

Storage kinds (artifacts produced by the corresponding skills):
- `.fsd/spec/` — specs written by `/fsd-spec`
- `.fsd/plan/` — plans written by `/fsd-plan`
- `.fsd/research/` — research notes written by `/fsd-research`

All six directory names are configurable via the `structure:` section in `config.yaml`. To change any of them safely after init, use `/fsd-restructure` — it previews renames, flags stale references, and rewrites config.

Files in the storage-kind directories follow a documented frontmatter schema (see the **Artifact Schemas** section in the README). Use `/fsd:validate --artifacts` to check them on demand.

If `.fsd/` already exists, tell the user and suggest `/fsd:config` to view or edit the existing configuration.
