---
name: fsd:list
description: Show all active skills, agents, and commands across layers
---

List all active FSD content by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list.js" "${CLAUDE_PLUGIN_ROOT}"
```

Display the output to the user. The list shows content resolved across three layers:
- **core** — built-in content from the FSD plugin
- **user** — personal customizations from ~/.fsd/
- **project** — team content from .fsd/ in the current project

Higher layers shadow lower layers by name (project > user > core).
