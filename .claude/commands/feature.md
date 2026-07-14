---
description: Start a new feature — goal-first planning, produces a plan file
---
A new feature is being started. The user provides a GOAL and CONSTRAINTS —
not instructions. Your job is to propose the plan, not to start coding.

1. Read the task-methodology skill (and its references/methodology.md).
2. Explore the relevant parts of the codebase (read-only).
3. Ask up to 3 clarifying questions if the goal/constraints are ambiguous.
4. Produce docs/plans/<feature-slug>.md from docs/plans/_template.md:
   contracts sketch, unit checklist with acceptance criteria per unit
   (respect the context budget: each unit ≤ ~300 diff lines, ≤ 5 files),
   risks, Decision log seeded with key architecture choices and rejected
   alternatives.
5. STOP. Present the plan for human review. Do not implement anything
   until the plan is explicitly approved.

Feature goal and constraints: $ARGUMENTS
