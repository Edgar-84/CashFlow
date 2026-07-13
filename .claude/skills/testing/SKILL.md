---
name: testing
description: How tests are written and run in this project. Use whenever writing, fixing or running tests, adding pytest fixtures, or when verify_old.sh fails on the pytest step.
---

# Testing conventions

- Runner: pytest. Fast unit suite: `pytest -q -m "not integration"`.
- Unit tests are hermetic: no network, no real browser, no sleeps.
- Scrapers: parse fixtures from tests/fixtures/<site_slug>/; refresh fixtures
  via scripts (never hand-edit fixture HTML).
- Markers: integration (live network), slow. Register them in pyproject.
- Async tests: pytest-asyncio, mode=auto.
- A failing test may reveal a real bug — investigate before changing the
  assertion. Never weaken a test just to make verify.sh pass.
- Coverage priorities: error paths (Blocked/LayoutChanged/Transient) matter
  more than happy paths — those are what break in production.
