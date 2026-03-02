---
name: verify
description: This skill should be used when the user asks to "verify", "check my work", "review the implementation", or after completing a plan to ensure everything works correctly and meets requirements.
---

# Verify

## Overview

Confirm that completed work meets requirements, passes tests, and is ready for use. Verification catches issues before they reach users.

## When to Use

Invoke after the **execute** skill completes all plan tasks, or when the user wants a quality check on recent work.

## Process

### 1. Run All Tests

Execute the full test suite. All tests must pass. If any fail:
- Identify the root cause
- Fix it before proceeding
- Re-run to confirm

### 2. Check Against Requirements

Compare the implementation to the original requirements or plan:
- Does every planned feature work?
- Are there edge cases not covered?
- Does the code match the agreed design?

### 3. Review Code Quality

Check for:
- Unused imports or dead code
- Missing error handling at system boundaries
- Security concerns (injection, XSS, exposed secrets)
- Performance issues in hot paths

### 4. Manual Smoke Test

If applicable, run the feature manually:
- Happy path works as expected
- Error states show useful messages
- UI renders correctly (if frontend)

## Output

A verification report: what passed, what needs attention, and whether the work is complete.
