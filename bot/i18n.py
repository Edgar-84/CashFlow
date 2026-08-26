"""Bot-side translation runtime (U3.12, D700s contracts) — mirrors
`webapp/src/lib/i18n.ts`'s shape, adapted to the bot's per-update, per-caller
nature: there is no single "current language" module state here, since one
process serves every account's tg_ids concurrently. Callers pass the
caller's resolved `Language` (injected into handler data by
`bot/middlewares.py::AllowlistMiddleware`, D707) into every `t()` call.

EN catalogue only — RU and UK ship in U3.15; until then every `Language`
falls back to the EN catalogue rather than raising on an account already set
to one of them server-side. Handler string extraction starts at U3.13.
"""

from typing import Final

from models.enums import Language

Catalogue = dict[str, str]

_en: Final[Catalogue] = {
    "readonly": "You don't have permission to do that.",
    "error.tryAgain": "Try again.",
}

_catalogues: Final[dict[Language, Catalogue]] = {
    Language.EN: _en,
    Language.RU: _en,
    Language.UK: _en,
}


class _LeaveUnmatched(dict[str, object]):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def t(language: Language, key: str, **variables: str | int) -> str:
    """Looks up `key` in `language`'s catalogue (falling back to EN, per the
    module doc above) and fills in `{var}` placeholders. Telegram messages in
    this bot are sent with no `parse_mode` (plain text, checked bot-wide) —
    unlike the webapp's `t()`, no HTML-escaping is applied here. A
    placeholder with no matching var is left untouched rather than silently
    dropped, same as the webapp's version."""
    template = _catalogues[language][key]
    if not variables:
        return template
    return template.format_map(_LeaveUnmatched(variables))
