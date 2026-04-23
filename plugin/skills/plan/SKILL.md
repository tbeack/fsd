---
name: plan
description: This skill should be used when the user asks to "plan", "create a plan", "break down tasks", "write implementation steps", or needs to turn a design decision into an ordered task list before writing code.
---

# Plan

## Overview

Turn a design direction into an ordered, bite-sized implementation plan. Each task should be completable in 2-10 minutes with clear inputs, outputs, and verification steps.

## When to Use

Invoke after brainstorming (or when the user has a clear idea) and before writing any code.

## Process

### 1. Identify Components

List the distinct pieces of work:
- New files to create
- Existing files to modify
- Tests to write
- Configuration changes

### 2. Order by Dependency

Arrange tasks so each builds on the previous:
- Foundation first (data models, utilities)
- Core logic next
- Integration and wiring last
- Tests alongside each component (TDD preferred)

### 3. Write Tasks

For each task, specify:
- **Files:** Exact paths to create or modify
- **What:** One clear action (not "implement the feature")
- **Verify:** How to confirm it works (test command, expected output)
- **Commit point:** Group related changes into atomic commits

### 4. Review the Plan

Check for:
- Missing dependencies between tasks
- Tasks that are too large (split anything over 10 minutes)
- Missing test coverage
- Unnecessary complexity (YAGNI)

## Output

A numbered task list ready for the **execute** skill.
