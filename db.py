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
        if not url:
            raise Exception(
                "SUPABASE_URL not configured. "
                "Add it to .env from Supabase Dashboard -> Project Settings -> API."
            )
        if not key:
            raise Exception(
                "SUPABASE_KEY not configured. "
                "Add it to .env from Supabase Dashboard -> Project Settings -> API."
            )
        _client = create_client(url, key)
    return _client
