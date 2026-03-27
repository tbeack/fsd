# FSD Evolution Recommendations

**Date:** 2026-03-26
**Purpose:** Map the meta framework research findings against FSD's current state and define a concrete evolution path.

---

## 1. Current FSD State Summary

FSD is an early-stage (v0.1.0) Claude Code plugin with a clean, minimal design:

- **5 skills** (brainstorm, plan, execute, verify, debug)
- **2 agents** (explorer, reviewer)
- **3 commands** (/fsd:init, /fsd:add, /fsd:list)
- **1 hook** (SessionStart for content display)
- **Core innovation:** Three-layer content resolution (core → user → project) with name-based shadowing
- **Tech:** Node.js with zero npm dependencies, custom YAML parser
- **State:** Stateless (filesystem scan at runtime)
- **Config:** Shallow-merge YAML across layers

---

## 2. Strengths to Preserve

These aspects of FSD's current design are sound and should be retained:

| Strength | Why It Matters |
|----------|---------------|
| **Three-layer resolution** | Upgrade-safe by design. Neither GSD nor OpenSpec has this as cleanly |
| **Zero dependencies** | No supply chain risk, fast startup, easy to audit |
| **Stateless core** | Simple mental model, no sync bugs, git-friendly |
| **Auto-discovery** | Skills/agents/commands found by directory structure, not registration |
| **Markdown-first content** | Low barrier to create, easy to version, human-readable |
| **Plugin-native architecture** | Works within Claude Code's plugin system, not around it |
| **Test suite** | Already has unit tests for core modules |

---

## 3. Gaps Identified (Against Research Findings)

### 3.1 Critical Gaps (Must Address)

#### Gap 1: No Extension Contracts or Validation

**Current:** Frontmatter is parsed but not validated. Any YAML works. No required fields enforced.

**Risk:** As teams create skills/agents, inconsistent quality and missing fields will cause silent failures.

**Recommendation:**
- Define a schema for each content type (skill, agent, command)
- Validate frontmatter at discovery time (loader.js)
- Warn on missing required fields, error on invalid types
- Keep validation lightweight (no Zod -- use simple JS validators to maintain zero-dependency stance)

```yaml
# Skill schema (enforced)
name: string (required)
description: string (required, min 20 chars)
# Agent schema (enforced)
name: string (required)
description: string (required)
model: enum [sonnet, opus, haiku] (required)
tools: array of strings (required)
color: string (optional)
```

**Priority:** High. Foundation for everything else.

#### Gap 2: No Content Package/Import System

**Current:** `/fsd:add` creates content from templates. No way to import from external sources.

**Risk:** Teams cannot share skills across projects or organizations. Every project starts from scratch.

**Recommendation:** Implement git-based content imports:

```bash
/fsd:import skill github.com/team/fsd-skills#api-review
/fsd:import agent github.com/team/fsd-agents#security-scanner@v2.1
```

Implementation:
1. Add `imports.lock` to track imported content (source URL, ref, hash)
2. Import into user or project layer (respects three-layer model)
3. `/fsd:upgrade` checks for upstream changes
4. `/fsd:diff` compares local overrides against imported originals

**Priority:** High. This is the team scalability enabler.

#### Gap 3: No Workflow Orchestration

**Current:** Skills exist independently. No mechanism to chain them (brainstorm → plan → execute → verify).

**Risk:** Users must manually invoke each skill in sequence. No enforcement of prerequisites.

**Recommendation:** Add lightweight workflow support:

```yaml
# .fsd/config.yaml or core config
workflows:
  default:
    steps: [brainstorm, plan, execute, verify]
    optional: [brainstorm]
  quick:
    steps: [plan, execute]
  review:
    steps: [verify, debug]
```

Implementation:
- `/fsd:workflow [name]` starts a named workflow
- Track current step in a minimal state file (`.fsd/.state.yaml`)
- `/fsd:next` advances to the next step
- Steps are advisory, not blocking (users can skip)
- Keep it simple -- no DAG, no parallel execution yet

**Priority:** Medium-High. Distinguishes FSD from a loose skill collection.

#### Gap 4: Configuration Lacks Team/Org Tiers

**Current:** Three tiers (core, user, project). No organization or team level.

**Risk:** Companies with multiple teams and projects duplicate configuration across every project.

**Recommendation:** Add two optional tiers:

```
Resolution order:
  core → org (~/.fsd/org/{name}/) → team → user (~/.fsd/) → project (.fsd/)
```

Implementation:
- Organization config: `~/.fsd/org/{org-name}/config.yaml` + skills/agents/commands
- Team config: `~/.fsd/org/{org-name}/teams/{team-name}/config.yaml` + content
- Active org/team set in user config or environment variables
- Content resolution adds these layers between core and user
- Org/team content can be git repos cloned to the conventional path

**Priority:** Medium. Important for team scaling, but can wait until import system exists.

