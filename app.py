from __future__ import annotations

import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from config import config
from services.gemini_service import generate_insights
from services.weather_service import (
    CityNotFoundError,
    WeatherServiceError,
    fetch_forecast_raw,
    transform_payload,
)
from utils.cache import TTLCache
from utils.logger import get_logger
from utils.validators import ValidationError, validate_city, validate_coordinates

logger = get_logger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

_origins = (
    [o.strip() for o in config.CORS_ORIGINS.split(",")]
    if config.CORS_ORIGINS != "*"
    else "*"
)

CORS(app, resources={r"/api/*": {"origins": _origins}})

weather_cache = TTLCache(ttl_seconds=config.CACHE_TTL_SECONDS)

# =====================================================
# PWA ROUTES
# =====================================================

@app.route("/manifest.json")
def manifest():
    return send_from_directory(
        PUBLIC_DIR,
        "manifest.json",
        mimetype="application/manifest+json"
    )


@app.route("/sw.js")
def service_worker():
    return send_from_directory(
        PUBLIC_DIR,
        "sw.js",
        mimetype="application/javascript"
    )


@app.route("/offline.html")
def offline():
    return send_from_directory(PUBLIC_DIR, "offline.html")


@app.route("/icon-192.png")
def icon192():
    return send_from_directory(PUBLIC_DIR, "icon-192.png")


@app.route("/icon-512.png")
def icon512():
    return send_from_directory(PUBLIC_DIR, "icon-512.png")


# =====================================================
# STATIC PAGE
# =====================================================

@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")


# =====================================================
# API
# =====================================================

@app.route("/api/weather", methods=["GET"])
def get_weather():
    city_param = request.args.get("city")
    lat_param = request.args.get("lat")
    lon_param = request.args.get("lon")

    try:
        if lat_param is not None and lon_param is not None:
            lat, lon = validate_coordinates(lat_param, lon_param)
            city = None
            cache_key = f"coords:{lat}:{lon}"
        elif city_param is not None:
            city = validate_city(city_param)
            lat = lon = None
            cache_key = f"city:{city.lower()}"
        else:
            return jsonify(
                {"error": "Provide either 'city' or both 'lat' and 'lon'."}
            ), 400

    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400

    cached = weather_cache.get(cache_key)
    if cached is not None:
        logger.info("Cache hit for %s", cache_key)
        return jsonify(cached), 200

    try:
        raw = fetch_forecast_raw(city=city, lat=lat, lon=lon)

    except RuntimeError as exc:
        if str(exc) == "MISSING_WEATHER_API_KEY":
            logger.error("WEATHER_API_KEY is not configured.")
            return jsonify({"error": "Missing WEATHER_API_KEY"}), 500
        raise

    except CityNotFoundError:
        return jsonify({"error": "City not found"}), 404

    except WeatherServiceError:
        return jsonify({"error": "Weather service unavailable"}), 500

    weather = transform_payload(raw)

    try:
        insights = generate_insights(weather)

    except RuntimeError as exc:
        if str(exc) == "MISSING_GEMINI_API_KEY":
            return jsonify({"error": "Missing GEMINI_API_KEY"}), 500
        raise

    weather["insights"] = insights
    weather_cache.set(cache_key, weather)

    return jsonify(weather), 200


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "service": "CanPredict AI Weather API",
        "version": "1.0.0"
    }), 200


# =====================================================
# ERROR HANDLERS
# =====================================================

@app.errorhandler(404)
def handle_404(_err):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404

    return send_from_directory(app.static_folder, "index.html")


@app.errorhandler(500)
def handle_500(err):
    logger.exception("Unhandled server error: %s", err)
    return jsonify({"error": "Internal server error"}), 500


# =====================================================
# MAIN
# =====================================================

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=config.PORT,
        debug=config.DEBUG,
    )
