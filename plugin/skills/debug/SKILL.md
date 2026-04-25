---
name: fsd:debug
description: This skill should be used when the user asks to "debug", "fix a bug", "investigate an error", "troubleshoot", or encounters unexpected behavior that needs systematic diagnosis.
---

# Debug

## Overview

Systematically diagnose and fix bugs using evidence-based reasoning. Resist the urge to guess — gather data first, form hypotheses, then test them.

## When to Use

Invoke when encountering a bug, test failure, unexpected behavior, or error message that needs investigation.

## Process

### 1. Reproduce

Confirm the bug exists and is reproducible:
- What is the exact error message or unexpected behavior?
- What is the exact command or action that triggers it?
- Does it happen every time or intermittently?

### 2. Gather Evidence

Before forming hypotheses, collect data:
- Read relevant error logs and stack traces
- Check recent changes (git diff, git log)
- Identify the code path involved
- Check inputs and outputs at key points

### 3. Form Hypotheses

Based on evidence, list 2-3 possible causes ranked by likelihood:
1. Most likely cause and why
2. Second most likely
3. Less likely but worth checking

### 4. Test Hypotheses

For each hypothesis (starting with most likely):
- Design a specific test that would confirm or rule it out
- Run the test
- Record the result
- Move to next hypothesis if ruled out

### 5. Fix and Verify

Once the root cause is confirmed:
- Write a test that reproduces the bug
- Implement the minimal fix
- Run the test to confirm the fix
- Run the full test suite to check for regressions

## Output

A working fix with a regression test, plus a brief note on root cause for future reference.
