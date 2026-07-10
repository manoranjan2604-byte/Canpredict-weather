"""
Maps WeatherAPI.com's numeric condition codes to the small set of
`condition_code` slugs the existing frontend already knows how to render
(see CONDITION_ICON_MAP in script.js): clear, sunny, partly_cloudy, cloudy,
overcast, drizzle, rain, heavy_rain, thunderstorm, snow, fog, wind, default.
"""
from __future__ import annotations

# WeatherAPI condition.code -> frontend condition_code slug.
# Reference: https://www.weatherapi.com/docs/weather_conditions.json
_CODE_MAP: dict[int, str] = {
    1000: "sunny",  # Sunny / Clear (day/night handled separately)
    1003: "partly_cloudy",
    1006: "cloudy",
    1009: "overcast",
    1030: "fog",  # Mist
    1063: "rain",  # Patchy rain possible
    1066: "snow",  # Patchy snow possible
    1069: "snow",  # Patchy sleet possible
    1072: "drizzle",  # Patchy freezing drizzle possible
    1087: "thunderstorm",  # Thundery outbreaks possible
    1114: "snow",  # Blowing snow
    1117: "snow",  # Blizzard
    1135: "fog",
    1147: "fog",  # Freezing fog
    1150: "drizzle",  # Patchy light drizzle
    1153: "drizzle",  # Light drizzle
    1168: "drizzle",  # Freezing drizzle
    1171: "drizzle",  # Heavy freezing drizzle
    1180: "rain",  # Patchy light rain
    1183: "rain",  # Light rain
    1186: "rain",  # Moderate rain at times
    1189: "rain",  # Moderate rain
    1192: "heavy_rain",  # Heavy rain at times
    1195: "heavy_rain",  # Heavy rain
    1198: "rain",  # Light freezing rain
    1201: "heavy_rain",  # Moderate or heavy freezing rain
    1204: "rain",  # Light sleet
    1207: "heavy_rain",  # Moderate or heavy sleet
    1210: "snow",  # Patchy light snow
    1213: "snow",  # Light snow
    1216: "snow",  # Patchy moderate snow
    1219: "snow",  # Moderate snow
    1222: "snow",  # Patchy heavy snow
    1225: "snow",  # Heavy snow
    1237: "snow",  # Ice pellets
    1240: "rain",  # Light rain shower
    1243: "heavy_rain",  # Moderate or heavy rain shower
    1246: "heavy_rain",  # Torrential rain shower
    1249: "rain",  # Light sleet showers
    1252: "heavy_rain",  # Moderate or heavy sleet showers
    1255: "snow",  # Light snow showers
    1258: "snow",  # Moderate or heavy snow showers
    1261: "snow",  # Light showers of ice pellets
    1264: "snow",  # Moderate or heavy showers of ice pellets
    1273: "thunderstorm",  # Patchy light rain with thunder
    1276: "thunderstorm",  # Moderate or heavy rain with thunder
    1279: "thunderstorm",  # Patchy light snow with thunder
    1282: "thunderstorm",  # Moderate or heavy snow with thunder
}


def to_condition_code(weatherapi_code: int | None, is_day: int | None = 1) -> str:
    """Translate a WeatherAPI numeric code into a frontend condition_code slug."""
    if weatherapi_code is None:
        return "default"

    slug = _CODE_MAP.get(int(weatherapi_code), "default")

    # WeatherAPI code 1000 means "Clear" at night and "Sunny" during the day.
    if weatherapi_code == 1000 and not is_day:
        return "clear"

    return slug
