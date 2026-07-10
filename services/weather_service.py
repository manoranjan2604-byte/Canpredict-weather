"""
Weather data provider.

Talks to WeatherAPI.com (the ONLY weather data source used by this app) and
transforms its response into the exact JSON shape the existing frontend
(script.js) expects. No mock data, no ML model, no CSV - live data only.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import requests

from config import config
from utils.condition_mapper import to_condition_code
from utils.logger import get_logger

logger = get_logger(__name__)


class WeatherServiceError(Exception):
    """Raised when WeatherAPI cannot be reached or returns a server-side error."""


class CityNotFoundError(Exception):
    """Raised when WeatherAPI cannot resolve the requested location."""


def _build_query_param(city: Optional[str], lat: Optional[float], lon: Optional[float]) -> str:
    """Build the WeatherAPI `q` parameter from either a city name or coordinates."""
    if lat is not None and lon is not None:
        return f"{lat},{lon}"
    return city or ""


def fetch_forecast_raw(
    city: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
) -> dict[str, Any]:
    """Call WeatherAPI's forecast endpoint and return the raw JSON payload.

    Raises:
        CityNotFoundError: the location could not be resolved (WeatherAPI code 1006).
        WeatherServiceError: any other failure (network, timeout, invalid key, 5xx, etc).
    """
    if not config.WEATHER_API_KEY:
        # Distinct exception so the route layer can return the documented
        # "Missing WEATHER_API_KEY" 500 response instead of a generic failure.
        raise RuntimeError("MISSING_WEATHER_API_KEY")

    params = {
        "key": config.WEATHER_API_KEY,
        "q": _build_query_param(city, lat, lon),
        "days": 7,
        "aqi": "yes",
        "alerts": "yes",
    }

    try:
        response = requests.get(
            config.WEATHER_API_BASE_URL,
            params=params,
            timeout=config.WEATHER_API_TIMEOUT_SECONDS,
        )
    except requests.exceptions.Timeout as exc:
        logger.error("WeatherAPI request timed out for query=%s", params["q"])
        raise WeatherServiceError("WeatherAPI request timed out.") from exc
    except requests.exceptions.RequestException as exc:
        logger.error("WeatherAPI network error for query=%s: %s", params["q"], exc)
        raise WeatherServiceError("Unable to reach WeatherAPI.") from exc

    if response.status_code == 400:
        # WeatherAPI returns 400 with error.code 1006 when the location is unknown.
        try:
            error_payload = response.json().get("error", {})
        except ValueError:
            error_payload = {}
        if error_payload.get("code") == 1006:
            raise CityNotFoundError(error_payload.get("message", "City not found."))
        logger.error("WeatherAPI returned 400: %s", error_payload)
        raise WeatherServiceError(error_payload.get("message", "Invalid request to WeatherAPI."))

    if response.status_code == 401 or response.status_code == 403:
        logger.error("WeatherAPI rejected the API key (status=%s).", response.status_code)
        raise WeatherServiceError("WeatherAPI rejected the configured API key.")

    if response.status_code >= 500:
        logger.error("WeatherAPI upstream error (status=%s).", response.status_code)
        raise WeatherServiceError("WeatherAPI is temporarily unavailable.")

    if not response.ok:
        logger.error("WeatherAPI returned unexpected status=%s.", response.status_code)
        raise WeatherServiceError(f"WeatherAPI request failed with status {response.status_code}.")

    try:
        return response.json()
    except ValueError as exc:
        logger.error("WeatherAPI returned a non-JSON response.")
        raise WeatherServiceError("WeatherAPI returned an unreadable response.") from exc


def _format_day_label(date_str: str) -> str:
    """'2026-07-04' -> 'Saturday'"""
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").strftime("%A")
    except ValueError:
        return date_str


def _format_date_label(date_str: str) -> str:
    """'2026-07-04' -> '4 Jul'"""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return f"{dt.day} {dt.strftime('%b')}"
    except ValueError:
        return date_str


def _format_hour_label(time_str: str) -> str:
    """'2026-07-04 14:00' -> '2:00 PM'"""
    try:
        dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M")
        label = dt.strftime("%I:%M %p").lstrip("0")
        return label
    except ValueError:
        return time_str


def _build_next_12_hours(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten today's + tomorrow's hourly arrays and slice the next 12 hours
    starting from the current local hour."""
    forecast_days = raw.get("forecast", {}).get("forecastday", [])
    all_hours: list[dict[str, Any]] = []
    for day in forecast_days:
        all_hours.extend(day.get("hour", []))

    current_epoch = raw.get("location", {}).get("localtime_epoch")
    if current_epoch is None or not all_hours:
        selected = all_hours[:12]
    else:
        # Keep only hours at/after the current local time, then take 12.
        future_hours = [h for h in all_hours if h.get("time_epoch", 0) >= current_epoch]
        selected = future_hours[:12] if future_hours else all_hours[:12]

    result = []
    for hour in selected:
        condition = hour.get("condition", {})
        rain_chance = max(hour.get("chance_of_rain", 0), hour.get("chance_of_snow", 0))
        badge = None
        if rain_chance >= 70:
            badge = "Heavy Rain Risk"
        elif hour.get("wind_kph", 0) >= 40:
            badge = "High Wind"
        elif hour.get("uv", 0) >= 8:
            badge = "High UV"

        result.append(
            {
                "time": _format_hour_label(hour.get("time", "")),
                "temp": round(hour.get("temp_c", 0)),
                "condition": condition.get("text", "--"),
                "condition_code": to_condition_code(condition.get("code"), hour.get("is_day", 1)),
                "rain_chance": rain_chance,
                "wind_speed": round(hour.get("wind_kph", 0)),
                "humidity": hour.get("humidity"),
                "badge": badge,
            }
        )
    return result


