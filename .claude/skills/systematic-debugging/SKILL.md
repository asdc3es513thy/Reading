---
name: systematic-debugging
description: "Use when encountering any bug, test failure, build error, or unexpected behavior before proposing fixes."
---

# Systematic Debugging

**Core Principle:** Always find the root cause before attempting fixes. Symptom patches are failures.

> **IRON LAW: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**
> Do not propose code fixes until Phase 1 is complete.

## Phase 1: Root Cause Investigation

Complete before proposing any fix:
1. **Read errors completely**: Inspect full stack traces, exact line numbers, file paths, and error codes.
2. **Reproduce consistently**: Identify exact trigger steps. If not reproducible, gather more data instead of guessing.
3. **Check recent changes**: Inspect `git diff`, recent commits, dependency updates, config, and environment differences.
4. **Isolate multi-component boundaries**: For multi-layer failures (e.g., API -> service -> DB or CI -> build), log inputs/outputs and env/config state at each boundary once to pinpoint the exact failing layer.
5. **Trace data flow backward**: Find where the bad value enters, trace callers backward to its true origin, and plan to fix at the source—not at the symptom.

## Phase 2: Pattern Analysis

1. **Find working references**: Locate similar working code in the same codebase and read it completely (do not skim).
2. **Diff working vs. broken**: List every difference in logic, config, environment, and assumptions—never assume a detail "can't matter."

## Phase 3: Hypothesis & Minimal Testing

1. **Single specific hypothesis**: State clearly: *"I think X is the root cause because Y."*
2. **Minimal test**: Make the smallest possible single-variable change to test the hypothesis. Never bundle multiple guesses at once.
3. **Verify**: If confirmed, go to Phase 4. If disproved, revert/discard and form a new hypothesis. If you don't know, state what you don't understand and investigate further.

## Phase 4: Implementation & Hard Verification

1. **Minimal reproduction test first**: Create the simplest automated test or reproduction script that fails on the bug before applying the fix.
2. **Single root-cause fix**: Fix only the identified root cause. No bundled refactoring or "while I'm here" edits.
3. **Mandatory verification gate**: Do NOT claim the issue is fixed until you actually execute the relevant test/verification commands and directly observe passing output with zero broken tests.
4. **3-Strike Architecture Rule**:
   - Fewer than 3 failed fix attempts: Return to Phase 1 with the new evidence.
   - **3 or more failed attempts**: **STOP immediately.** Do not try Fix #4. Repeated failures or fixes creating new bugs elsewhere indicate an architectural/coupling flaw—discuss structural alternatives with the user first.

## Red Flags — STOP and Return to Phase 1

Stop immediately if you are about to:
- Propose a "quick fix for now, investigate later"
- Guess a fix without tracing data flow or reading the full error
- Apply multiple changes simultaneously
- Skip running verification and assume the fix works
- Attempt a 4th fix after 3 failures

## When No Code Root Cause Exists

Only after full investigation confirms an external/environmental/timing issue: document findings, implement proper handling (retry, timeout, explicit error message), and add diagnostic logging.
