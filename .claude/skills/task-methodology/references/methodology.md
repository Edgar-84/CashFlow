# Task Definition & Decomposition Methodology for Claude Code

Reference for the task-methodology skill. The operational condensed version
lives in SKILL.md; this document is the full methodology with rationale.

---

## 1. Task decomposition

### 1.1 Unit of work: definition

**A unit is the smallest behavior change that can be independently
verified and independently reverted.**

Formal criteria (all mandatory):
1. After the unit, `scripts/verify.sh` is green — the repository never
   lives in a red state between units.
2. The unit has its own acceptance criterion, written in the plan file
   BEFORE work starts ("test X passes", "function Y returns Z for input W").
3. One unit = one commit. `git revert` of that commit breaks no
   neighboring units.
4. The unit fits within the "context budget" (see 1.2).

### 1.2 Sizing: context budget instead of story points

Practical thresholds (calibrated to model accuracy on diffs):

| Metric | Green zone | Yellow | Red — split further |
|---|---|---|---|
| Diff lines | ≤ 300 | 300–600 | > 600 |
| Files changed | ≤ 5 | 5–8 | > 8 |
| Files to KEEP IN MIND | ≤ 7 | 8–12 | > 12 |
| New decisions made along the way | 0–1 | 2–3 | > 3 → that's not a unit, that's a plan |

The key metric is the last one: if the model will have to make several
architectural decisions inside a unit, the decomposition isn't finished.
A unit is the execution of decisions already made, plus at most one
local decision.

Complexity asymmetry (the main difference from estimating "for humans"):
- Cheap for an LLM, expensive for a human: boilerplate, CRUD, migrations,
  repetitive tests, mechanical refactoring. Such units can be made larger.
- Expensive for an LLM, tolerable for a human: implicit invariants,
  relationships scattered across the codebase, "it's historically been
  this way here". Split such units more aggressively and surround them
  with context (file references in the plan).

### 1.3 Slicing order: contracts → pure logic → IO → wiring

Standard sequence for a feature with business logic:

- **U0 — contracts**: pydantic models, enums, service signatures,
  error types. No implementation (or with `NotImplementedError`).
- **U1..Uk — pure logic**: functions without IO, maximum testability
  (parametrize, edge cases). All the "complex business logic" lives here.
- **Uk+1 — persistence/IO**: repositories, migrations, external APIs.
- **Un-1 — wiring**: hooking into handlers/routes/pipeline.
- **Un — integration smoke** (@integration).

Why contracts come first: (a) it's the cheapest point for human review —
20 lines of types read in a minute and lock in 80% of the architecture;
(b) after U0 the remaining units become almost independent — each is
written against fixed types, not against "whatever comes out".

**Contract immutability rule:** a unit is NOT allowed to change contracts
from U0. If the implementation hits a contract limitation — stop, return
to the plan (as a separate Decision log entry), then continue. This rule
is what prevents losing the big picture during decomposition: the plan
file remains the single source of architectural truth.

### 1.4 What transfers from classic practice, and what doesn't

| Classic | Transfers? | How it transforms |
|---|---|---|
| Definition of Done | Yes, 1:1 and strengthened | From a checklist in your head → into a machine gate (verify.sh + Stop-hook). Unit DoD = green verify + acceptance from the plan |
| Task breakdown / WBS | Yes | The plan file IS the WBS, but with contracts and context references instead of estimates |
| INVEST for units | Almost all of it | I (independence via contracts), V→Verifiable, S, T — yes. E (estimable in hours) → replaced by the context budget |
| Vertical slicing | Yes, with a correction | The slice is cut into units by layer AFTER contracts are fixed; walking skeleton = U0 + stubs |
| Story points / velocity | No | They estimated human effort. For an agent, effort ≈ free; the limit is context and token budget. Metric: files/lines to keep in mind |
| Sprints, standups | No | The cycle compresses to hours. The standup's role is played by the handoff note (STATE in the plan) |
| Planning poker | Mutates | The only "ceremony" is human review of the plan file. It is the main quality control point for the whole feature |
| Code review | Mutates | The PLAN is reviewed first (cheap, before code); diffs — by a subagent + selectively by the human |

