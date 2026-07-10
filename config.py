from __future__ import annotations
import os
from dotenv import load_dotenv
load_dotenv()

class Config:
    """Central configuration object, populated from environment variables."""

    
    WEATHER_API_KEY: str | None = os.environ.get("WEATHER_API_KEY")
    GEMINI_API_KEY: str | None = os.environ.get("GEMINI_API_KEY")

    
    WEATHER_API_BASE_URL: str = "https://api.weatherapi.com/v1/forecast.json"
    GEMINI_MODEL: str = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    GEMINI_API_BASE_URL: str = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent"
    )

    
    WEATHER_API_TIMEOUT_SECONDS: float = float(os.environ.get("WEATHER_API_TIMEOUT_SECONDS", 8))
    GEMINI_API_TIMEOUT_SECONDS: float = float(os.environ.get("GEMINI_API_TIMEOUT_SECONDS", 12))

    
    CACHE_TTL_SECONDS: int = int(os.environ.get("CACHE_TTL_SECONDS", 180)) 

    
    CORS_ORIGINS: str = os.environ.get("CORS_ORIGINS", "*")

    PORT: int = int(os.environ.get("PORT", 5000))
    DEBUG: bool = os.environ.get("FLASK_DEBUG", "false").lower() == "true"

    
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO")


config = Config()
