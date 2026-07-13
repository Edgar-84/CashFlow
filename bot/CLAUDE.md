# bot/ — Telegram bot (aiogram 3.x)

<!-- Loaded only when Claude works inside bot/. -->

## Purpose
Telegram UI in front of the FastAPI backend. **Zero database access.** The bot
is a thin HTTP client; every mutation and query goes through the API. This is
what will let the future Telegram Mini App (V2) reuse the same backend.

## Structure
- `bot.py` — `Dispatcher` + router registration; entrypoint (`__main__`).
- `client.py` — `BackendClient`: httpx `AsyncClient` wrapper, one method per
  endpoint. All API calls go through this class.
- `middlewares.py` — tg_id allowlist (from `ALLOWED_TG_IDS`); injects
  `X-Telegram-User-Id` header into every outgoing API call.
- `keyboards.py` — `InlineKeyboardMarkup` builders (pure functions).
- `states.py` — FSM `StatesGroup`s.
- `handlers/` — one module per feature area: `expenses.py`, `categories.py`,
  `tags.py`, `budgets.py`, `statistics.py`.

## Ironclad rules
- **Zero DB imports.** No `import asyncpg`. No `from database import ...`.
  A CI/reviewer check should confirm this.
- **Zero business logic.** Handlers format keyboards + render responses. Any
  computation (budget %, aggregates) is done by the backend.
- **All backend calls go through `client.py`.** Handlers never touch `httpx`
  directly.
- The middleware sets `X-Telegram-User-Id: <tg_id>` — handlers must not pass
  `account_id` or user UUIDs; the backend resolves them from the header.

## Expense-creation FSM (canonical flow)
`category → amount → [description] → [tags] → confirm`
- Category: inline keyboard listing this account's categories.
- Amount: text input, parsed to minor units (`int(round(value * 100))`) —
  reject non-positive.
- Description: optional; `/skip` proceeds.
- Tags: optional multi-select inline keyboard.
- Confirm: summary message + confirm/cancel buttons. On confirm → POST
  `/expenses` via `BackendClient`. On success, show a receipt; if the backend
  responded with a budget-threshold notification, the user already got it.

## Rules
- Async everywhere.
- No `print()`; use `logging`.
- Errors from the backend surface as user-friendly Telegram messages — never
  raw tracebacks. Log the traceback, show a short message.
- FSM state is per-user; always clear state on completion or `/cancel`.

## Out of scope (V2 — leave `# TODO: V2` stubs)
- Voice input parsing.
- User self-registration via the bot.