Fundamentally new (no Agile analog): **the executor has no memory between
sessions**. Hence the plan file is not bureaucracy but a memory
prosthesis: anything not written down does not exist.

---

## 2. Choosing the model for the task type

### 2.1 The main rule

**Expensive tokens go where decisions branch. Cheap tokens go where the
plan has already decided everything.** The cost of a planning mistake is
multiplied across all units below it; the cost of a mistake in a routine
unit is one revert.

### 2.2 Mapping table

| Type of work | Model | Mechanics | Why |
|---|---|---|---|
| Feature architecture, decomposition, contentious business logic | Opus | `/model opusplan` + Plan Mode | A mistake here is the most expensive; the output is a short plan file, cheap to review |
| Debugging the "weird" (heisenbugs, race conditions, anti-bot mysteries) | Opus, spot usage | `/model opus` temporarily, then back | Depth is needed, generation volume is small |
| Implementing a unit per an approved plan | Sonnet | session default | The workhorse: the plan has removed the uncertainty |
| Tests against ready contracts | Sonnet (tester subagent) | `model: sonnet` in frontmatter | Requires understanding behavior, not architecture |
| Diff review | Sonnet subagent; Opus on risky units | frontmatter | The subagent's fresh context matters more than model tier |
| Boilerplate, fixtures, renames, docstrings, commit messages | Haiku | `/model haiku` or a subagent | Zero branching — overpaying is pointless |

Fine-tuning without switching models: `/effort high` on a hard step inside
a Sonnet session — cheaper than jumping to Opus.

### 2.3 The Pro-plan correction

On Pro the default is Sonnet; Opus may be unavailable or tightly limited.
The pattern does NOT change — only the top tier degrades:
planning — Sonnet + Plan Mode + `/effort high` (and careful human review
of the plan compensates for the tier), execution — Sonnet, mechanics —
Haiku. The quota is shared across the plan and spent proportionally to
tokens, so Haiku on routine work genuinely saves the weekly limit.

---

## 3. Context management

### 3.1 Base principle: context is RAM, files are disk

Anything that must survive a session must live in a file. The dialogue is
the working memory of one unit, not a store of knowledge about the feature.

### 3.2 When to clear, when to keep

`/clear` (the norm, not the exception):
- Between units — always. A new unit starts from the plan file, not from
  chat history. This IS the mechanism of unit "independence".
- Between unrelated tasks; after finishing a debugging marathon.

Keep the session:
- Iterative debugging of the same problem (the history of attempts = data).
- A series of fixes for review findings on the same diff.
- Conversational refinement of a plan before it is finalized.

`/compact` is the intermediate tool: a long unit, context has bloated, but
the work isn't done. After compact, restate the key constraints to the
model (or keep them in the plan file it is looking at).

### 3.3 Intermediate artifacts

One file per feature: `docs/plans/<feature>.md` (template in
docs/plans/_template.md). Sections:
- **Goal / Non-goals** — the goal and explicit "we don't do" items
  (the best defense against scope creep).
- **Contracts** — types and signatures from U0 (or a link to the file
  containing them).
- **Units** — unit checklist with an acceptance criterion for each.
- **Decision log** — line by line: date, decision, why, what was rejected.
  Written AT THE MOMENT of the decision, including decisions made
  mid-unit.
- **STATE** — a live handoff note: done / next step / gotchas.

The Decision log is the most underrated section: it protects against
"zombie decisions", where a new session re-proposes an already-rejected
option.

### 3.4 Passing context between sessions and agents

Handoff protocol (the `/handoff` command):
1. Tick the checkboxes of completed units in the plan.
2. Update STATE: what's done, what's next, non-obvious gotchas.
3. Append to the Decision log if decisions were made along the way.
4. Only after that — `/clear` or end the session.

Entering a new session: "Read docs/plans/<feature>.md, we continue from
Uk" — that is enough; the model reconstructs the picture from the plan and
reads code details from the repository itself. Subagents receive the same
plan file + a specific unit — they are history-less by construction, and
the plan file makes them full participants.

### 3.5 Signs of contaminated context

Start over (via /handoff → /clear) if the model:
- re-proposes an already-rejected solution;
- "forgets" constraints from CLAUDE.md or the plan (violates conventions
  it previously followed);
