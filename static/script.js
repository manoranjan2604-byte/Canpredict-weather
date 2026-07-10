/**
 * =====================================================================
 * CanPredict AI - Application Script
 * =====================================================================
 * Shared across index.html, forecast.html, insights.html, profile.html.
 * Fully dynamic: every weather value on screen comes from a backend
 * REST API response. No city list, no dummy weather is hardcoded here.
 *
 * ---------------------------------------------------------------------
 * BACKEND CONTRACT (Flask, to be served from API_CONFIG.BASE_URL)
 * ---------------------------------------------------------------------
 * GET {BASE_URL}/weather?city={cityName}
 * GET {BASE_URL}/weather?lat={lat}&lon={lon}
 *
 * Response 200 JSON:
 * {
 *   "city": "London",
 *   "country": "GB",
 *   "temperature": 24,
 *   "feels_like": 26,
 *   "condition": "Partly Cloudy",
 *   "condition_code": "partly_cloudy",
 *   "temp_max": 27,
 *   "temp_min": 18,
 *   "humidity": 70,
 *   "wind_speed": 12,
 *   "wind_direction": "NW",
 *   "uv_index": 6,
 *   "aqi": 52,
 *   "pressure": 1012,
 *   "hourly": [
 *     { "time": "2:00 PM", "temp": 24, "condition_code": "cloudy",
 *       "rain_chance": 20, "wind_speed": 14, "badge": "Cloud Build" }
 *   ],
 *   "forecast": [
 *     { "day": "Saturday", "date": "4 Jul", "condition": "Heavy Showers",
 *       "condition_code": "rain", "detail": "Monsoon inbound.",
 *       "temp_max": 31, "temp_min": 24, "rain_chance": 70 }
 *   ],
 *   "insights": {
 *     "title": "Perfect Morning! ☀️",
 *     "summary": "Clear skies this morning ...",
 *     "recommendation": "Carry an umbrella on Thursday.",
 *     "rain_chance": 20, "rain_label": "Low",
 *     "wind_label": "Gentle",
 *     "best_time": { "range": "9 AM – 1 PM", "description": "..." },
 *     "time_zones": [
 *       { "label": "6 AM – 9 AM", "description": "...", "curve_x": 35, "curve_y": 50 }
 *     ]
 *   }
 * }
 *
 * Any missing/optional field is handled gracefully by the render layer.
 * =====================================================================
 */

