"""
db.py — EqualPath Supabase connection
Единствена точка за достъп до базата данни.
"""

import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

_client: Client | None = None


def get_db() -> Client:
    """Връща Supabase клиент (singleton)."""
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_KEY", "")
        if not url or url == "your_supabase_project_url":
            raise Exception(
                "SUPABASE_URL не е зададен. "
                "Добави го в .env от Supabase Dashboard → Project Settings → API."
            )
        _client = create_client(url, key)
    return _client
