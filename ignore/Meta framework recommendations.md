# Meta Framework Recommendations: GSD vs OpenSpec

**Date:** 2026-03-26
**Purpose:** Evaluate GSD and OpenSpec as reference points for building a scalable meta Claude CLI framework that supports growing teams.

---

## 1. Framework Overviews

### GSD (Get Shit Done)
- **Repo:** github.com/gsd-build/get-shit-done
- **Philosophy:** Opinionated, full-lifecycle development orchestration with sophisticated context engineering
- **Scale:** 44 commands, 16 agents, 46 workflows, 5 hooks
- **Tech:** Markdown prompts + Node.js CLI utility (`gsd-tools.cjs`)
- **Integration:** Multi-runtime (8 tools) with Claude Code as primary target

### OpenSpec
- **Repo:** github.com/Fission-AI/OpenSpec
- **Philosophy:** Spec-driven development with artifact dependency graphs and delta-based change management
- **Scale:** 4-11 commands (profile-dependent), schema-based extensibility
- **Tech:** TypeScript CLI (`@fission-ai/openspec`) + generated markdown skills/commands
- **Integration:** 24 AI tool adapters, convention-based (zero runtime coupling)

---

## 2. Comparative Analysis

### 2.1 Architecture

| Dimension | GSD | OpenSpec |
|-----------|-----|---------|
| **Core model** | Prompt orchestration engine | Spec-driven artifact generator |
| **Plugin manifest** | None (installer copies files) | None (YAML schemas + CLI) |
| **State location** | `.planning/` directory | `openspec/` directory |
| **Runtime dependency** | Moderate (hooks, Task tool, slash commands) | None (generates static files) |
| **Installation** | `install.js` copies to `~/.claude/` | `npm install -g` + `openspec init` |

**Assessment:** GSD is deeply integrated into the AI tool runtime, giving it power but creating coupling. OpenSpec maintains strict separation between the CLI tool and AI tool integration, making it more portable but less capable of runtime orchestration.

### 2.2 Extensibility

| Dimension | GSD | OpenSpec |
|-----------|-----|---------|
| **Custom skills** | Agent skills injection via config paths | Custom schemas with artifact templates |
| **Custom agents** | Not supported (monolithic agent set) | Not applicable (no agent concept) |
| **Custom commands** | Add `.md` files to commands dir | Generated from workflow templates |
| **Custom hooks** | Not supported (5 built-in only) | Not supported (no hook system) |
| **Custom workflows** | Edit workflow `.md` files (fragile) | Custom profiles + schema fork |
| **Extension API** | Convention-based (no formal API) | Schema-based (YAML-defined) |
| **Package/sharing** | No package system | No package system |

**Assessment:** Neither framework has a true plugin/extension API. GSD is more powerful but less extensible -- its monolithic design means customization requires editing core files. OpenSpec's schema system is a better extensibility primitive but is limited to artifact generation workflows. **Neither framework solves the "teams creating and sharing skills/agents/commands" problem well.**

### 2.3 Team Scalability

| Dimension | GSD | OpenSpec |
|-----------|-----|---------|
| **Multi-developer** | Workstreams (namespaced `.planning/` scopes) | Parallel change folders |
| **Shared conventions** | Agent skills per project config | Shared schemas + config.yaml |
| **Branching strategy** | Configurable (none/phase/milestone) | Not managed |
| **Conflict resolution** | Git only | Sequential archive merge |
| **Role-based access** | None | None |
| **Shared skill libraries** | None | None |
| **CI/CD integration** | None built-in | `--tools none` for non-interactive init |

**Assessment:** Both frameworks are fundamentally single-developer tools with team affordances bolted on. GSD's workstream model is more mature for parallel work. OpenSpec's change isolation is simpler but effective. **Neither provides the organizational-scale primitives needed for growing teams** (shared registries, role-based customization, cross-project skill libraries).

### 2.4 Claude Code Evolution Resilience

