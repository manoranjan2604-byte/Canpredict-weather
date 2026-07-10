"""Request input validation helpers for the /api/weather endpoint."""
from __future__ import annotations

import re

_CITY_PATTERN = re.compile(r"^[a-zA-Z\u00C0-\u024F\s'\-,.]{1,100}$")


class ValidationError(ValueError):
    """Raised when user-supplied query parameters are invalid."""


def validate_city(city: str) -> str:
    """Validate and normalize a city name query parameter."""
    cleaned = (city or "").strip()
    if not cleaned:
        raise ValidationError("City name must not be empty.")
    if len(cleaned) > 100:
        raise ValidationError("City name is too long.")
    if not _CITY_PATTERN.match(cleaned):
        raise ValidationError("City name contains invalid characters.")
    return cleaned


def validate_coordinates(lat: str, lon: str) -> tuple[float, float]:
    """Validate and parse latitude/longitude query parameters."""
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError) as exc:
        raise ValidationError("Latitude and longitude must be numeric.") from exc

    if not (-90.0 <= lat_f <= 90.0):
        raise ValidationError("Latitude must be between -90 and 90.")
    if not (-180.0 <= lon_f <= 180.0):
        raise ValidationError("Longitude must be between -180 and 180.")

    return lat_f, lon_f
