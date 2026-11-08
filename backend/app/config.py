"""Application configuration via Pydantic Settings.

Loads environment variables for EMTUSA credentials, VAPID keys,
database path, and poller interval.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Runtime configuration loaded from env vars or .env file."""

    # EMTUSA OAuth2 credentials (server-side only — never exposed to frontend)
    emtusa_auth_basic: str = ""
    emtusa_auth_user: str = ""
    emtusa_auth_pass: str = ""
    emtusa_base_url: str = "https://emtusasiri.pub.gijon.es/emtusasiri/"

    # SQLite database file path
    db_path: str = "busgijon.db"

    # VAPID keys for Web Push
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    # Background poller interval (seconds)
    poll_interval_seconds: int = 30

    # Recorridos de líneas (OSRM)
    osrm_url: str = "https://router.project-osrm.org"
    routes_prefetch: bool = True

    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


# Singleton — imported across the app
settings = Settings()
