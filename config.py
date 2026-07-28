from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    bot_token: str
    backend_base_url: str
    internal_token: str
    family_tz: str = "UTC"
    family_currency: str = "USD"
    mini_app_url: str | None = None
    initdata_max_age_sec: int = 86400


@lru_cache
def get_settings() -> Settings:
    return Settings()