| Dimension | GSD | OpenSpec |
|-----------|-----|---------|
| **Coupling to internals** | Moderate (hooks, Task tool, @-references) | Minimal (file conventions only) |
| **Breaking change surface** | Large (44 commands, 16 agents, 5 hooks) | Small (adapter per tool) |
| **Multi-runtime** | 8 runtimes via installer adaptors | 24 tools via code adapters |
| **Update mechanism** | `/gsd:update` with patch reapplication | `openspec update` regenerates files |
| **Upgrade safety** | Fragile (custom edits can be overwritten) | Safe (CLI separate from generated output) |

**Assessment:** OpenSpec is significantly more resilient to Claude Code changes due to minimal coupling. GSD's power comes from deep integration, which is also its fragility. **The ideal approach decouples the framework engine from the AI tool integration layer**, as OpenSpec does, while retaining runtime orchestration capabilities that GSD provides.

### 2.5 Workflow Model

| Dimension | GSD | OpenSpec |
|-----------|-----|---------|
| **Core loop** | discuss → plan → execute → verify → ship | propose → apply → archive |
| **Granularity** | Fine (configurable coarse/standard/fine) | Fixed artifact-level |
| **Parallelization** | Wave-based DAG execution | Parallel change folders |
| **Context management** | Fresh context per agent (200K windows) | Not managed (relies on AI tool) |
| **State machine** | Explicit (STATE.md with transitions) | Implicit (file existence) |

**Assessment:** GSD's workflow engine is substantially more sophisticated. The wave-based parallel execution, explicit state machine, and context engineering are genuine innovations. OpenSpec's workflow is simpler but less powerful. **Context engineering (fresh windows per agent, budget management) is a critical capability** that any serious framework needs.

### 2.6 Configuration Model

| Dimension | GSD | OpenSpec |
|-----------|-----|---------|
| **Tiers** | Global defaults → project config → CLI flags | Global → project → per-change |
| **Format** | JSON | YAML + JSON |
| **Validation** | Runtime checks in Node.js modules | Zod schema validation |
| **Model profiles** | Yes (quality/balanced/budget/inherit) | No |
| **Feature toggles** | Yes (research, verify, auto-advance, etc.) | Limited (profile selection) |

**Assessment:** GSD's configuration is more comprehensive and practical for real-world use. Model profiles alone are a significant advantage for cost management. OpenSpec's Zod-based validation is better engineering practice. **A good framework needs both: rich configuration options with schema validation.**

---

## 3. Key Design Dimensions for a Scalable Meta Framework

Based on the analysis, these are the critical considerations for a meta CLI framework designed to scale with teams:

### 3.1 Extension Registry & Sharing (Neither framework solves this)

**The gap:** Both frameworks let individuals create custom content, but neither provides:
- A registry for discovering/sharing skills, agents, and commands
- Versioned dependencies between extensions
- Cross-project import/export with update tracking
- Organization-scoped content libraries

**Recommendation:** Build a content package system with:
- Git-based imports (URL + ref + path)
- Lock file for version pinning
- Namespace resolution (org/skill-name)
- Layer-aware installation (user vs project scope)

### 3.2 Extension API & Contracts (Neither framework solves this well)

**The gap:** There's no formal contract for what a skill, agent, or command must provide, making it hard to:
- Validate extensions before use
- Compose extensions into workflows
- Test extensions in isolation

**Recommendation:** Define clear interfaces:
- Schema-validated frontmatter (required fields, optional fields, types)
- Lifecycle hooks (pre/post execution)
- Input/output contracts for composability
- Test harness for extension authors

### 3.3 Runtime vs Generation Architecture

**GSD approach:** Runtime orchestration (deep integration, powerful, fragile)
**OpenSpec approach:** Static generation (loose coupling, portable, limited)

