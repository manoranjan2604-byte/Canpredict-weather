"""
AI insights provider.

Sends the live weather payload to Google Gemini and asks it to return a
strict JSON object matching the `insights` shape the frontend expects
(insights.title, insights.summary, insights.recommendation, etc).

If Gemini is unreachable or returns something unparsable, a deterministic
rule-based fallback is used instead so a live weather response is never
blocked by an AI provider hiccup.
"""
from __future__ import annotations

import json
import re
from typing import Any

import requests

from config import config
from utils.logger import get_logger

logger = get_logger(__name__)

_INSIGHT_KEYS = (
    "title",
    "summary",
    "recommendation",
    "rain_chance",
    "rain_label",
    "wind_label",
    "best_time",
    "time_zones",
)


def _build_prompt(weather: dict[str, Any]) -> str:
    hourly_summary = ", ".join(
        f"{h['time']}: {h['temp']}°C {h['condition']} (rain {h['rain_chance']}%)"
        for h in weather.get("hourly", [])[:12]
    )
    return f"""You are a weather insights assistant for a mobile weather app called CanPredict AI.
Based ONLY on the following live weather data, generate practical, factual insights.

Location: {weather.get('city')}, {weather.get('country')}
Current condition: {weather.get('condition')} ({weather.get('temperature')}°C, feels like {weather.get('feels_like')}°C)
Today's range: {weather.get('temp_min')}°C - {weather.get('temp_max')}°C
Humidity: {weather.get('humidity')}%
Wind: {weather.get('wind_speed')} km/h {weather.get('wind_direction')}
UV Index: {weather.get('uv_index')}
Air Quality Index (US EPA 1-6 scale): {weather.get('aqi')}
Next 12 hours: {hourly_summary}

Respond with ONLY a single valid JSON object (no markdown fences, no commentary) with EXACTLY this shape:
{{
  "title": "short punchy headline with an optional emoji, max 6 words",
  "summary": "1-2 sentence factual summary of today's weather",
  "recommendation": "1-2 sentence actionable recommendation covering clothing, hydration, or travel as relevant",
  "rain_chance": <integer 0-100, the peak rain chance over the next 12 hours>,
  "rain_label": "one word label such as Low, Moderate, or High",
  "wind_label": "one word label such as Calm, Gentle, Breezy, or Strong",
  "best_time": {{
    "range": "e.g. 9 AM - 1 PM",
    "description": "1 sentence explaining why this window is best to go outside"
  }},
  "time_zones": [
    {{ "label": "6 AM - 9 AM", "description": "short description", "curve_x": 20, "curve_y": 45 }},
    {{ "label": "9 AM - 1 PM", "description": "short description", "curve_x": 60, "curve_y": 35 }},
    {{ "label": "1 PM - 6 PM", "description": "short description", "curve_x": 100, "curve_y": 50 }},
    {{ "label": "6 PM - 9 PM", "description": "short description", "curve_x": 140, "curve_y": 45 }}
  ]
}}
curve_x must be between 10 and 150, curve_y must be between 20 and 70 (these plot points onto a small SVG timeline)."""


def _extract_json(text: str) -> dict[str, Any]:
    """Gemini occasionally wraps JSON in markdown fences - strip them before parsing."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


def _validate_insights(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Gemini response was not a JSON object.")
    missing = [k for k in _INSIGHT_KEYS if k not in payload]
    if missing:
        raise ValueError(f"Gemini response missing keys: {missing}")
    if not isinstance(payload.get("best_time"), dict):
        raise ValueError("Gemini response 'best_time' must be an object.")
    if not isinstance(payload.get("time_zones"), list):
        raise ValueError("Gemini response 'time_zones' must be a list.")
    return payload


def _call_gemini(weather: dict[str, Any]) -> dict[str, Any]:
    prompt = _build_prompt(weather)
    url = f"{config.GEMINI_API_BASE_URL}?key={config.GEMINI_API_KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
        },
    }

    response = requests.post(url, json=body, timeout=config.GEMINI_API_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()

    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini returned no candidates.")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts)
    if not text:
        raise ValueError("Gemini returned an empty response.")

    parsed = _extract_json(text)
    return _validate_insights(parsed)


def _fallback_insights(weather: dict[str, Any]) -> dict[str, Any]:
    """Deterministic, rule-based insights used when Gemini is unavailable."""
    hourly = weather.get("hourly", [])
    rain_chance = max((h.get("rain_chance", 0) for h in hourly), default=0)
    wind_speed = weather.get("wind_speed", 0)
    uv = weather.get("uv_index", 0)
    condition = weather.get("condition", "the weather")

    rain_label = "High" if rain_chance >= 60 else "Moderate" if rain_chance >= 30 else "Low"
    wind_label = "Strong" if wind_speed >= 40 else "Breezy" if wind_speed >= 20 else "Gentle" if wind_speed >= 8 else "Calm"

    if rain_chance >= 60:
        best_range, best_desc = "Stay indoors if possible", "Rain is likely for most of the day."
    elif uv >= 8:
        best_range, best_desc = "7 AM - 10 AM", "UV levels rise sharply later in the day."
    else:
        best_range, best_desc = "9 AM - 1 PM", "Conditions are calmest during this window."

    recommendation_parts = []
    if rain_chance >= 40:
        recommendation_parts.append("Carry an umbrella.")
    if uv >= 6:
        recommendation_parts.append("Wear sunscreen if you're outside for long.")
    if wind_speed >= 30:
        recommendation_parts.append("Secure loose outdoor items - it's windy.")
    if not recommendation_parts:
        recommendation_parts.append("Conditions look manageable for most outdoor plans.")

    return {
        "title": f"{condition} Today",
        "summary": f"Expect {condition.lower()} with a high of {weather.get('temp_max')}°C and a low of "
        f"{weather.get('temp_min')}°C. Humidity is around {weather.get('humidity')}%.",
        "recommendation": " ".join(recommendation_parts),
        "rain_chance": rain_chance,
        "rain_label": rain_label,
        "wind_label": wind_label,
        "best_time": {"range": best_range, "description": best_desc},
        "time_zones": [
            {"label": "6 AM - 9 AM", "description": "Cooler start to the day.", "curve_x": 20, "curve_y": 45},
            {"label": "9 AM - 1 PM", "description": "Temperatures climbing.", "curve_x": 60, "curve_y": 35},
            {"label": "1 PM - 6 PM", "description": "Warmest part of the day.", "curve_x": 100, "curve_y": 50},
            {"label": "6 PM - 9 PM", "description": "Cooling down in the evening.", "curve_x": 140, "curve_y": 45},
        ],
    }


def generate_insights(weather: dict[str, Any]) -> dict[str, Any]:
    """Return AI-generated insights, falling back to a rule-based summary if
    Gemini is unreachable or returns an unusable response."""
    if not config.GEMINI_API_KEY:
        # Handled distinctly at the route layer (500 "Missing GEMINI_API_KEY").
        raise RuntimeError("MISSING_GEMINI_API_KEY")

    try:
        return _call_gemini(weather)
    except requests.exceptions.Timeout:
        logger.warning("Gemini request timed out; using rule-based fallback insights.")
    except requests.exceptions.RequestException as exc:
        logger.warning("Gemini network error (%s); using rule-based fallback insights.", exc)
    except (ValueError, json.JSONDecodeError) as exc:
        logger.warning("Gemini returned an unusable response (%s); using rule-based fallback insights.", exc)

    return _fallback_insights(weather)