### 3.2 Important Gaps (Should Address)

#### Gap 5: No Context Engineering

**Current:** No awareness of context windows, no agent orchestration beyond Claude Code's native Task tool.

**GSD's insight:** Fresh context per agent prevents degradation. Budget-aware orchestration matters.

**Recommendation:** Add context-aware patterns to skill definitions:

```yaml
# In skill frontmatter
context_strategy: fresh    # fresh | shared | minimal
max_context_pct: 30        # Suggest max context budget for this skill
delegates_to:              # Agents this skill typically spawns
  - explorer
  - reviewer
```

This is metadata, not enforcement -- skills use it to guide their own orchestration prompts. The execute skill, for example, would instruct Claude to spawn fresh agents for each task rather than executing everything in the main context.

**Priority:** Medium. Becomes critical when workflows involve multiple agent handoffs.

#### Gap 6: No Model Profile System

**Current:** Agents specify a model in frontmatter. No project-wide cost management.

**GSD's approach:** quality/balanced/budget/inherit profiles that map agent types to model tiers.

**Recommendation:** Add model profiles to config:

```yaml
# .fsd/config.yaml
model_profiles:
  quality:
    planning: opus
    execution: opus
    review: sonnet
    exploration: sonnet
  balanced:
    planning: opus
    execution: sonnet
    review: sonnet
    exploration: haiku
  budget:
    planning: sonnet
    execution: sonnet
    review: haiku
    exploration: haiku

active_profile: balanced
```

Agent frontmatter would use role-based model selection:
```yaml
model: ${profile.exploration}  # Resolved at runtime from active profile
```

**Priority:** Medium. Important for cost control as usage scales.

#### Gap 7: No Deep Merge for Config

**Current:** Shallow merge means a project config that sets one key loses all other user/core keys at that level.

**Risk:** Surprising behavior when teams layer configs. A project that adds one `disabled` item loses all org-level disabled items.

**Recommendation:** Implement strategic merge:
- Scalar values: last writer wins (current behavior)
- Arrays: concatenate with dedup (not replace)
- Objects: recursive merge (not shallow)
- Add `!replace` prefix for explicit full replacement when needed

```yaml
# Project config
disabled:
  - "skills/brainstorm"     # Added to, not replacing, org disabled list
disabled!replace:            # Alternative: explicit full replacement
  - "skills/brainstorm"
```

**Priority:** Medium. Becomes critical with org/team tiers.

### 3.3 Future Gaps (Plan For, Build Later)

#### Gap 8: No Session Continuity

**Current:** Stateless. No concept of "resume where I left off."

**GSD's approach:** STATE.md, HANDOFF.json, pause/resume commands.

**Recommendation:** Plan for but don't build yet. When workflows exist, add:
- `.fsd/.state.yaml` with current workflow position
- `/fsd:pause` and `/fsd:resume` commands
- Minimal -- just enough to know "I was on step 3 of the default workflow in this project"

**Priority:** Low (until workflows exist).

#### Gap 9: No Governance/Security Features

**For teams at scale:**
- Approved skill registries (org can whitelist/blacklist skills)
- Model usage policies (org can restrict model tiers)
- Cost budgets (per-project token limits)
- Audit logging (what skills/agents were invoked)

**Recommendation:** Design the config schema to accommodate these later:
```yaml
# Org config (future)
governance:
  approved_sources: [github.com/our-org/*]
  model_policy:
    max_tier: sonnet  # No opus allowed
  audit: true
```

**Priority:** Low (plan for in schema, build when needed).

#### Gap 10: Multi-Runtime Support

**Current:** Claude Code only.

**OpenSpec supports 24 tools. GSD supports 8.**

**Recommendation:** The three-layer architecture already enables this conceptually. Content is markdown. The only Claude Code-specific parts are:
- `hooks/hooks.json` format
- Agent frontmatter fields (model, tools, color)
- Command frontmatter fields

To support other tools later:
- Keep content format generic (markdown with YAML frontmatter)
- Isolate Claude Code-specific behavior in adapter modules
- Document the content contract so adapters know what to map

**Priority:** Low. Focus on Claude Code excellence first.

---

## 4. Recommended Evolution Roadmap

### Phase 1: Foundation Hardening (Current → v0.2)
**Goal:** Make the core robust enough for teams to build on.

1. **Frontmatter schema validation** -- Define and enforce schemas for skills, agents, commands
2. **Deep merge for config** -- Array concatenation, recursive object merge
3. **Config schema documentation** -- Formalize supported keys and types
4. **`/fsd:validate`** -- Command to check all content in all layers for schema compliance
5. **Improve `/fsd:list`** -- Show layer source, validation status, override indicators

### Phase 2: Sharing & Import (v0.2 → v0.3)
**Goal:** Enable teams to share and reuse content across projects.