def _build_7_day_forecast(raw: dict[str, Any]) -> list[dict[str, Any]]:
    forecast_days = raw.get("forecast", {}).get("forecastday", [])
    result = []
    for day in forecast_days[:7]:
        day_stats = day.get("day", {})
        condition = day_stats.get("condition", {})
        rain_chance = max(day_stats.get("daily_chance_of_rain", 0), day_stats.get("daily_chance_of_snow", 0))

        result.append(
            {
                "day": _format_day_label(day.get("date", "")),
                "date": _format_date_label(day.get("date", "")),
                "condition": condition.get("text", "--"),
                "condition_code": to_condition_code(condition.get("code"), 1),
                "detail": f"{condition.get('text', 'Weather')} with a {rain_chance}% chance of precipitation.",
                "temp_max": round(day_stats.get("maxtemp_c", 0)),
                "temp_min": round(day_stats.get("mintemp_c", 0)),
                "humidity": day_stats.get("avghumidity"),
                "wind_speed": round(day_stats.get("maxwind_kph", 0)),
                "rain_chance": rain_chance,
            }
        )
    return result


def transform_payload(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert a raw WeatherAPI forecast response into the exact response
    contract the frontend (script.js) expects."""
    location = raw.get("location", {})
    current = raw.get("current", {})
    condition = current.get("condition", {})
    air_quality = current.get("air_quality", {}) or {}
    today = (raw.get("forecast", {}).get("forecastday") or [{}])[0]
    today_stats = today.get("day", {})
    astro = today.get("astro", {})

    us_epa_index = air_quality.get("us-epa-index")

    return {
        "city": location.get("name", ""),
        "country": location.get("country", ""),
        "temperature": round(current.get("temp_c", 0)),
        "feels_like": round(current.get("feelslike_c", 0)),
        "condition": condition.get("text", "--"),
        "condition_code": to_condition_code(condition.get("code"), current.get("is_day", 1)),
        "temp_max": round(today_stats.get("maxtemp_c", current.get("temp_c", 0))),
        "temp_min": round(today_stats.get("mintemp_c", current.get("temp_c", 0))),
        "humidity": current.get("humidity", 0),
        "wind_speed": round(current.get("wind_kph", 0)),
        "wind_direction": current.get("wind_dir", ""),
        "pressure": round(current.get("pressure_mb", 0)),
        "visibility": round(current.get("vis_km", 0)),
        "uv_index": current.get("uv", 0),
        "aqi": round(us_epa_index) if us_epa_index is not None else 0,
        "hourly": _build_next_12_hours(raw),
        "forecast": _build_7_day_forecast(raw),
        # Extra fields beyond the frontend's minimal contract - harmless to
        # include (the render layer only reads known keys) and satisfy the
        # "fetch sunrise/sunset/moon phase/local time/timezone/air quality
        # breakdown" requirements.
        "condition_icon": condition.get("icon", ""),
        "cloud": current.get("cloud", 0),
        "sunrise": astro.get("sunrise", ""),
        "sunset": astro.get("sunset", ""),
        "moon_phase": astro.get("moon_phase", ""),
        "local_time": location.get("localtime", ""),
        "timezone": location.get("tz_id", ""),
        "air_quality": {
            "aqi": round(us_epa_index) if us_epa_index is not None else 0,
            "pm2_5": air_quality.get("pm2_5"),
            "pm10": air_quality.get("pm10"),
            "co": air_quality.get("co"),
            "no2": air_quality.get("no2"),
            "o3": air_quality.get("o3"),
            "so2": air_quality.get("so2"),
        },
    }
