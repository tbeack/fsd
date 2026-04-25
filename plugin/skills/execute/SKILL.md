---
name: fsd:execute
description: This skill should be used when the user asks to "execute", "implement", "build", "start coding", or has an approved plan ready to implement task by task.
---

# Execute

## Overview

Implement a plan task by task with test-driven development and frequent commits. Focus on one task at a time — complete it fully before moving on.

## When to Use

Invoke when a plan exists (from the **plan** skill or user-provided) and it's time to write code.

## Process

### 1. Read the Plan

Load the plan document. Identify the first incomplete task.

### 2. For Each Task

Follow TDD cycle:
1. **Write the failing test** — assert the expected behavior
2. **Run the test** — confirm it fails for the right reason
3. **Write minimal implementation** — just enough to pass
4. **Run the test** — confirm it passes
5. **Refactor if needed** — clean up without changing behavior
6. **Commit** — atomic commit with descriptive message

### 3. Between Tasks

After completing each task:
- Run the full test suite to catch regressions
- Review the plan — does the next task still make sense?
- Note any deviations or discoveries

### 4. Handle Blockers

If a task can't be completed as planned:
- Document what's blocking
- Propose an alternative approach
- Get user confirmation before deviating from the plan

## Output

Working, tested code with clean commit history. Each commit maps to a plan task.