**Recommendation:** Hybrid architecture:
- **Core engine:** Standalone CLI/library that manages content, config, and state (like OpenSpec's separation)
- **Runtime adapters:** Thin integration layers per AI tool (like OpenSpec's adapters)
- **Orchestration layer:** Optional runtime capabilities for tools that support them (like GSD's agents/hooks for Claude Code)
- This means the framework works at a baseline level everywhere, but unlocks advanced capabilities where supported

### 3.4 Context Engineering

**GSD's key insight:** AI agents degrade as context fills. Fresh context windows per agent, structured handoffs, and context budget management are essential.

**Recommendation:** Any framework that spawns agents must:
- Control context window allocation
- Structure information handoffs between agents
- Provide context-budget-aware orchestration
- Support both parallel and sequential execution patterns

### 3.5 Configuration Hierarchy for Teams

**Requirement:** Teams need configuration at multiple levels:
1. **Framework defaults** (sensible out of the box)
2. **Organization-wide** (shared conventions, approved skills, model policies)
3. **Team-level** (team-specific workflows, role-based defaults)
4. **Project-level** (project-specific overrides)
5. **User-level** (personal preferences)
6. **Invocation-level** (CLI flags, one-off overrides)

**Neither framework supports organization or team tiers.** This is the key gap for team scalability.

### 3.6 Upgrade Safety & Version Management

**Critical requirement:** Teams cannot adopt a framework that breaks their customizations on update.

**Recommendation:** Follow the three-layer pattern (core/user/project) with:
- Core content is read-only and updated by the framework
- User/project content shadows core by name
- Diff tool to compare overrides against new core versions
- Migration scripts for breaking changes
- Semantic versioning for the content API (frontmatter schema, hook contracts)

### 3.7 State Management Strategy

| Approach | When to Use |
|----------|------------|
| **Stateless** (FSD current) | Simple frameworks, content discovery only |
| **File-existence state** (OpenSpec) | Change tracking, artifact completion |
| **Explicit state machine** (GSD) | Complex workflows, session continuity, progress tracking |

**Recommendation:** Start stateless, add explicit state only for features that require it. State should be:
- Human-readable (markdown/YAML)
- Git-friendly (committable, diffable)
- Layer-aware (project state vs user state)

### 3.8 Security & Governance

**GSD includes:** Path traversal prevention, prompt injection detection, shell argument validation
**OpenSpec includes:** Minimal (telemetry opt-out)

**For teams, governance matters:**
- Approved skill/agent registries
- Audit trail for AI-assisted changes
- Model usage policies (which models for which tasks)
- Cost controls (token budgets per phase/agent)

---

## 4. Scoring Matrix

| Criterion (weighted) | GSD | OpenSpec | Ideal Target |
|----------------------|-----|---------|--------------|
| **Extensibility** (25%) | 4/10 | 5/10 | 9/10 |
| **Team scalability** (20%) | 5/10 | 4/10 | 9/10 |
| **Claude Code evolution resilience** (15%) | 5/10 | 9/10 | 8/10 |
| **Workflow sophistication** (15%) | 9/10 | 5/10 | 8/10 |
| **Configuration model** (10%) | 7/10 | 6/10 | 9/10 |
| **Context engineering** (10%) | 9/10 | 2/10 | 8/10 |
| **Developer experience** (5%) | 5/10 | 7/10 | 8/10 |
| **Weighted total** | **5.7** | **5.1** | **8.7** |

**Neither framework is close to the ideal.** GSD excels at workflow and context engineering but is weak on extensibility and team scalability. OpenSpec excels at portability and upgrade safety but lacks runtime capabilities. The ideal framework combines the best of both.

---

## 5. Strategic Recommendations

### Adopt from GSD:
1. **Context engineering model** -- Fresh context per agent, budget management, structured handoffs
2. **Wave-based parallel execution** -- DAG-aware task scheduling
3. **Model profiles** -- Cost-tier assignment per agent role
4. **Explicit state machine** -- For workflow-heavy features only
5. **Session continuity** -- Pause/resume with context handoffs

### Adopt from OpenSpec:
1. **Decoupled architecture** -- Separate engine from AI tool integration
2. **Schema-based extensibility** -- Formal extension contracts with validation
3. **Adapter pattern** -- Thin integration layers per AI tool
4. **Delta-based evolution** -- For spec/requirement management
5. **Static-first, runtime-optional** -- Works without deep integration, better with it

### Build new (neither framework has this):
1. **Content package system** -- Git-based import/export with versioning
2. **Organization-scoped configuration** -- Team and org config tiers
3. **Extension marketplace/registry** -- Discovery and sharing
4. **Formal extension API** -- Validated contracts, test harness, lifecycle hooks
5. **Role-based defaults** -- Different defaults for different team roles
6. **Governance tooling** -- Approved registries, cost controls, audit trails
