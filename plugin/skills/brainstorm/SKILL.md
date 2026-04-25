---
name: fsd:brainstorm
description: This skill should be used when the user asks to "brainstorm", "explore ideas", "design a feature", "think through options", or begins any creative work like creating features, building components, or modifying behavior. Explores user intent, requirements, and design before implementation.
---

# Brainstorm

## Overview

Explore ideas and requirements before committing to implementation. Brainstorming prevents premature coding by ensuring the problem space is understood and design options are evaluated.

## When to Use

Invoke before any creative or design work — new features, architecture changes, product concepts, or significant modifications to existing behavior.

## Process

### 1. Clarify Intent

Ask focused questions to understand:
- What problem is being solved?
- Who is the audience?
- What does success look like?

Limit to 2-3 questions per round to avoid overwhelming.

### 2. Explore Options

Generate 2-3 distinct approaches. For each:
- Name the approach (e.g., "Event-driven", "Polling-based")
- List key trade-offs (complexity, performance, maintainability)
- Identify unknowns or risks

### 3. Evaluate and Converge

Present options side-by-side. Help the user choose by surfacing:
- Which approach best fits stated constraints
- Which unknowns are most dangerous
- What can be deferred vs. decided now

### 4. Document Decision

Capture the chosen direction in 3-5 sentences covering:
- The approach selected
- Key reasons for the choice
- Any constraints or assumptions

## Output

A clear design direction ready to hand off to the **plan** skill for detailed task breakdown.
