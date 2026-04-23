---
name: fsd:validate
description: Check all content across all layers for schema compliance. Run this to find invalid skills, agents, or commands.
argument-hint: "[--skills|--agents|--commands]"
---

Run schema validation on all FSD content across all three layers (core, user, project).

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js ${CLAUDE_PLUGIN_ROOT} $ARGUMENTS`

Report the output to the user exactly as printed. If there are validation errors, suggest how to fix them.
