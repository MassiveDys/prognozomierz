// Warstwa danych: Open-Meteo (5 modeli) + IMGW-PIB, konsensus i przeliczenia.

export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', short: 'ECMWF', color: '#2563eb' },
  { id: 'icon_seamless', label: 'ICON (DWD)', short: 'ICON', color: '#dc2626' },
  { id: 'gfs_seamless', label: 'GFS (NOAA)', short: 'GFS', color: '#16a34a' },
  { id: 'meteofrance_seamless', label: 'Météo-France', short: 'MF', color: '#9333ea' },
  { id: 'ukmo_seamless', label: 'UK Met Office', short: 'UKMO', color: '#0891b2' },
];

export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'dew_point_2m',
  'relative_humidity_2m',
  'precipitation',
  'precipitation_probability',
  'pressure_msl',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'shortwave_radiation',
  'weather_code',
];

export const DAILY_VARS = ['sunrise', 'sunset', 'temperature_2m_max', 'temperature_2m_min'];

export const BANDS = [
  { id: 'temp', label: 'Temperatura', hint: 'powietrze, punkt rosy, odczuwalna, rozrzut 5 modeli' },
  { id: 'precip', label: 'Opad i wilgotność', hint: 'mm/h oraz wilgotność względna' },
  { id: 'prob', label: 'Szansa opadu', hint: 'prawdopodobieństwo 0–100%' },
  { id: 'pressure', label: 'Ciśnienie', hint: 'hPa / mm Hg ze strefami' },
  { id: 'wind', label: 'Wiatr i porywy', hint: 'prędkość, porywy, strefy siły' },
  { id: 'dir', label: 'Kierunek wiatru', hint: 'godzinowe strzałki N/W/E/S' },
  { id: 'clouds', label: 'Chmury i widzialność', hint: 'piętra chmur oraz widzialność' },
  { id: 'cover', label: 'Zachmurzenie, mgła, słońce', hint: 'oktanty, ryzyko mgły, promieniowanie' },
];

export const DEFAULT_FAVORITES = [
  {
    name: 'Dukla', lat: 49.55554, lon: 21.68317, elevation: 336,
    timezone: 'Europe/Warsaw', admin1: 'województwo podkarpackie', country: 'Polska', countryCode: 'PL',
  },
  {
    name: 'Gerlach', lat: 49.16383, lon: 20.1338, elevation: 2655,
    timezone: 'Europe/Bratislava', admin1: 'Prešovský kraj', country: 'Słowacja', countryCode: 'SK',
    subtitle: 'Gerlachovský štít, Tatry',
  },
  {
    name: 'Krosno', lat: 49.68866, lon: 21.77058, elevation: 278,
    timezone: 'Europe/Warsaw', admin1: 'województwo podkarpackie', country: 'Polska', countryCode: 'PL',
  },
];

const VOIVODESHIP_PREFIX = {
  'dolnośląskie': '02',
  'kujawsko-pomorskie': '04',
  'lubelskie': '06',
  'lubuskie': '08',
  'łódzkie': '10',
  'małopolskie': '12',
  'mazowieckie': '14',
  'opolskie': '16',
  'podkarpackie': '18',
  'podlaskie': '20',
  'pomorskie': '22',
  'śląskie': '24',
  'świętokrzyskie': '26',
  'warmińsko-mazurskie': '28',
  'wielkopolskie': '30',
  'zachodniopomorskie': '32',
};