(() => {
    'use strict';

    /* ================================================================
     * 1. CONFIG
     * ================================================================ */
    const API_CONFIG = {
        BASE_URL: '/api',
        ENDPOINTS: {
            WEATHER: '/weather'
        },
        TIMEOUT_MS: 10000,
        RETRY_COUNT: 1
    };

    const STORAGE_KEYS = {
        CITY: 'cp_selected_city',
        THEME: 'cp_theme',
        UNITS: 'cp_units',
        LAST_WEATHER: 'cp_last_weather',
        RECENT_SEARCHES: 'cp_recent_searches'
    };

    const DEFAULTS = {
        THEME: 'amoled',
        UNITS: 'metric',
        CITY: 'London'
    };

    /* ================================================================
     * 2. STORAGE (localStorage wrapper, fails safely)
     * ================================================================ */
    const Storage = {
        get(key, fallback = null) {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return fallback;
                try { return JSON.parse(raw); } catch (_) { return raw; }
            } catch (_) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                const toStore = typeof value === 'string' ? value : JSON.stringify(value);
                localStorage.setItem(key, toStore);
            } catch (_) { /* storage unavailable, ignore */ }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (_) { /* noop */ }
        }
    };

    /* ================================================================
     * 3. DOM UTILITIES
     * ================================================================ */
    const DOM = {
        byId: (id) => document.getElementById(id),
        qs: (sel, root = document) => root.querySelector(sel),
        qsa: (sel, root = document) => Array.from(root.querySelectorAll(sel)),
        setText(id, text) {
            const el = this.byId(id);
            if (el) el.textContent = text;
        },
        setHTML(id, html) {
            const el = this.byId(id);
            if (el) el.innerHTML = html;
        },
        setAttr(id, attr, val) {
            const el = this.byId(id);
            if (el) el.setAttribute(attr, val);
        },
        show(el) { if (el) el.classList.remove('is-hidden'); },
        hide(el) { if (el) el.classList.add('is-hidden'); }
    };

    function debounce(fn, delay) {
        let timer = null;
        return function debounced(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    }

    /* ================================================================
     * 4. FORMATTING / UNIT CONVERSION
     * All raw values arriving from the API are treated as METRIC
     * (Celsius, km/h). Conversion to imperial happens at render time
     * so toggling units never requires a re-fetch.
     * ================================================================ */
    const Units = {
        current() {
            return document.body.getAttribute('data-units') || DEFAULTS.UNITS;
        },
        temp(celsius) {
            if (celsius === null || celsius === undefined || Number.isNaN(Number(celsius))) return '--';
            const c = Number(celsius);
            if (this.current() === 'imperial') {
                return Math.round((c * 9) / 5 + 32);
            }
            return Math.round(c);
        },
        wind(kmh) {
            if (kmh === null || kmh === undefined || Number.isNaN(Number(kmh))) return '--';
            const k = Number(kmh);
            if (this.current() === 'imperial') {
                return `${Math.round(k * 0.621371)} mph`;
            }
            return `${Math.round(k)} km/h`;
        }
    };

    /* ================================================================
     * 5. CONDITION -> ICON / COLOR MAPPING
     * ================================================================ */
    const CONDITION_ICON_MAP = {
        clear: { icon: 'sun', tint: 'orange-tint' },
        sunny: { icon: 'sun', tint: 'orange-tint' },
        partly_cloudy: { icon: 'cloud-sun', tint: 'orange-tint' },
        cloudy: { icon: 'cloud', tint: 'cyan-tint' },
        overcast: { icon: 'cloud', tint: 'cyan-tint' },
        drizzle: { icon: 'cloud-drizzle', tint: 'blue-tint' },
        rain: { icon: 'cloud-rain', tint: 'blue-tint' },
        heavy_rain: { icon: 'cloud-rain', tint: 'blue-tint' },
        thunderstorm: { icon: 'cloud-lightning', tint: 'purple-tint' },
        snow: { icon: 'snowflake', tint: 'cyan-tint' },
        fog: { icon: 'cloud-fog', tint: 'cyan-tint' },
        wind: { icon: 'wind', tint: 'cyan-tint' },
        default: { icon: 'cloud', tint: 'cyan-tint' }
    };

    function iconFor(conditionCode) {
        const key = (conditionCode || '').toLowerCase().replace(/\s+/g, '_');
        return CONDITION_ICON_MAP[key] || CONDITION_ICON_MAP.default;
    }

    /* ================================================================
     * 6. API LAYER
     * ================================================================ */
    class ApiError extends Error {
        constructor(message, type, status = null) {
            super(message);
            this.name = 'ApiError';
            this.type = type; // 'network' | 'timeout' | 'not_found' | 'server' | 'invalid'
            this.status = status;
        }
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = API_CONFIG.TIMEOUT_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            return res;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new ApiError('Request timed out. Please try again.', 'timeout');
            }
            throw new ApiError('Unable to reach the server. Check your internet connection.', 'network');
        } finally {
            clearTimeout(timer);
        }
    }

    function validateWeatherPayload(data) {
        if (!data || typeof data !== 'object') {
            throw new ApiError('Received an invalid response from the server.', 'invalid');
        }
        if (typeof data.city !== 'string' || typeof data.temperature === 'undefined') {
            throw new ApiError('Weather data is missing required fields.', 'invalid');
        }
        return data;
    }

    async function requestWeather(params) {
        const query = new URLSearchParams(params).toString();
        const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.WEATHER}?${query}`;

        let lastError = null;
        for (let attempt = 0; attempt <= API_CONFIG.RETRY_COUNT; attempt++) {
            try {
                const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });

                if (res.status === 404) {
                    throw new ApiError('City not found. Please check the spelling and try again.', 'not_found', 404);
                }
                if (res.status >= 500) {
                    throw new ApiError('The weather service is temporarily unavailable.', 'server', res.status);
                }
                if (!res.ok) {
                    throw new ApiError(`Request failed with status ${res.status}.`, 'server', res.status);
                }

                let json;
                try {
                    json = await res.json();
                } catch (_) {
                    throw new ApiError('The server returned an unreadable response.', 'invalid');
                }

                return validateWeatherPayload(json);
            } catch (err) {
                lastError = err instanceof ApiError ? err : new ApiError(err.message, 'network');
                // Do not retry on definitive client errors
                if (lastError.type === 'not_found' || lastError.type === 'invalid') break;
            }
        }
        throw lastError;
    }

    function fetchWeatherByCity(city) {
        return requestWeather({ city });
    }

    function fetchWeatherByCoords(lat, lon) {
        return requestWeather({ lat, lon });
    }

    /* ================================================================
     * 7. APPLICATION STATE
     * ================================================================ */
    const AppState = {
        city: Storage.get(STORAGE_KEYS.CITY, DEFAULTS.CITY),
        data: Storage.get(STORAGE_KEYS.LAST_WEATHER, null),
        loading: false
    };

    /* ================================================================
     * 8. RENDER LAYER
     * Every render function is null-safe: it only touches elements
     * that exist on the current page.
     * ================================================================ */
    function refreshIcons() {
        if (window.lucide) lucide.createIcons();
    }

    function renderGlobalLocation(data) {
        const label = data ? `${data.city}${data.country ? ', ' + data.country : ''}` : '--';
        DOM.qsa('.global-loc-display').forEach((el) => { el.textContent = label; });
    }

    function renderHome(data) {
        const heroTemp = DOM.byId('hero-temp');
        if (!heroTemp) return; // not on this page

        DOM.setText('hero-temp', Units.temp(data.temperature));
        DOM.setText('hero-condition', data.condition || '—');
        DOM.setText('hero-feels', Units.temp(data.feels_like));
        DOM.setText('hero-max', Units.temp(data.temp_max));
        DOM.setText('hero-min', Units.temp(data.temp_min));

        DOM.setText('val-humidity', typeof data.humidity === 'number' ? `${data.humidity}%` : '--');
        DOM.setText('val-wind', Units.wind(data.wind_speed));
        DOM.setText('val-uv', typeof data.uv_index === 'number' ? data.uv_index : '--');
        DOM.setText('val-aqi', typeof data.aqi === 'number' ? data.aqi : '--');

        const heroIcon = DOM.byId('hero-condition-icon');
        if (heroIcon) {
            const { icon, tint } = iconFor(data.condition_code);
            heroIcon.setAttribute('data-lucide', icon);

            heroIcon.classList.remove(
                'orange-tint',
                'cyan-tint',
                'blue-tint',
                'purple-tint'
            );

            heroIcon.classList.add('hero-condition-icon', tint);
        }

        renderHourlyStrip(data.hourly);
        renderAiCapsule(data.insights);
        refreshIcons();
    }

    function renderHourlyStrip(hourly) {
        const container = DOM.byId('hourly-strip-row');
        if (!container) return;
        if (!Array.isArray(hourly) || hourly.length === 0) {
            container.innerHTML = `<p class="empty-state-text">No hourly data available.</p>`;
            return;
        }
        const items = hourly.slice(0, 6);
        container.innerHTML = items.map((h, idx) => {
            const { icon, tint } = iconFor(h.condition_code);
            const label = idx === 0 ? 'Now' : escapeHTML(h.time);
            return `
                <div class="time-node ${idx === 0 ? 'active' : ''}">
                    <span class="node-time">${label}</span>
                    <div class="node-icon-box"><i data-lucide="${icon}" class="${tint}"></i></div>
                    <span class="node-temp">${Units.temp(h.temp)}°</span>
                </div>`;
        }).join('');
    }

    function renderAiCapsule(insights) {
        const el = DOM.byId('ai-dynamic-summary');
        if (!el) return;
        el.textContent = (insights && insights.summary) || 'No AI insight available right now.';
    }

    function renderForecastDaily(forecast) {
        const container = DOM.byId('daily-forecast-list');
        if (!container) return;
        if (!Array.isArray(forecast) || forecast.length === 0) {
            container.innerHTML = `<p class="empty-state-text">No forecast data available.</p>`;
            return;
        }
        container.innerHTML = forecast.map((day) => {
            const { icon, tint } = iconFor(day.condition_code);
            const rain = typeof day.rain_chance === 'number' ? day.rain_chance : 0;
            return `
                <div class="forecast-row-item">
                    <div class="day-meta">
                        <span class="day-title">${escapeHTML(day.day || '--')}</span>
                        <span class="day-subtext">${escapeHTML(day.date || '')}</span>
                    </div>
                    <div class="condition-mid-block">
                        <i data-lucide="${icon}" class="${tint} row-icon"></i>
                        <div class="cond-text-group">
                            <p class="cond-summary">${escapeHTML(day.condition || '--')}</p>
                            <p class="cond-detail">${escapeHTML(day.detail || '')}</p>
                        </div>
                    </div>
                    <div class="range-metric-block">
                        <div>
                            <span class="range-high">${Units.temp(day.temp_max)}°</span><span class="range-slash">/</span><span class="range-low">${Units.temp(day.temp_min)}°</span>
                        </div>
                        <div class="progress-track-bar"><div class="progress-fill" style="left:0%; width:${Math.max(5, Math.min(100, rain))}%;"></div></div>
                    </div>
                </div>`;
        }).join('');
        refreshIcons();
    }

    function renderForecastHourly(hourly) {
        const container = DOM.byId('hourly-forecast-grid');
        if (!container) return;
        if (!Array.isArray(hourly) || hourly.length === 0) {
            container.innerHTML = `<p class="empty-state-text">No hourly data available.</p>`;
            return;
        }
        container.innerHTML = hourly.map((h) => {
            const { icon, tint } = iconFor(h.condition_code);
            const rain = typeof h.rain_chance === 'number' ? h.rain_chance : 0;
            return `
                <div class="hourly-detailed-card">
                    <div class="hourly-card-lead">
                        <span class="h-time">${escapeHTML(h.time || '--')}</span>
                        ${h.badge ? `<span class="h-badge warning-badge">${escapeHTML(h.badge)}</span>` : ''}
                    </div>
                    <div class="hourly-card-body">
                        <div class="h-main-row"><h2>${Units.temp(h.temp)}°</h2><i data-lucide="${icon}" class="${tint}"></i></div>
                        <div class="h-stat-row">
                            <span><i data-lucide="droplets"></i> Rain: ${rain}%</span>
                            <span><i data-lucide="wind"></i> ${Units.wind(h.wind_speed)}</span>
                        </div>
                    </div>
                </div>`;
        }).join('');
        refreshIcons();
    }

    function renderInsights(data) {
        const insights = data && data.insights;
        if (!DOM.byId('insight-title-text')) return; // not on this page

        DOM.setText('insight-title-text', (insights && insights.title) || 'No Insight Available');
        DOM.setText('insight-desc-text', (insights && insights.summary) || 'Insights will appear once weather data loads.');

        const rain = insights ? insights.rain_chance : null;
        DOM.setText('expect-rain-val', typeof rain === 'number' ? `${rain}%` : '--');
        DOM.setText('expect-rain-lbl', (insights && insights.rain_label) || '--');

        DOM.setText('expect-max-val', Units.temp(data.temp_max));
        DOM.setText('expect-min-val', Units.temp(data.temp_min));
        DOM.setText('expect-wind-val', Units.wind(data.wind_speed));
        DOM.setText('expect-wind-lbl', (insights && insights.wind_label) || '--');

        const bestTime = insights && insights.best_time;
        DOM.setText('best-time-range', (bestTime && bestTime.range) || '--');
        DOM.setText('best-time-desc', (bestTime && bestTime.description) || 'No recommendation available.');

        renderTimeZones(insights && insights.time_zones);

        DOM.setText('rec-body-text', (insights && insights.recommendation) || 'No recommendation available right now.');
    }

    function renderTimeZones(zones) {
        const container = DOM.byId('track-zone-container');
        if (!container) return;
        if (!Array.isArray(zones) || zones.length === 0) {
            container.innerHTML = '';
            return;
        }
        const widthPct = 100 / zones.length;
        container.innerHTML = zones.map((z, idx) => `
            <div class="track-zone"
                 style="left:${(idx * widthPct).toFixed(2)}%; width:${widthPct.toFixed(2)}%;"
                 data-time="${escapeHTML(z.label)}"
                 data-desc="${escapeHTML(z.description)}"
                 data-cx="${z.curve_x ?? 80}"
                 data-cy="${z.curve_y ?? 40}">
            </div>`).join('');
        wireTrackZoneHover();
    }

    /* ================================================================
     * 9. LOADING / ERROR UI
     * ================================================================ */
    function setLoading(isLoading) {
        AppState.loading = isLoading;
        DOM.qsa('.loading-overlay').forEach((el) => {
            el.classList.toggle('is-active', isLoading);
            el.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
        });
        const syncText = DOM.byId('sync-text');
        if (syncText && isLoading) syncText.textContent = 'Syncing…';
        const spinIcon = DOM.qs('#sync-trigger .spin-icon');
        if (spinIcon) spinIcon.style.animation = isLoading ? 'rotateAssetLoop 0.6s linear infinite' : 'rotateAssetLoop 8s linear infinite';
    }

    function showToast(message, tone = 'error') {
        let toast = DOM.byId('app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.className = 'app-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = `app-toast app-toast-${tone} app-toast-visible`;
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => toast.classList.remove('app-toast-visible'), 4000);
    }

    function messageForError(err) {
        switch (err && err.type) {
            case 'not_found': return err.message || 'City not found. Try another search.';
            case 'timeout': return 'The request took too long. Please try again.';
            case 'network': return 'No connection to the server. Check your network and try again.';
            case 'server': return 'The weather service is unavailable right now. Please try again shortly.';
            default: return (err && err.message) || 'Something went wrong. Please try again.';
        }
    }

    /* ================================================================
     * 10. CORE DATA FLOW
     * ================================================================ */
    async function loadWeather({ city, lat, lon, silent = false } = {}) {
        if (!silent) setLoading(true);
        try {
            const data = (lat !== undefined && lon !== undefined)
                ? await fetchWeatherByCoords(lat, lon)
                : await fetchWeatherByCity(city);

            AppState.city = data.city;
            AppState.data = data;
            Storage.set(STORAGE_KEYS.CITY, data.city);
            Storage.set(STORAGE_KEYS.LAST_WEATHER, data);
            addRecentSearch(data.city);

            renderAll(data);
            const syncText = DOM.byId('sync-text');
            if (syncText) syncText.textContent = 'Updated Just Now';
            return data;
        } catch (err) {
            showToast(messageForError(err), 'error');
            const syncText = DOM.byId('sync-text');
            if (syncText) syncText.textContent = 'Update failed';
            throw err;
        } finally {
            if (!silent) setLoading(false);
        }
    }

    function renderAll(data) {
        if (!data) return;
        renderGlobalLocation(data);
        renderHome(data);
        renderForecastDaily(data.forecast);
        renderForecastHourly(data.hourly);
        renderInsights(data);
    }

    /* ================================================================
     * 11. RECENT SEARCHES
     * ================================================================ */
    function getRecentSearches() {
        return Storage.get(STORAGE_KEYS.RECENT_SEARCHES, []);
    }

    function addRecentSearch(city) {
        if (!city) return;
        let list = getRecentSearches().filter((c) => c.toLowerCase() !== city.toLowerCase());
        list.unshift(city);
        list = list.slice(0, 5);
        Storage.set(STORAGE_KEYS.RECENT_SEARCHES, list);
        renderRecentSearches();
    }

    function renderRecentSearches() {
        const container = DOM.byId('recent-searches-list');
        if (!container) return;
        const list = getRecentSearches();
        if (list.length === 0) {
            container.innerHTML = `<p class="empty-state-text">Your recent searches will appear here.</p>`;
            return;
        }
        container.innerHTML = list.map((city) => `
            <button class="location-option-row recent-search-row" data-recent-city="${escapeHTML(city)}">
                <i data-lucide="clock" class="blue-tint"></i>
                <div class="loc-option-meta"><strong>${escapeHTML(city)}</strong></div>
                <i data-lucide="chevron-right" class="chevron-arrow"></i>
            </button>`).join('');
        refreshIcons();
    }

    /* ================================================================
     * 12. SEARCH MODAL
     * ================================================================ */
    function initSearchModal() {
        const modal = DOM.byId('location-modal');
        const closeBtn = DOM.byId('modal-close-trigger');
        const input = DOM.byId('city-search-input');
        const searchBtn = DOM.byId('city-search-submit');
        const errorEl = DOM.byId('search-error-text');
        const geoBtn = DOM.byId('geo-locate-trigger');

        if (!modal) return;

        let lastFocusedTrigger = null;

        function openModal(trigger) {
            lastFocusedTrigger = trigger || document.activeElement;
            modal.classList.add('modal-open');
            modal.setAttribute('aria-hidden', 'false');
            renderRecentSearches();
            if (input) setTimeout(() => input.focus(), 300);
        }

        function closeModal() {
            modal.classList.remove('modal-open');
            modal.setAttribute('aria-hidden', 'true');
            if (lastFocusedTrigger && typeof lastFocusedTrigger.focus === 'function') {
                lastFocusedTrigger.focus();
            }
        }

        DOM.qsa('.modal-open-trigger').forEach((trigger) => {
            trigger.addEventListener('click', () => openModal(trigger));
        });

        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }

        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        function clearSearchError() {
            if (errorEl) { errorEl.textContent = ''; DOM.hide(errorEl); }
        }

        function showSearchError(msg) {
            if (errorEl) { errorEl.textContent = msg; DOM.show(errorEl); }
        }

        async function runSearch() {
            if (!input) return;
            const raw = input.value.trim().replace(/\s+/g, ' ');
            if (!raw) {
                showSearchError('Please enter a city name.');
                return;
            }
            if (!/^[a-zA-Z\u00C0-\u024F\s'\-,.]+$/.test(raw)) {
                showSearchError('Please use only letters for the city name.');
                return;
            }
            clearSearchError();
            if (searchBtn) searchBtn.disabled = true;
            input.disabled = true;
            try {
                await loadWeather({ city: raw });
                closeModal();
                input.value = '';
            } catch (err) {
                showSearchError(messageForError(err));
            } finally {
                if (searchBtn) searchBtn.disabled = false;
                input.disabled = false;
            }
        }

        const debouncedClearError = debounce(clearSearchError, 200);

        if (searchBtn) searchBtn.addEventListener('click', runSearch);
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    runSearch();
                }
            });
            input.addEventListener('input', debouncedClearError);
        }

        if (geoBtn) {
            geoBtn.addEventListener('click', () => {
                if (!('geolocation' in navigator)) {
                    showToast('Geolocation is not supported on this device.', 'error');
                    return;
                }
                setLoading(true);
                navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                        try {
                            await loadWeather({ lat: pos.coords.latitude.toFixed(4), lon: pos.coords.longitude.toFixed(4) });
                            closeModal();
                        } catch (err) {
                            showSearchError(messageForError(err));
                        } finally {
                            setLoading(false);
                        }
                    },
                    () => {
                        setLoading(false);
                        showToast('Unable to detect your location. Please search manually.', 'error');
                    },
                    { timeout: 8000 }
                );
            });
        }

        // Event delegation for recent-search rows (re-rendered dynamically)
        const recentList = DOM.byId('recent-searches-list');
        if (recentList) {
            recentList.addEventListener('click', (e) => {
                const row = e.target.closest('[data-recent-city]');
                if (!row) return;
                const city = row.getAttribute('data-recent-city');
                loadWeather({ city }).then(() => closeModal()).catch(() => {});
            });
        }
    }

    /* ================================================================
     * 13. NAVIGATION: DRAWER
     * ================================================================ */
    function initDrawer() {
        const appDrawer = DOM.byId('app-drawer');
        const openTrigger = DOM.byId('drawer-open-trigger');
        const closeTrigger = DOM.byId('drawer-close-trigger');
        if (!appDrawer) return;

        function openDrawer() {
            appDrawer.classList.add('drawer-open');
            appDrawer.setAttribute('aria-hidden', 'false');
        }
        function closeDrawer() {
            appDrawer.classList.remove('drawer-open');
            appDrawer.setAttribute('aria-hidden', 'true');
            if (openTrigger) openTrigger.focus();
        }

        if (openTrigger) {
            openTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                openDrawer();
            });
        }
        if (closeTrigger) {
            closeTrigger.addEventListener('click', closeDrawer);
        }
        DOM.qsa('.drawer-item', appDrawer).forEach((item) => {
            item.addEventListener('click', () => appDrawer.classList.remove('drawer-open'));
        });
        appDrawer.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    /* ================================================================
     * 14. FORECAST SEGMENTED CONTROL
     * ================================================================ */
    function initForecastSegments() {
        const segments = DOM.qsa('.segment-btn');
        if (segments.length === 0) return;
        segments.forEach((btn) => {
            btn.addEventListener('click', function handleSegmentClick() {
                segments.forEach((b) => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                this.classList.add('active');
                this.setAttribute('aria-selected', 'true');
                const isDaily = this.getAttribute('data-forecast') === 'daily';
                const dailyPanel = DOM.byId('daily-forecast-panel');
                const hourlyPanel = DOM.byId('hourly-forecast-panel');
                if (dailyPanel) dailyPanel.classList.toggle('active-panel', isDaily);
                if (hourlyPanel) hourlyPanel.classList.toggle('active-panel', !isDaily);
            });
        });
    }

    /* ================================================================
     * 15. INSIGHTS: BEST-TIME TRACK ZONE HOVER
     * ================================================================ */
    function wireTrackZoneHover() {
        DOM.qsa('.track-zone').forEach((zone) => {
            zone.addEventListener('mouseenter', function handleZoneHover() {
                DOM.setText('best-time-range', this.getAttribute('data-time'));
                DOM.setText('best-time-desc', this.getAttribute('data-desc'));
                const dot = DOM.byId('interactive-glow-dot');
                if (dot) {
                    dot.setAttribute('cx', this.getAttribute('data-cx') || '80');
                    dot.setAttribute('cy', this.getAttribute('data-cy') || '40');
                }
            });
        });
    }

    /* ================================================================
     * 16. UNIT TOGGLE (Settings page)
     * ================================================================ */
    function initUnitToggle() {
        const rows = DOM.qsa('.unit-toggle-row');
        if (rows.length === 0) return;
        rows.forEach((row) => {
            row.addEventListener('click', function handleUnitToggle() {
                rows.forEach((r) => r.classList.remove('active'));
                this.classList.add('active');
                const unitsSelection = this.getAttribute('data-unit-toggle');
                document.body.setAttribute('data-units', unitsSelection);
                Storage.set(STORAGE_KEYS.UNITS, unitsSelection);
                if (AppState.data) renderAll(AppState.data);
            });
        });
    }

    /* ================================================================
     * 17. THEME TOGGLE (Settings page)
     * ================================================================ */
    function initThemeToggle() {
        const pills = DOM.qsa('.theme-pill-option');
        if (pills.length === 0) return;
        pills.forEach((pill) => {
            pill.addEventListener('click', function handleThemeToggle() {
                pills.forEach((p) => p.classList.remove('active'));
                this.classList.add('active');
                const theme = this.getAttribute('data-theme-set');
                document.body.setAttribute('data-theme', theme);
                Storage.set(STORAGE_KEYS.THEME, theme);
            });
        });
    }

    /* ================================================================
     * 18. SYNC / REFRESH BUTTON (Home page)
     * ================================================================ */
    function initSyncButton() {
        const syncBtn = DOM.byId('sync-trigger');
        if (!syncBtn) return;
        syncBtn.addEventListener('click', () => {
            if (AppState.loading) return;
            loadWeather({ city: AppState.city }).catch(() => {});
        });
    }

    /* ================================================================
     * 19. RIPPLE EFFECT (delegated to document, attached once)
     * ================================================================ */
    function initGlobalRipples() {
        const RIPPLE_SELECTOR = '.ripple-target, .icon-btn, .time-node, .setting-row-item, ' +
            '.theme-pill-option, .forecast-row-item, .hourly-detailed-card, .segment-btn, ' +
            '.location-option-row, .unit-toggle-row';

        document.addEventListener('click', (e) => {
            const target = e.target.closest(RIPPLE_SELECTOR);
            if (!target) return;
            const circle = document.createElement('span');
            const diameter = Math.max(target.clientWidth, target.clientHeight);
            const rect = target.getBoundingClientRect();
            circle.style.width = circle.style.height = `${diameter}px`;
            circle.style.left = `${e.clientX - rect.left - diameter / 2}px`;
            circle.style.top = `${e.clientY - rect.top - diameter / 2}px`;
            circle.classList.add('ripple-wave');
            const existing = target.querySelector('.ripple-wave');
            if (existing) existing.remove();
            target.style.position = target.style.position || 'relative';
            target.appendChild(circle);
        });
    }

    /* ================================================================
     * 20. BOOTSTRAP
     * ================================================================ */
    function restorePreferences() {
        const theme = Storage.get(STORAGE_KEYS.THEME, DEFAULTS.THEME);
        const units = Storage.get(STORAGE_KEYS.UNITS, DEFAULTS.UNITS);
        document.body.setAttribute('data-theme', theme);
        document.body.setAttribute('data-units', units);

        DOM.qsa('.theme-pill-option').forEach((p) => {
            p.classList.toggle('active', p.getAttribute('data-theme-set') === theme);
        });
        DOM.qsa('.unit-toggle-row').forEach((r) => {
            r.classList.toggle('active', r.getAttribute('data-unit-toggle') === units);
        });
    }

    function init() {
        if (window.lucide) lucide.createIcons();

        restorePreferences();
        initDrawer();
        initSearchModal();
        initForecastSegments();
        initUnitToggle();
        initThemeToggle();
        initSyncButton();
        initGlobalRipples();
        renderRecentSearches();

        // Paint instantly from cache (stale-while-revalidate), then refresh.
        if (AppState.data) {
            renderAll(AppState.data);
        }
        loadWeather({ city: AppState.city, silent: !!AppState.data }).catch(() => {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