- edits files unrelated to the unit "while at it";
- references a stale state of a file that has already changed;
- auto-compact fired mid-unit (a signal the unit was too large — record
  that in future decompositions);
- responses became wordier while edit accuracy dropped (small mistakes in
  paths, names, duplicated code).

Rule: recovery via /clear + the plan file is almost always cheaper than
"persuading" a contaminated context.

---

## 4. End-to-end example: a feature in a telegram bot

Feature: "referral program with multi-level rewards" — complex business
logic (levels, accrual conditions, anti-abuse), state in the DB,
integration with handlers.

### Step 0 — Definition (human, 10 minutes)

You formulate the GOAL and CONSTRAINTS, not instructions:

```
/feature Referral program.
Goal: a user invites via a personal link; rewards for 1st- and 2nd-level
referrals; the reward is credited after the invitee performs a qualifying
action (payment).
Constraints: do not touch the payment module (subscribe to its events
only); anti-abuse is mandatory (self-invites, rings); Postgres, the
existing FSM handler structure.
Non-goals: reward withdrawal, admin panel.
```

### Step 1 — The plan (Opus in Plan Mode, `/model opusplan`)

The model explores the codebase in Plan Mode (read-only) and proposes the
architecture and decomposition. The result — `docs/plans/referrals.md`:

```
Units:
- [ ] U0 Contracts: ReferralLink, Reward, RewardStatus, ReferralService
      (signatures), typed errors. AC: mypy green, models import.
- [ ] U1 Pure accrual logic: calc_rewards(chain, event) -> [Reward].
      AC: parametrize tests for levels/edge cases green.
- [ ] U2 Anti-abuse: is_abusive(chain) — self-invites, rings, limits.
      AC: a test per rule, including a ring of length 3.
- [ ] U3 Persistence: ReferralRepo + migration. AC: @integration CRUD.
- [ ] U4 Payment-event subscription → accrual pipeline. AC: a fake
      event passes the calc→abuse→persist chain.
- [ ] U5 Handlers: /invite, deep-link start, balance view. AC: tests
      with a fake Bot API.
- [ ] U6 Smoke: invite→signup→pay→reward scenario on the test DB.
```

**The human reviews the plan — this is the main control point.** Fixing a
line in the plan is cheaper than fixing 400 lines of diff. Approved →
exit Plan Mode (opusplan switches to Sonnet automatically).

### Step 2 — Executing units (Sonnet, in a loop)

For each unit:
1. `/clear` (except U0, which follows the plan immediately).
2. `/unit U1 docs/plans/referrals.md` — the command gives the model the
   plan and the unit id.
3. Sonnet implements; the tester subagent adds tests if the unit is a
   logic unit.
4. The Stop-hook runs verify.sh — the unit physically cannot finish red.
5. For risky units (U1, U2 — money and abuse) — the reviewer subagent;
   BLOCKERs are fixed in the same session (the diff context is still
   alive — do not clear).
6. The model updates the checkbox and STATE in the plan (/handoff when
   ending the session).
7. **The human**: reads the summary (+ the diff if desired), `git commit`.

Model routing per unit: U0 — Sonnet (types per the plan); U1–U2 — Sonnet
`/effort high` (or spot Opus if the logic is gnarly); U3, U5 — Sonnet;
fixtures and repetitive handlers inside U5 — Haiku is fine; U6 — Sonnet.

### Step 3 — Git granularity

- The norm: **one unit = one commit** (`feat(referrals): U1 reward
  calculation`). Exactly the granularity where revert is safe and bisect
  is informative.
- Checkpoints: if a unit is objectively long (U5 with many handlers) —
  WIP commits after each green verify.sh, then `rebase -i` → squash to
  one before finishing. Cheap for a solo developer, and it saves you from
  "the model went off the rails midway" — roll back to a checkpoint
  instead of redoing from scratch.
- The human commits (or the model does, on an explicit command) — per the
  framework's requirement.
- The plan file is committed together with U0 and updated in every unit
  commit — the decision history stays in git.

### Readiness criteria (summary)

Unit done = verify.sh green ∧ the unit's acceptance criterion met ∧
(for risky units) reviewer gave APPROVE ∧ the checkbox ticked in the plan.
Feature done = all units + U6 smoke + Non-goals untouched.