export const WEEKDAYS = ['nd', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'];
export const WEEKDAYS_LONG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const pad2 = (n) => String(n).padStart(2, '0');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function parseLocalISO(value) {
  if (typeof value !== 'string') return null;
  const [datePart, timePart = '00:00'] = value.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  return { y, mo, d, h, mi, t: Date.UTC(y, mo - 1, d, h, mi), iso: value };
}

export function dayKeyOf(t) {
  return `${t.y}-${pad2(t.mo)}-${pad2(t.d)}`;
}

export function dayLabel(t, long = false) {
  const dow = new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay();
  return (long ? WEEKDAYS_LONG[dow] : WEEKDAYS[dow]) + `, ${t.d}.${pad2(t.mo)}`;
}

export function timeLabel(t) {
  return `${pad2(t.h)}:${pad2(t.mi)}`;
}

export function fmt(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  let n = Number(value);
  if (Math.abs(n) < 0.5 * 10 ** -digits) n = 0;
  return n.toLocaleString('pl-PL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function compass(deg) {
  if (deg === null || deg === undefined || !Number.isFinite(Number(deg))) return '—';
  return COMPASS[Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16];
}

export function isInPoland(lat, lon, countryCode) {
  if (countryCode) return String(countryCode).toUpperCase() === 'PL';
  return lat >= 48.9 && lat <= 54.95 && lon >= 14.05 && lon <= 24.3;
}

export function voivodeshipPrefix(admin1) {
  if (!admin1) return null;
  const key = admin1.toLowerCase().replace('województwo', '').trim();
  return VOIVODESHIP_PREFIX[key] || null;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function weatherInfo(code) {
  if (code === null || code === undefined || code === '') return { icon: '❔', label: 'Brak danych', kind: 'unknown' };
  const c = Number(code);
  if (!Number.isFinite(c)) return { icon: '❔', label: 'Brak danych', kind: 'unknown' };
  if (c === 0) return { icon: '☀️', label: 'Bezchmurnie', kind: 'clear' };
  if (c === 1) return { icon: '🌤️', label: 'Przeważnie bezchmurnie', kind: 'clear' };
  if (c === 2) return { icon: '⛅', label: 'Częściowe zachmurzenie', kind: 'cloud' };
  if (c === 3) return { icon: '☁️', label: 'Zachmurzenie całkowite', kind: 'cloud' };
  if (c === 45 || c === 48) return { icon: '🌫️', label: 'Mgła', kind: 'fog' };
  if (c >= 51 && c <= 55) return { icon: '🌦️', label: 'Mżawka', kind: 'rain' };
  if (c === 56 || c === 57) return { icon: '🌧️', label: 'Marznąca mżawka', kind: 'sleet' };
  if (c >= 61 && c <= 65) return { icon: '🌧️', label: 'Deszcz', kind: 'rain' };
  if (c === 66 || c === 67) return { icon: '🌧️', label: 'Marznący deszcz', kind: 'sleet' };
  if (c >= 71 && c <= 77) return { icon: '🌨️', label: 'Śnieg', kind: 'snow' };
  if (c >= 80 && c <= 82) return { icon: '🌦️', label: 'Przelotne opady', kind: 'rain' };
  if (c === 85 || c === 86) return { icon: '🌨️', label: 'Przelotny śnieg', kind: 'snow' };
  if (c === 95) return { icon: '⛈️', label: 'Burza', kind: 'storm' };
  if (c === 96 || c === 99) return { icon: '⛈️', label: 'Burza z gradem', kind: 'storm' };
  return { icon: '🌡️', label: 'Inne zjawisko', kind: 'unknown' };
}

export function warningLevelMeta(level) {
  const n = Number(level);
  if (n === 3) return { label: 'Stopień 3', cls: 'lvl3', color: '#dc2626' };
  if (n === 2) return { label: 'Stopień 2', cls: 'lvl2', color: '#f97316' };
  if (n === 1) return { label: 'Stopień 1', cls: 'lvl1', color: '#eab308' };
  return { label: 'Ostrzeżenie', cls: 'lvl0', color: '#64748b' };
}

// ---------- cache ----------

const CACHE_PREFIX = 'pogoda3.v1.';

export function cacheGet(key, maxAgeMs = Infinity) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > maxAgeMs) return null;
    return entry.value;
  } catch {
    return null;
  }
}

export function cacheSet(key, value) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), value }));
    return true;
  } catch {
    try { localStorage.removeItem(CACHE_PREFIX + 'fc'); } catch { /* ignore */ }
    return false;
  }
}

export function cacheRemove(key) {
  try { localStorage.removeItem(CACHE_PREFIX + key); } catch { /* ignore */ }
}

// ---------- HTTP ----------

async function fetchJSON(url, { signal, timeout = 18000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'Przerwano pobieranie.' : 'Przekroczono czas oczekiwania na dane.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function geocodePlace(query, { limit = 6, signal } = {}) {
  const params = new URLSearchParams({
    name: query, count: String(limit), language: 'pl', format: 'json',
  });
  const data = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal, timeout: 12000 });
  return (data.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    elevation: r.elevation ?? null,
    admin1: r.admin1 || '',
    admin2: r.admin2 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    timezone: r.timezone || '',
    population: r.population ?? null,
    featureCode: r.feature_code || '',
  }));
}

export async function fetchForecast(lat, lon, { signal } = {}) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY_VARS.join(','),
    daily: DAILY_VARS.join(','),
    models: MODELS.map((m) => m.id).join(','),
    timezone: 'auto',
    forecast_days: '8',
    wind_speed_unit: 'ms',
  });
  return fetchJSON(`https://api.open-meteo.com/v1/forecast?${params}`, { signal, timeout: 25000 });
}

export async function fetchWarnings({ signal } = {}) {
  const data = await fetchJSON('https://danepubliczne.imgw.pl/api/data/warningsmeteo', { signal, timeout: 15000 });
  return Array.isArray(data) ? data : [];
}

export async function fetchSynop({ signal } = {}) {
  const data = await fetchJSON('https://danepubliczne.imgw.pl/api/data/synop', { signal, timeout: 15000 });
  return Array.isArray(data) ? data : [];
}

