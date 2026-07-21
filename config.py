from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    bot_token: str
    backend_base_url: str
    internal_token: str
    allowed_tg_ids: str
    family_tz: str = "UTC"

    @property
    def allowed_tg_ids_list(self) -> list[int]:
        return [int(tg_id) for tg_id in self.allowed_tg_ids.split(",") if tg_id.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
