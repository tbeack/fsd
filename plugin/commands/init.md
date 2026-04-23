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
- `.fsd/skills/` — project-specific skills (highest priority, committed to git)
- `.fsd/agents/` — project-specific agents
- `.fsd/commands/` — project-specific commands

The `skills/`, `agents/`, and `commands/` directory names are configurable via the `structure:` section in `config.yaml`. To change them safely after init, use `/fsd-restructure` — it previews renames, flags stale references, and rewrites config.

If `.fsd/` already exists, tell the user and suggest `/fsd:config` to view or edit the existing configuration.
