# CanPredict AI - Flask Backend

A production-ready Flask backend for the CanPredict AI weather app. It serves
your existing frontend (`index.html`, `forecast.html`, `insights.html`,
`profile.html`, `styles.css`, `script.js` — all untouched) and exposes a
single JSON API that returns **live** weather from WeatherAPI.com plus
**live** AI-generated insights from Google Gemini.

- No mock/dummy data
- No machine learning model, no `weather.csv`
- Live weather sourced exclusively from WeatherAPI.com
- Works for any city in the world, or by latitude/longitude
- Stateless, cache is in-memory only (no files written to disk)

## Project structure

```
canpredict-backend/
├── app.py                    # Flask app, routes, error handling
├── config.py                 # Environment-based configuration
├── requirements.txt
├── .env.example
├── render.yaml                # Render deployment blueprint
├── services/
│   ├── weather_service.py    # WeatherAPI integration + response shaping
│   └── gemini_service.py     # Gemini AI insights + rule-based fallback
├── utils/
│   ├── cache.py               # Thread-safe in-memory TTL cache
│   ├── condition_mapper.py    # WeatherAPI code -> frontend condition_code
│   ├── validators.py          # Input validation
│   └── logger.py              # stdout logging (Render-friendly)
└── static/                    # Your existing frontend, served as-is
    ├── index.html
    ├── forecast.html
    ├── insights.html
    ├── profile.html
    ├── styles.css
    └── script.js
```

## 1. Get your API keys

- **WeatherAPI.com**: sign up at https://www.weatherapi.com/my/ and copy your API key.
- **Google Gemini**: create a key at https://aistudio.google.com/apikey.

## 2. Local setup

```bash
cd canpredict-backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env and paste in WEATHER_API_KEY and GEMINI_API_KEY
```

Run the dev server:

```bash
python app.py
```

Visit http://127.0.0.1:5000 — the frontend loads and calls `/api/weather`
on the same origin, so no configuration is needed for local development.

## 3. API

### `GET /api/weather?city={cityName}`
### `GET /api/weather?lat={lat}&lon={lon}`

Returns:

```json
{
  "city": "London",
  "country": "United Kingdom",
  "temperature": 18,
  "feels_like": 17,
  "condition": "Partly cloudy",
  "condition_code": "partly_cloudy",
  "temp_max": 21,
  "temp_min": 13,
  "humidity": 68,
  "wind_speed": 14,
  "wind_direction": "SW",
  "pressure": 1014,
  "visibility": 10,
  "uv_index": 5,
  "aqi": 2,
  "hourly": [ { "time": "2:00 PM", "temp": 19, "condition": "Cloudy", "condition_code": "cloudy", "rain_chance": 10, "wind_speed": 15, "humidity": 65, "badge": null } ],
  "forecast": [ { "day": "Saturday", "date": "4 Jul", "condition": "Light rain", "condition_code": "rain", "detail": "Light rain with a 40% chance of precipitation.", "temp_max": 22, "temp_min": 14, "humidity": 70, "wind_speed": 18, "rain_chance": 40 } ],
  "insights": {
    "title": "Mild & Manageable",
    "summary": "...",
    "recommendation": "...",
    "rain_chance": 40,
    "rain_label": "Moderate",
    "wind_label": "Gentle",
    "best_time": { "range": "9 AM – 1 PM", "description": "..." },
    "time_zones": [ { "label": "6 AM – 9 AM", "description": "...", "curve_x": 20, "curve_y": 45 } ]
  }
}
```

A few extra convenience fields (`condition_icon`, `cloud`, `sunrise`,
`sunset`, `moon_phase`, `local_time`, `timezone`, `air_quality` — the full
PM2.5/PM10/CO/NO2/O3/SO2 breakdown) are included alongside the fields above.
The existing frontend ignores fields it doesn't recognize, so this is
additive and never breaks rendering.

`aqi` is WeatherAPI's US EPA index (1 = Good … 6 = Hazardous); the full
pollutant concentrations are under `air_quality`.

### Errors

| Status | Body | When |
|---|---|---|
| 400 | `{"error": "..."}` | Missing/invalid `city` or `lat`/`lon` |
| 404 | `{"error": "City not found"}` | WeatherAPI can't resolve the location |
| 500 | `{"error": "Weather service unavailable"}` | WeatherAPI network/server failure |
| 500 | `{"error": "Missing WEATHER_API_KEY"}` | Key not configured |
| 500 | `{"error": "Missing GEMINI_API_KEY"}` | Key not configured |

If Gemini itself times out or returns something unparsable (but the key
*is* configured), the backend falls back to a deterministic, rule-based
insights generator instead of failing the whole request — the weather data
you already have live is too valuable to throw away over a flaky AI call.

## 4. Caching

Identical requests (same city, or same rounded lat/lon) are cached in memory
for `CACHE_TTL_SECONDS` (default 180s / 3 minutes) to reduce WeatherAPI and
Gemini usage. The cache is per-process and resets on redeploy — nothing is
persisted to disk, keeping the app stateless.

## 5. Deploying to Render

1. Push this project to a GitHub repository.
2. In Render, choose **New + → Blueprint** and point it at the repo (it will
   pick up `render.yaml` automatically), or **New + → Web Service** manually
   with:
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app`
3. Set the environment variables in the Render dashboard:
   - `WEATHER_API_KEY`
   - `GEMINI_API_KEY`
   - (Render sets `PORT` automatically — `app.py` already reads it.)
4. Deploy. Your app will be live at `https://YOUR-APP.onrender.com`, serving
   both the frontend and the `/api/weather` endpoint from the same origin —
   `script.js`'s `API_CONFIG.BASE_URL = '/api'` needs no changes.

## 6. Notes on the frontend contract

`script.js` already documents the exact response shape it expects at the top
of the file (`BACKEND CONTRACT`). This backend was built to match that
contract field-for-field; no frontend changes were made or are required.