// ---------- konsensus ----------

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function validValues(models, varName, i) {
  const out = [];
  for (const meta of MODELS) {
    const v = models[meta.id][varName]?.[i];
    if (v !== null && v !== undefined && Number.isFinite(Number(v))) out.push(Number(v));
  }
  return out;
}

function circularMean(values) {
  if (!values.length) return null;
  let sx = 0;
  let sy = 0;
  for (const deg of values) {
    const r = (deg * Math.PI) / 180;
    sx += Math.sin(r);
    sy += Math.cos(r);
  }
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return null;
  return (Math.atan2(sx, sy) * 180) / Math.PI;
}

function modeCode(values) {
  if (!values.length) return null;
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestCount = -1;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code > best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function precipType(temp, dew, precip, code) {
  if (precip === null || precip === undefined || precip <= 0.02) return 'none';
  const c = Number(code);
  if ((temp !== null && temp <= 0) || [71, 73, 75, 77, 85, 86].includes(c)) return 'snow';
  if ((temp !== null && temp <= 1.5 && dew !== null && dew <= 0) || [66, 67].includes(c)) return 'sleet';
  return 'rain';
}

function fogRisk(temp, dew, humidity, visibilityM) {
  const vis = visibilityM === null || visibilityM === undefined ? null : visibilityM / 1000;
  const dT = temp !== null && dew !== null ? temp - dew : null;
  if ((dT !== null && dT <= 1.5 && humidity !== null && humidity >= 95) || (vis !== null && vis < 1)) return 2;
  if ((dT !== null && dT <= 2.5 && humidity !== null && humidity >= 88) || (vis !== null && vis < 3)) return 1;
  return 0;
}

function buildModelDerived(model, n) {
  model.fog_risk = new Array(n).fill(0);
  model.precip_type = new Array(n).fill('none');
  model.octants = new Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    const t = model.temperature_2m[i];
    const td = model.dew_point_2m[i];
    const rh = model.relative_humidity_2m[i];
    const vis = model.visibility[i];
    const precip = model.precipitation[i];
    const code = model.weather_code[i];
    model.fog_risk[i] = fogRisk(t, td, rh, vis);
    model.precip_type[i] = precipType(t, td, precip, code);
    const cc = model.cloud_cover[i];
    model.octants[i] = cc === null ? null : clamp(Math.round((cc / 100) * 8), 0, 8);
  }
}

