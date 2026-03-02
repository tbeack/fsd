---
name: fsd:add
description: Create a new skill, agent, or command
argument-hint: "<skill|agent|command> <name> [--project]"
---

Create new FSD content. Parse the user's arguments to determine:
- **type**: skill, agent, or command
- **name**: kebab-case name for the content
- **--project**: if specified, create in .fsd/ (project space) instead of ~/.fsd/ (user space)

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/add.js" $ARGUMENTS
```

Report the result. If successful, suggest the user edit the generated file to customize it. Mention:
- Skills: edit the SKILL.md description triggers and body content
- Agents: edit the description examples and system prompt
- Commands: edit the command instructions
