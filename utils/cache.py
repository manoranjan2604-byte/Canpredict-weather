"""
A minimal, dependency-free, thread-safe in-memory TTL cache.

The app is stateless between deploys (nothing is written to disk), but a
short-lived in-process cache is used to avoid hammering WeatherAPI with
identical requests, per the performance requirements.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Optional


class TTLCache:
    """A simple time-based cache. Not distributed - fine for a single dyno.

    If the app is scaled to multiple instances, each instance keeps its own
    cache; this only reduces per-instance upstream calls, which is sufficient
    for the "reduce WeatherAPI usage" requirement without adding an external
    dependency like Redis.
    """

    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if time.time() >= expires_at:
                # Expired - evict lazily.
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = (time.time() + self._ttl, value)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