1. **Git-based import system** -- `/fsd:import` with URL + ref + path
2. **`imports.lock`** -- Version pinning for imported content
3. **`/fsd:upgrade`** -- Check and apply upstream updates
4. **`/fsd:diff`** -- Compare overrides against originals
5. **`/fsd:export`** -- Package project content for sharing

### Phase 3: Workflow Engine (v0.3 → v0.4)
**Goal:** Chain skills into composable workflows.

1. **Workflow definitions in config** -- Named step sequences
2. **`/fsd:workflow`** -- Start a named workflow
3. **`/fsd:next`** -- Advance to next step
4. **Minimal state tracking** -- `.fsd/.state.yaml` for workflow position
5. **Context strategy metadata** -- In skill frontmatter

### Phase 4: Team Scaling (v0.4 → v0.5)
**Goal:** Support organization and team-level configuration.

1. **Org/team config tiers** -- Additional resolution layers
2. **Model profiles** -- Cost management across agent types
3. **`/fsd:config`** -- Interactive config editor across tiers
4. **Governance primitives** -- Approved sources, model policies (schema only)

### Phase 5: Advanced Orchestration (v0.5 → v1.0)
**Goal:** Sophisticated workflow execution for complex projects.

1. **Parallel execution support** -- Wave-based task scheduling
2. **Session continuity** -- Pause/resume workflows
3. **Context budget management** -- Agent context allocation
4. **Audit logging** -- Track skill/agent invocations
5. **Multi-runtime adapters** -- Support beyond Claude Code

---

## 5. Architectural Decisions

### Decision 1: Stay as a Claude Code Plugin (Not a Standalone CLI)

**GSD** is installed via its own CLI. **OpenSpec** is a standalone npm package.

**Recommendation: Stay as a plugin.** Reasons:
- Plugin auto-discovery means zero config for basic usage
- Leverages Claude Code's native command, skill, and agent systems
- No separate install step beyond plugin registration
- Three-layer resolution already provides the abstraction OpenSpec's CLI does
- Can always extract a CLI later if needed

### Decision 2: Keep Zero Dependencies

**OpenSpec** uses Zod, Commander, fast-glob, etc. **GSD** uses Node.js + bundled modules.

**Recommendation: Maintain zero npm dependencies.** Reasons:
- Faster startup (matters for SessionStart hook)
- No supply chain risk
- Simpler distribution as a plugin
- Custom YAML parser is sufficient for config needs
- Validation can be done with plain JS

### Decision 3: Stateless by Default, Stateful by Opt-In

**GSD** is always stateful (STATE.md). **OpenSpec** uses file-existence state.

**Recommendation: Default stateless, add state only for workflows.**
- Content resolution: Always stateless (scan filesystem)
- Config: Always stateless (merge on load)
- Workflows: Minimal state file only when a workflow is active
- No state file = no workflow in progress (clean default)

### Decision 4: Content-First, Not Workflow-First

**GSD** is workflow-first (everything serves the discuss→plan→execute pipeline).
**OpenSpec** is spec-first (everything serves the specification lifecycle).

**Recommendation: FSD should be content-first.**
- The core value is the three-layer resolution of skills, agents, and commands
- Workflows are one way to compose content, not the only way
- Teams should be able to use FSD purely for content management without workflows
- This keeps FSD a true "meta-framework" rather than an opinionated development methodology

### Decision 5: Extension Contracts Over Convention

**Both GSD and OpenSpec** rely heavily on convention. Content "works" because files are in the right place with the right name.

**Recommendation: Add formal contracts (schemas) on top of conventions.**
- Keep convention-based discovery (auto-find by directory structure)
- Add schema validation as a quality layer
- Validated content gets a "verified" indicator in `/fsd:list`
- Invalid content still loads (with warnings) -- don't break existing setups
- This enables a future marketplace/registry with quality guarantees

---

## 6. Summary: What FSD Gets Right That Others Don't

| FSD Advantage | vs GSD | vs OpenSpec |
|--------------|--------|------------|
| **Upgrade-safe three-layer resolution** | GSD has no layering; updates risk overwriting customizations | OpenSpec separates CLI from output but doesn't layer user content |
| **Plugin-native** | GSD installs alongside Claude Code, not within it | OpenSpec generates files but isn't a plugin |
| **Content-agnostic** | GSD's content serves its workflow | OpenSpec's content serves its spec model |
| **Zero dependencies** | GSD bundles a 17-module Node.js toolkit | OpenSpec has 10+ npm dependencies |
| **Simple mental model** | GSD has 44 commands and a learning curve | OpenSpec requires understanding artifact graphs |

**FSD's strategic position:** A lightweight, extensible content management layer that teams can build on top of -- whether they adopt GSD-style workflows, OpenSpec-style spec management, or their own approach. The three-layer resolution is the moat. Everything else should serve making that system more powerful, more shareable, and more team-friendly.
