---
name: brainstorming
description: "Use before non-trivial creative or engineering work: building features, adding functionality, modifying architecture/behavior, or planning new components."
---

# Brainstorming

Understand what the user actually wants and why before building anything.

## 1. Triage & Recon (Before Your First Reply)

- **Trivial / fully specified task** (e.g., "change icon color"): Do it directly and report what you changed.
- **Non-trivial or underspecified task**:
  1. **Look before you ask**: Read relevant existing files, code, and context first until you understand how the current system works and what this change touches. Never ask what the codebase already answers.
  2. **Required sequence before implementation**:
     - Clarify unknowns & align on intent
     - Present 2–3 viable approaches with trade-offs and a recommendation (in its own message)
     - Output a concise design (in chat, or in `docs/specs/YYYY-MM-DD-<topic>-design.md` if requested) and get explicit approval
     - Once approved, list concise implementation steps and begin building.

*Exception*: If nothing is open and only one sensible approach exists, include the short design in your first message and ask for approval.

## 2. First Message Structure

- **User gave a detailed request/spec** (~150–200 words):
  - Echo back the core goal, target, and "why" in your own words.
  - State relevant codebase findings, constraints, conflicts, or cheaper paths discovered.
  - Invite corrections in one line.
  - Ask **one** highest-leverage question whose answer changes what gets built (open question if "why" is missing; concrete options + recommendation if "why" is clear).
- **User gave a vague request**:
  - Ask **one** open question about the biggest unsettled decision, explaining how the answer changes what gets built.
- **Opt-out line** (only if the user did not explicitly ask to brainstorm):
  - End with: *"Or if you'd rather I just dive in, say so."* If they opt out, state key implementation choices in one line and proceed normally.

## 3. Conversation Discipline

- **One question at a time**: Only ask when the answer changes what gets built and the project doesn't answer it. Otherwise, state your call with reasoning as a proposal they can correct.
- **Intent before mechanics**: Ask open questions (no preset menu) until you understand the "why", success criteria, non-goals, and anti-goals. Once clear, give concrete options with trade-offs and your pick.
- **Match existing stack**: Build on the repo's existing tools/patterns. Clearly distinguish user decisions from your own defaults.
- **Text sketches**: For UI, layouts, or user flows, show a brief plain-text sketch/diagram directly in chat.
- **Throwaway spikes**: If uncertainty is high, offer a quick throwaway prototype (minimal/no tests, skips full design). Keeping spike code later requires going back through design approval.

## 4. Laying Out Approaches & Sizing

Before writing the design, send a dedicated message covering:
- **2–3 realistic approaches** grounded in the existing codebase (drop weak/conflicting ones).
- **Trade-offs** of each and your **recommended pick** with reasoning.

Once an approach is chosen, size the design:
- **Small change**: Short design (1–2 lines per point) directly in chat.
- **Full project**: Complete plain-language design covering intent/why, goals/non-goals/anti-goals, constraints, chosen approach & trade-offs, and key decisions.

<HARD-GATE>
Do NOT write production code, scaffold files, or install dependencies until the user approves the design (short or full). Reading and exploring are allowed.

Exceptions:
1. User explicitly opts out of brainstorming.
2. User explicitly approves a throwaway spike.

After design approval, output a concise step-by-step implementation plan and proceed directly to execution.
</HARD-GATE>
