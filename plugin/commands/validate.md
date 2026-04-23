---
name: fsd:validate
description: Check all content across all layers for schema compliance. Run this to find invalid skills, agents, commands, or artifacts.
argument-hint: "[--skills|--agents|--commands|--artifacts|--specs|--plans|--research]"
---

Run schema validation on FSD content. By default, scans the three scannable kinds (skills, agents, commands) across all layers. Pass an artifact filter to inspect storage-kind files in the project's `.fsd/spec/`, `.fsd/plan/`, and `.fsd/research/` dirs on demand.

Filters:
- `--skills` / `--agents` / `--commands` — narrow to one scannable kind
- `--artifacts` — scan all three storage kinds in the project's `.fsd/`
- `--specs` / `--plans` / `--research` — narrow to one storage kind

Artifacts are validated on demand only — no flag means "scannable kinds only", matching the session-start loader's behavior.

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js ${CLAUDE_PLUGIN_ROOT} $ARGUMENTS`

Report the output to the user exactly as printed. If there are validation errors, suggest how to fix them.
