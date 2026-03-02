---
name: fsd:init
description: Initialize .fsd/ project space in the current directory
---

Initialize an FSD project space in the current directory by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.js"
```

Report the result to the user. If initialization succeeds, explain:
- `.fsd/config.yaml` — project config (edit to customize workflow, disable/require content)
- `.fsd/skills/` — project-specific skills (highest priority, committed to git)
- `.fsd/agents/` — project-specific agents
- `.fsd/commands/` — project-specific commands

If `.fsd/` already exists, tell the user and suggest `/fsd:config` to view or edit the existing configuration.