export function buildDataset(raw) {
  const n = raw.hourly.time.length;
  const times = raw.hourly.time.map(parseLocalISO);
  const models = {};

  for (const meta of MODELS) {
    const model = {};
    for (const varName of HOURLY_VARS) {
      const arr = raw.hourly[`${varName}_${meta.id}`];
      model[varName] = Array.isArray(arr)
        ? arr.slice(0, n).map((v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v)))
        : new Array(n).fill(null);
      while (model[varName].length < n) model[varName].push(null);
    }
    buildModelDerived(model, n);
    models[meta.id] = model;
  }

  const consensus = {};
  const scalarVars = [
    'temperature_2m', 'apparent_temperature', 'dew_point_2m', 'relative_humidity_2m',
    'precipitation', 'precipitation_probability', 'pressure_msl', 'wind_speed_10m',
    'wind_gusts_10m', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'visibility', 'shortwave_radiation',
  ];

  for (const varName of scalarVars) {
    const med = new Array(n).fill(null);
    const min = new Array(n).fill(null);
    const max = new Array(n).fill(null);
    const spread = new Array(n).fill(null);
    for (let i = 0; i < n; i += 1) {
      const vals = validValues(models, varName, i);
      if (!vals.length) continue;
      med[i] = median(vals);
      min[i] = Math.min(...vals);
      max[i] = Math.max(...vals);
      spread[i] = max[i] - min[i];
    }
    consensus[varName] = { median: med, min, max, spread };
  }

  const dirMean = new Array(n).fill(null);
  const weatherMode = new Array(n).fill(null);
  const fog = new Array(n).fill(0);
  const ptype = new Array(n).fill('none');
  const octants = new Array(n).fill(null);

  for (let i = 0; i < n; i += 1) {
    const dirs = validValues(models, 'wind_direction_10m', i);
    dirMean[i] = circularMean(dirs);
    weatherMode[i] = modeCode(validValues(models, 'weather_code', i));
    const t = consensus.temperature_2m.median[i];
    const td = consensus.dew_point_2m.median[i];
    const rh = consensus.relative_humidity_2m.median[i];
    const vis = consensus.visibility.median[i];
    fog[i] = fogRisk(t, td, rh, vis);
    ptype[i] = precipType(t, td, consensus.precipitation.median[i], weatherMode[i]);
    const cc = consensus.cloud_cover.median[i];
    octants[i] = cc === null ? null : clamp(Math.round((cc / 100) * 8), 0, 8);
  }

  consensus.wind_direction_10m = { median: dirMean, min: new Array(n).fill(null), max: new Array(n).fill(null), spread: new Array(n).fill(null) };
  consensus.weather_code = { median: weatherMode, min: new Array(n).fill(null), max: new Array(n).fill(null), spread: new Array(n).fill(null) };
  consensus.fog_risk = fog;
  consensus.precip_type = ptype;
  consensus.octants = octants;

  const days = [];
  const dayIndex = new Map();
  times.forEach((t, i) => {
    const key = dayKeyOf(t);
    if (!dayIndex.has(key)) {
      const entry = { key, start: i, end: i, t };
      dayIndex.set(key, entry);
      days.push(entry);
    }
    dayIndex.get(key).end = i;
  });

  const dayMeta = new Map();
  const daily = (raw.daily?.time || []).map((date, idx) => {
    const key = date;
    const range = dayIndex.get(key);
    let sr = null;
    let ss = null;
    for (const meta of MODELS) {
      if (!sr && raw.daily?.[`sunrise_${meta.id}`]?.[idx]) sr = raw.daily[`sunrise_${meta.id}`][idx];
      if (!ss && raw.daily?.[`sunset_${meta.id}`]?.[idx]) ss = raw.daily[`sunset_${meta.id}`][idx];
    }
    let tmax = null;
    let tmin = null;
    let precipProb = null;
    let precipSum = 0;
    let code = null;
    if (range) {
      const temps = [];
      for (let i = range.start; i <= range.end; i += 1) {
        const v = consensus.temperature_2m.median[i];
        if (v !== null) temps.push(v);
        const pp = consensus.precipitation_probability.median[i];
        if (pp !== null) precipProb = precipProb === null ? pp : Math.max(precipProb, pp);
        const pr = consensus.precipitation.median[i];
        if (pr !== null) precipSum += pr;
        const t = times[i];
        if (t.h === 12) code = consensus.weather_code.median[i] ?? code;
      }
      if (temps.length) {
        tmax = Math.max(...temps);
        tmin = Math.min(...temps);
      }
      if (code === null && range.start <= range.end) {
        const mid = Math.floor((range.start + range.end) / 2);
        code = consensus.weather_code.median[mid] ?? null;
      }
    }
    const entry = {
      key,
      index: idx,
      t: parseLocalISO(`${key}T12:00`),
      label: range ? dayLabel(range.t, false) : date,
      sunrise: sr,
      sunset: ss,
      sunriseMin: sr ? (parseLocalISO(sr).h * 60 + parseLocalISO(sr).mi) : null,
      sunsetMin: ss ? (parseLocalISO(ss).h * 60 + parseLocalISO(ss).mi) : null,
      tmax,
      tmin,
      precipProb,
      precipSum,
      weatherCode: code,
      start: range?.start ?? 0,
      end: range?.end ?? 0,
    };
    dayMeta.set(key, entry);
    return entry;
  });

  return {
    raw,
    n,
    times,
    models,
    consensus,
    daily,
    dayMeta,
    timezone: raw.timezone || '',
    timezoneAbbreviation: raw.timezone_abbreviation || '',
    utcOffset: Number(raw.utc_offset_seconds) || 0,
    elevation: raw.elevation ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
  };
}

export function findNowIndex(dataset) {
  if (!dataset) return 0;
  const now = new Date(Date.now() + dataset.utcOffset * 1000);
  const nowT = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  let best = 0;
  let bestDiff = Infinity;
  dataset.times.forEach((t, i) => {
    const diff = Math.abs(t.t - nowT);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

export function findIndexForTime(dataset, y, mo, d, h) {
  if (!dataset) return null;
  const target = Date.UTC(y, mo - 1, d, h);
  let best = null;
  let bestDiff = Infinity;
  dataset.times.forEach((t, i) => {
    const diff = Math.abs(t.t - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return bestDiff <= 2 * 3600 * 1000 ? best : null;
}

export function nearestStation(lat, lon, stationsCoords) {
  let best = null;
  for (const [name, coords] of Object.entries(stationsCoords)) {
    const distance = haversine(lat, lon, coords.lat, coords.lon);
    if (!best || distance < best.distance) best = { name, ...coords, distance };
  }
  return best;
}

export function filterWarnings(warnings, location) {
  if (!isInPoland(location.lat, location.lon, location.countryCode)) return { outside: true, items: [], prefix: null };
  const prefix = voivodeshipPrefix(location.admin1);
  let items = warnings;
  if (prefix) {
    items = warnings.filter((w) => Array.isArray(w.teryt) && w.teryt.some((code) => String(code).startsWith(prefix)));
  }
  items = [...items].sort((a, b) => (Number(b.stopien) || 0) - (Number(a.stopien) || 0));
  return { outside: false, items, prefix };
}
