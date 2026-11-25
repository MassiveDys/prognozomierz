// Pogoda v3 — logika interfejsu, wyszukiwarka, ustawienia i synchronizacja widoków.

import {
  MODELS, MODEL_BY_ID, BANDS, DEFAULT_FAVORITES,
  buildDataset, findNowIndex, geocodePlace, fetchForecast, fetchWarnings, fetchSynop,
  cacheGet, cacheSet, fmt, pad2, clamp, weatherInfo, warningLevelMeta,
  isInPoland, filterWarnings, nearestStation, dayLabel,
  timeLabel, parseLocalISO, compass,
} from './data.js';
import { SYNOP_STATIONS } from './stations.js';
import { Meteogram } from './chart.js';

const SETTINGS_KEY = 'pogoda3.settings.v1';
const FAVORITES_KEY = 'pogoda3.favorites.v1';
const LAST_KEY = 'pogoda3.last.v1';

const DEFAULT_SETTINGS = {
  theme: 'light',
  wind: 'ms',
  pressure: 'hpa',
  bands: Object.fromEntries(BANDS.map((b) => [b.id, true])),
  refresh: 30,
  collapsed: { controls: false, current: false, days: false, meteo: false },
  uiScale: 1,
};

// Skala interfejsu (kafelki + napisy) ustawiana przyciskami -/+ w nagłówku.
const UI_SCALE_MIN = 0.8;
const UI_SCALE_MAX = 1.4;
const UI_SCALE_STEP = 0.05;

function clampUiScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n * 100) / 100));
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function normalizeSettings(raw) {
  const base = { ...DEFAULT_SETTINGS, bands: { ...DEFAULT_SETTINGS.bands } };
  if (!raw || typeof raw !== 'object') return base;
  return {
    theme: raw.theme === 'dark' ? 'dark' : 'light',
    wind: raw.wind === 'kmh' ? 'kmh' : 'ms',
    pressure: raw.pressure === 'mmhg' ? 'mmhg' : 'hpa',
    bands: { ...base.bands, ...(raw.bands && typeof raw.bands === 'object' ? raw.bands : {}) },
    refresh: [0, 15, 30, 60].includes(Number(raw.refresh)) ? Number(raw.refresh) : 30,
    collapsed: {
      controls: raw.collapsed?.controls === true,
      current: raw.collapsed?.current === true,
      days: raw.collapsed?.days === true,
      meteo: raw.collapsed?.meteo === true,
    },
    uiScale: clampUiScale(raw.uiScale),
  };
}

let settings = normalizeSettings(loadJSON(SETTINGS_KEY, null));
let favorites = loadJSON(FAVORITES_KEY, null);
if (!Array.isArray(favorites)) favorites = DEFAULT_FAVORITES.map((f) => ({ ...f }));
favorites = favorites.filter((f) => f && Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lon)));

const state = {
  location: null,
  data: null,
  dataKey: '',
  status: 'idle',
  error: '',
  stale: false,
  source: 'consensus',
  windowHours: 60,
  windowStart: 0,
  nowIndex: 0,
  selectedDay: null,
  inspect: null,
  fcAbort: null,
  auxAbort: null,
  autoTimer: null,
  toastTimer: null,
  warnings: { status: 'idle', items: [], error: '' },
  synop: { status: 'idle', items: [], error: '' },
  search: { timer: null, abort: null, items: [], active: -1 },
};

let chart = null;

const $ = (id) => document.getElementById(id);

const el = {
  searchInput: $('search-input'),
  searchClear: $('search-clear'),
  suggestions: $('suggestions'),
  geoBtn: $('geo-btn'),
  settingsBtn: $('settings-btn'),
  uiScaleDown: $('ui-scale-down'),
  uiScaleUp: $('ui-scale-up'),
  uiScaleValue: $('ui-scale-value'),
  favorites: $('favorites'),
  sourceSeg: $('source-seg'),
  modelSelect: $('model-select'),
  agreePill: $('agree-pill'),
  windowSeg: $('window-seg'),
  winPrev: $('win-prev'),
  winNext: $('win-next'),
  winSlider: $('win-slider'),
  winRange: $('win-range'),
  currentPanel: $('current-panel'),
  warningsPanel: $('warnings-panel'),
  daysPanel: $('days-panel'),
  meteoHead: $('meteo-head'),
  canvasWrap: $('canvas-wrap'),
  canvas: $('meteogram'),
  loading: $('chart-loading'),
  loadingText: $('chart-loading-text'),
  chartError: $('chart-error'),
  chartErrorText: $('chart-error-text'),
  retryBtn: $('retry-btn'),
  readout: $('readout'),
  legend: $('legend'),
  settingsDialog: $('settings-dialog'),
  settingsForm: $('settings-form'),
  bandToggles: $('band-toggles'),
  setRefresh: $('set-refresh'),
  setWind: $('set-wind'),
  setPressure: $('set-pressure'),
  toast: $('toast'),
  meteoCard: $('meteogram-card'),
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function showToast(message, kind = 'info') {
  if (!el.toast) return;
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.dataset.kind = kind;
  el.toast.hidden = false;
  state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4800);
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', settings.theme === 'dark' ? '#22262b' : '#f4f6f9');
}

/**
 * Skala interfejsu: powiększa/pomniejsza całą stronę (kafelki razem z napisami).
 * Wartość trzymana w localStorage, więc wraca po restarcie.
 */
function applyUiScale() {
  const scale = clampUiScale(settings.uiScale);
  document.documentElement.style.zoom = scale === 1 ? '' : String(scale);
  if (el.uiScaleValue) el.uiScaleValue.textContent = `${Math.round(scale * 100)}%`;
  if (el.uiScaleDown) el.uiScaleDown.disabled = scale <= UI_SCALE_MIN + 1e-6;
  if (el.uiScaleUp) el.uiScaleUp.disabled = scale >= UI_SCALE_MAX - 1e-6;
  chart?.schedule();
}

function setUiScale(delta) {
  const next = clampUiScale(settings.uiScale + delta);
  if (next === settings.uiScale) return;
  settings.uiScale = next;
  saveJSON(SETTINGS_KEY, settings);
  applyUiScale();
}

function resetUiScale() {
  if (clampUiScale(settings.uiScale) === 1) return;
  settings.uiScale = 1;
  saveJSON(SETTINGS_KEY, settings);
  applyUiScale();
}

const CARD_TITLES = { controls: 'Źródło', current: 'Bieżące warunki', days: 'Prognoza 7-dniowa', meteo: 'Meteogram' };

function applyCollapsedCards() {
  document.querySelectorAll('[data-card]').forEach((card) => {
    const id = card.dataset.card;
    const collapsed = settings.collapsed?.[id] === true;
    card.classList.toggle('is-collapsed', collapsed);
    const btn = card.querySelector('[data-card-toggle]');
    if (!btn) return;
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.setAttribute('aria-label', `${collapsed ? 'Rozwiń' : 'Zwiń'} ${CARD_TITLES[id] || 'kartę'}`);
    btn.title = collapsed ? 'Rozwiń kartę' : 'Zwiń kartę';
  });
}

function setupCollapsibleCards() {
  document.querySelectorAll('[data-card]').forEach((card) => {
    const btn = card.querySelector('[data-card-toggle]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const id = card.dataset.card;
      const collapsed = !(settings.collapsed?.[id] === true);
      settings.collapsed = { ...(settings.collapsed || {}), [id]: collapsed };
      saveJSON(SETTINGS_KEY, settings);
      applyCollapsedCards();
      if (id === 'meteo' && !collapsed) chart?.schedule();
    });
  });
  applyCollapsedCards();
}

function modeLabel() {
  if (state.source === 'compare') return 'Porównanie 5 modeli';
  if (state.source === 'consensus') return 'Konsensus 5 modeli';
  return MODEL_BY_ID[state.source]?.label || 'Model';
}

function series(varName) {
  if (!state.data) return [];
  if (state.source === 'consensus' || state.source === 'compare') {
    return state.data.consensus[varName]?.median || [];
  }
  return state.data.models[state.source]?.[varName] || [];
}

function seriesType() {
  if (!state.data) return [];
  if (state.source === 'consensus' || state.source === 'compare') return state.data.consensus.precip_type;
  return state.data.models[state.source]?.precip_type || [];
}

function seriesFog() {
  if (!state.data) return [];
  if (state.source === 'consensus' || state.source === 'compare') return state.data.consensus.fog_risk;
  return state.data.models[state.source]?.fog_risk || [];
}

function windDisp(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  return settings.wind === 'kmh' ? ms * 3.6 : ms;
}

function windUnit() {
  return settings.wind === 'kmh' ? 'km/h' : 'm/s';
}

function pressureDisp(hpa) {
  if (hpa === null || hpa === undefined || !Number.isFinite(hpa)) return null;
  return settings.pressure === 'mmhg' ? hpa * 0.750062 : hpa;
}

function pressureUnit() {
  return settings.pressure === 'mmhg' ? 'mm Hg' : 'hPa';
}

function windText(ms, digits = 1) {
  const v = windDisp(ms);
  return v === null ? '—' : `${fmt(v, settings.wind === 'kmh' ? 0 : digits)} ${windUnit()}`;
}

function pressureText(hpa) {
  const v = pressureDisp(hpa);
  return v === null ? '—' : `${fmt(v, settings.pressure === 'mmhg' ? 0 : 0)} ${pressureUnit()}`;
}

function signed(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${fmt(value, digits)}`;
}

function localNow() {
  if (!state.data) {
    const d = new Date();
    return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
  }
  const d = new Date(Date.now() + state.data.utcOffset * 1000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(),
  };
}

function currentDayEntry() {
  if (!state.data) return null;
  const now = localNow();
  const key = `${now.y}-${pad2(now.mo)}-${pad2(now.d)}`;
  return state.data.dayMeta.get(key) || state.data.daily[0] || null;
}

function fmtDayFromISO(iso) {
  const t = parseLocalISO(iso);
  return t ? timeLabel(t) : '—';
}

function fmtDateTime(t) {
  return t ? `${dayLabel(t, false)} ${timeLabel(t)}` : '—';
}

// ---------- start ----------

function init() {
  applyTheme();
  applyUiScale();
  setupCollapsibleCards();
  buildModelSelect();
  buildBandToggles();
  syncSettingsForm();
  renderFavorites();
  bindEvents();
  chart = new Meteogram(el.canvas, { onInspect: handleInspect, onZoom: handleZoom, onPan: handlePan });
  const last = loadJSON(LAST_KEY, null);
  const startLoc = last && Number.isFinite(Number(last.lat)) ? last : favorites[0] || DEFAULT_FAVORITES[0];
  if (startLoc?.name) el.searchInput.value = startLoc.name;
  loadLocation(startLoc, { resetWindow: true });
  loadAux();
  setupAutoRefresh();
}

function buildModelSelect() {
  el.modelSelect.innerHTML = [
    '<option value="consensus">Konsensus 5 modeli</option>',
    '<option value="compare">Porównanie 5 modeli</option>',
    ...MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`),
  ].join('');
}

function buildBandToggles() {
  el.bandToggles.innerHTML = BANDS.map((b) => `
    <label class="band-check">
      <input type="checkbox" data-band="${b.id}" ${settings.bands[b.id] ? 'checked' : ''}>
      <span><b>${esc(b.label)}</b><small>${esc(b.hint)}</small></span>
    </label>
  `).join('');
}

function syncSettingsForm() {
  const themeInput = el.settingsForm.querySelector(`input[name="theme"][value="${settings.theme}"]`);
  if (themeInput) themeInput.checked = true;
  el.setWind.value = settings.wind;
  el.setPressure.value = settings.pressure;
  el.setRefresh.value = String(settings.refresh);
  el.settingsForm.querySelectorAll('[data-band]').forEach((input) => {
    input.checked = settings.bands[input.dataset.band] !== false;
  });
}

// ---------- events ----------

function bindEvents() {
  el.sourceSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-source]');
    if (!btn) return;
    setSource(btn.dataset.source);
  });
  el.modelSelect.addEventListener('change', () => setSource(el.modelSelect.value));
  el.windowSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-hours]');
    if (!btn) return;
    setWindowHours(Number(btn.dataset.hours));
  });
  el.winPrev.addEventListener('click', () => panWindow(-6));
  el.winNext.addEventListener('click', () => panWindow(6));
  el.winSlider.addEventListener('input', () => {
    if (!state.data) return;
    state.windowStart = Number(el.winSlider.value);
    state.selectedDay = null;
    state.inspect = null;
    chart?.clearSelection({ notify: false });
    el.daysPanel.querySelectorAll('.day-card.is-active').forEach((card) => {
      card.classList.remove('is-active');
      card.setAttribute('aria-pressed', 'false');
    });
    updateChart();
    updateWindowUI();
    renderAgreement();
    hideReadout();
  });

  el.favorites.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-fav]');
    if (remove) {
      const idx = Number(remove.dataset.removeFav);
      const [removed] = favorites.splice(idx, 1);
      saveJSON(FAVORITES_KEY, favorites);
      renderFavorites();
      renderCurrent();
      showToast(removed ? `Usunięto ${removed.name} z ulubionych.` : 'Usunięto z ulubionych.', 'info');
      return;
    }
    const pick = e.target.closest('[data-pick-fav]');
    if (pick) {
      const idx = Number(pick.dataset.pickFav);
      if (favorites[idx]) {
        loadLocation(favorites[idx], { resetWindow: true });
        el.searchInput.value = favorites[idx].name;
      }
    }
  });

  el.daysPanel.addEventListener('click', (e) => {
    const card = e.target.closest('[data-day]');
    if (!card || !state.data) return;
    selectDay(card.dataset.day);
  });

  el.currentPanel.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-action="toggle-fav"]');
    if (fav) { toggleFavorite(); return; }
    if (e.target.closest('[data-action="retry-current"]')) {
      if (state.location) loadLocation(state.location, { resetWindow: false });
      return;
    }
    if (e.target.closest('[data-action="retry-aux"]')) loadAux({ force: true });
  });

  el.warningsPanel.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry-warn"]')) loadAux({ force: true });
  });

  el.meteoHead.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="center-now"]')) centerOnNow();
  });

  el.readout.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-readout]')) {
      chart?.clearSelection();
    }
  });

  el.retryBtn.addEventListener('click', () => {
    if (state.location) loadLocation(state.location, { resetWindow: false });
  });

  el.settingsBtn.addEventListener('click', () => {
    syncSettingsForm();
    if (typeof el.settingsDialog.showModal === 'function') el.settingsDialog.showModal();
    else el.settingsDialog.setAttribute('open', '');
  });

  el.uiScaleDown?.addEventListener('click', () => setUiScale(-UI_SCALE_STEP));
  el.uiScaleUp?.addEventListener('click', () => setUiScale(UI_SCALE_STEP));
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setUiScale(UI_SCALE_STEP);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setUiScale(-UI_SCALE_STEP);
    } else if (e.key === '0') {
      e.preventDefault();
      resetUiScale();
    }
  });
  el.settingsDialog.addEventListener('click', (e) => {
    if (e.target === el.settingsDialog) el.settingsDialog.close();
  });
  el.settingsDialog.addEventListener('close', () => {
    el.settingsBtn.focus({ preventScroll: true });
  });

  el.settingsForm.addEventListener('change', (e) => {
    const target = e.target;
    if (target.name === 'theme') {
      settings.theme = target.value === 'dark' ? 'dark' : 'light';
      applyTheme();
      updateChart();
    } else if (target.id === 'set-wind') {
      settings.wind = target.value === 'kmh' ? 'kmh' : 'ms';
      renderAll();
    } else if (target.id === 'set-pressure') {
      settings.pressure = target.value === 'mmhg' ? 'mmhg' : 'hpa';
      renderAll();
    } else if (target.id === 'set-refresh') {
      settings.refresh = Number(target.value) || 0;
      setupAutoRefresh();
    } else if (target.dataset.band) {
      const id = target.dataset.band;
      const othersEnabled = BANDS.some((b) => b.id !== id && settings.bands[b.id] !== false);
      if (!othersEnabled && !target.checked) {
        target.checked = true;
        showToast('Zostaw co najmniej jedno widoczne pasmo.', 'warn');
        return;
      }
      settings.bands[id] = target.checked;
      renderAll();
    }
    saveJSON(SETTINGS_KEY, settings);
  });

  $('settings-reset').addEventListener('click', () => {
    settings = normalizeSettings(null);
    saveJSON(SETTINGS_KEY, settings);
    syncSettingsForm();
    applyTheme();
    applyCollapsedCards();
    setupAutoRefresh();
    renderAll();
    showToast('Przywrócono domyślne ustawienia.', 'ok');
  });

  el.geoBtn.addEventListener('click', useGeolocation);
  bindSearch();
  bindKeyboard();
  window.addEventListener('resize', () => chart?.schedule());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') chart?.schedule();
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (el.settingsDialog.open) return;
    if (!el.suggestions.hidden) { closeSuggestions(); return; }
    if (!el.readout.hidden) chart?.clearSelection();
  });
}

// ---------- search ----------

function bindSearch() {
  el.searchInput.addEventListener('input', () => {
    const q = el.searchInput.value.trim();
    el.searchClear.hidden = !q;
    clearTimeout(state.search.timer);
    if (q.length < 2) { closeSuggestions(); return; }
    state.search.timer = setTimeout(() => runSearch(q), 260);
  });
  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (el.suggestions.hidden || !state.search.items.length) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      state.search.active = (state.search.active + dir + state.search.items.length) % state.search.items.length;
      paintActiveSuggestion();
      return;
    }
    if (e.key === 'Enter') {
      if (!el.suggestions.hidden && state.search.items.length) {
        e.preventDefault();
        const idx = state.search.active >= 0 ? state.search.active : 0;
        chooseSearchResult(state.search.items[idx]);
      } else if (el.searchInput.value.trim().length >= 2) {
        e.preventDefault();
        runSearch(el.searchInput.value.trim(), true);
      }
      return;
    }
    if (e.key === 'Escape') closeSuggestions();
  });
  el.searchInput.addEventListener('focus', () => {
    if (state.search.items.length && el.searchInput.value.trim().length >= 2) {
      el.suggestions.hidden = false;
      el.searchInput.setAttribute('aria-expanded', 'true');
    }
  });
  el.searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!el.suggestions.contains(document.activeElement)) closeSuggestions();
    }, 160);
  });
  el.suggestions.addEventListener('mousedown', (e) => e.preventDefault());
  el.suggestions.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav-result]');
    if (favBtn) {
      const result = state.search.items[Number(favBtn.dataset.favResult)];
      if (!result) return;
      const added = toggleFavoriteFor(result);
      const label = `${added ? 'Usuń' : 'Dodaj'} ${result.name} ${added ? 'z' : 'do'} ulubionych`;
      favBtn.textContent = added ? '★' : '☆';
      favBtn.classList.toggle('is-on', added);
      favBtn.setAttribute('aria-pressed', added ? 'true' : 'false');
      favBtn.setAttribute('aria-label', label);
      favBtn.title = label;
      return;
    }
    const item = e.target.closest('[data-result]');
    if (!item) return;
    const idx = Number(item.dataset.result);
    if (state.search.items[idx]) chooseSearchResult(state.search.items[idx]);
  });
  el.searchClear.addEventListener('click', () => {
    el.searchInput.value = '';
    el.searchClear.hidden = true;
    closeSuggestions();
    el.searchInput.focus();
  });
}

async function runSearch(query, selectFirst = false) {
  state.search.abort?.abort();
  const controller = new AbortController();
  state.search.abort = controller;
  el.suggestions.hidden = false;
  el.searchInput.setAttribute('aria-expanded', 'true');
  el.suggestions.innerHTML = '<li class="suggestion-state">Szukam „' + esc(query) + '”…</li>';
  try {
    const items = await geocodePlace(query, { limit: 6, signal: controller.signal });
    if (controller.signal.aborted) return;
    state.search.items = items;
    state.search.active = -1;
    if (selectFirst && items.length) {
      chooseSearchResult(items[0]);
      return;
    }
    renderSuggestions();
  } catch (err) {
    if (controller.signal.aborted) return;
    el.suggestions.innerHTML = `<li class="suggestion-state error">Nie udało się wyszukać miejscowości. ${esc(err.message || '')}</li>`;
  }
}

function renderSuggestions() {
  if (!state.search.items.length) {
    el.suggestions.innerHTML = '<li class="suggestion-state">Brak wyników. Spróbuj innej nazwy.</li>';
    el.suggestions.hidden = false;
    el.searchInput.setAttribute('aria-expanded', 'true');
    return;
  }
  el.suggestions.innerHTML = state.search.items.map((r, i) => {
    const fav = isFavorite(r);
    const favLabel = `${fav ? 'Usuń' : 'Dodaj'} ${r.name} ${fav ? 'z' : 'do'} ulubionych`;
    return `
    <li role="option" id="search-opt-${i}" aria-selected="false" class="suggestion-row">
      <button type="button" class="suggestion" data-result="${i}">
        <span class="sug-main"><b>${esc(r.name)}</b><span>${esc([r.admin1, r.country].filter(Boolean).join(' · '))}</span></span>
        <span class="sug-side">${r.elevation !== null ? `${fmt(r.elevation, 0)} m` : ''}</span>
      </button>
      <button type="button" class="sug-fav${fav ? ' is-on' : ''}" data-fav-result="${i}"
        aria-pressed="${fav ? 'true' : 'false'}" aria-label="${esc(favLabel)}" title="${esc(favLabel)}">${fav ? '★' : '☆'}</button>
    </li>
  `;
  }).join('');
  el.suggestions.hidden = false;
  el.searchInput.setAttribute('aria-expanded', 'true');
}

function paintActiveSuggestion() {
  const nodes = el.suggestions.querySelectorAll('[role="option"]');
  nodes.forEach((node, i) => {
    const active = i === state.search.active;
    node.setAttribute('aria-selected', active ? 'true' : 'false');
    node.querySelector('.suggestion')?.classList.toggle('is-active', active);
    if (active) {
      node.scrollIntoView({ block: 'nearest' });
      el.searchInput.setAttribute('aria-activedescendant', node.id);
    }
  });
}

function closeSuggestions() {
  el.suggestions.hidden = true;
  el.searchInput.setAttribute('aria-expanded', 'false');
  el.searchInput.removeAttribute('aria-activedescendant');
  state.search.items = [];
  state.search.active = -1;
}

function chooseSearchResult(result) {
  if (!result) return;
  closeSuggestions();
  el.searchInput.value = result.name;
  el.searchClear.hidden = false;
  el.searchInput.blur();
  const loc = {
    name: result.name,
    lat: result.lat,
    lon: result.lon,
    elevation: result.elevation,
    timezone: result.timezone,
    admin1: result.admin1,
    country: result.country,
    countryCode: result.countryCode,
  };
  loadLocation(loc, { resetWindow: true });
  if (result.admin1 || result.country) {
    showToast(`Wybrano ${result.name}${result.admin1 ? ` (${result.admin1})` : ''}.`, 'ok');
  }
}

function useGeolocation() {
  if (!navigator.geolocation) {
    showToast('Ta przeglądarka nie udostępnia geolokalizacji.', 'warn');
    return;
  }
  el.geoBtn.disabled = true;
  el.geoBtn.classList.add('is-busy');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.geoBtn.disabled = false;
      el.geoBtn.classList.remove('is-busy');
      const loc = {
        name: 'Moja lokalizacja',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        elevation: null,
        timezone: '',
        admin1: '',
        country: '',
        countryCode: '',
      };
      el.searchInput.value = loc.name;
      el.searchClear.hidden = false;
      loadLocation(loc, { resetWindow: true });
    },
    (err) => {
      el.geoBtn.disabled = false;
      el.geoBtn.classList.remove('is-busy');
      const msg = err.code === 1
        ? 'Brak zgody na lokalizację. Zezwól na dostęp w przeglądarce albo wpisz miasto.'
        : err.code === 3
          ? 'Nie udało się ustalić lokalizacji w wyznaczonym czasie.'
          : 'Nie udało się ustalić lokalizacji.';
      showToast(msg, 'warn');
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
  );
}

// ---------- favourites ----------

function isFavorite(loc) {
  if (!loc) return false;
  return favorites.some((f) => Math.abs(Number(f.lat) - Number(loc.lat)) < 0.01
    && Math.abs(Number(f.lon) - Number(loc.lon)) < 0.01);
}

function samePlace(a, b) {
  if (!a || !b) return false;
  return Math.abs(Number(a.lat) - Number(b.lat)) < 0.01
    && Math.abs(Number(a.lon) - Number(b.lon)) < 0.01;
}

/** Dodaje lub usuwa miejsce z ulubionych. Zwraca true, gdy dodano. */
function toggleFavoriteFor(loc) {
  if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return false;
  const name = loc.name || 'Wybrana lokalizacja';
  const idx = favorites.findIndex((f) => samePlace(f, loc));
  let added;
  if (idx >= 0) {
    favorites.splice(idx, 1);
    added = false;
    showToast(`${name} usunięta z ulubionych.`, 'info');
  } else {
    favorites.push({
      name,
      lat: Number(loc.lat),
      lon: Number(loc.lon),
      elevation: loc.elevation ?? null,
      timezone: loc.timezone || '',
      admin1: loc.admin1 || '',
      country: loc.country || '',
      countryCode: loc.countryCode || '',
    });
    added = true;
    showToast(`Dodano ${name} do ulubionych.`, 'ok');
  }
  saveJSON(FAVORITES_KEY, favorites);
  renderFavorites();
  if (samePlace(loc, state.location)) renderCurrent();
  return added;
}

function toggleFavorite() {
  if (!state.location) return;
  toggleFavoriteFor(state.location);
}

function renderFavorites() {
  if (!favorites.length) {
    el.favorites.innerHTML = '<span class="fav-empty">Brak ulubionych — dodaj gwiazdką w karcie warunków.</span>';
    return;
  }
  el.favorites.innerHTML = favorites.map((f, i) => {
    const active = state.location
      && Math.abs(Number(f.lat) - Number(state.location.lat)) < 0.01
      && Math.abs(Number(f.lon) - Number(state.location.lon)) < 0.01;
    return `
      <span class="fav-chip ${active ? 'is-active' : ''}">
        <button type="button" class="fav-main" data-pick-fav="${i}" title="${esc(f.admin1 || f.country || '')}">${esc(f.name)}</button>
        <button type="button" class="fav-remove" data-remove-fav="${i}" aria-label="Usuń ${esc(f.name)} z ulubionych">×</button>
      </span>
    `;
  }).join('');
}

// ---------- data ----------

async function loadLocation(loc, { resetWindow = false, silent = false } = {}) {
  if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon))) return;
  const location = {
    name: loc.name || 'Wybrana lokalizacja',
    lat: Number(loc.lat),
    lon: Number(loc.lon),
    elevation: loc.elevation ?? null,
    timezone: loc.timezone || '',
    admin1: loc.admin1 || '',
    country: loc.country || '',
    countryCode: loc.countryCode || '',
  };
  const key = `${location.lat.toFixed(3)},${location.lon.toFixed(3)}`;
  const same = state.dataKey === key;
  state.location = location;
  saveJSON(LAST_KEY, location);
  document.title = `Prognozomierz - ${location.name}`;
  state.search.abort?.abort();
  if (resetWindow) {
    state.windowStart = 0;
    state.selectedDay = null;
    state.inspect = null;
    chart?.clearSelection({ notify: false });
  }
  if (!same) {
    state.data = null;
    state.dataKey = '';
    chart?.setData(null);
    hideReadout();
  }
  if (!silent) {
    state.status = 'loading';
    state.error = '';
    state.stale = false;
  }
  renderAll();
  renderFavorites();

  state.fcAbort?.abort();
  const controller = new AbortController();
  state.fcAbort = controller;

  const cached = cacheGet('fc', 6 * 60 * 60 * 1000);
  let usedCache = false;
  if (cached && Number(cached.lat) === Number(key.split(',')[0]) && Number(cached.lon) === Number(key.split(',')[1]) && cached.payload) {
    try {
      if (!silent) state.status = 'ready';
      applyForecast(cached.payload, { resetWindow, fromCache: true });
      usedCache = true;
    } catch { /* ignore broken cache */ }
  }

  try {
    const raw = await fetchForecast(location.lat, location.lon, { signal: controller.signal });
    if (controller.signal.aborted) return;
    cacheSet('fc', { lat: Number(key.split(',')[0]), lon: Number(key.split(',')[1]), payload: raw });
    applyForecast(raw, { resetWindow });
    state.status = 'ready';
    state.stale = false;
    state.error = '';
  } catch (err) {
    if (controller.signal.aborted) return;
    if (usedCache) {
      state.status = 'ready';
      state.stale = true;
      showToast('Brak świeżych danych — pokazuję zapisane prognozy.', 'warn');
    } else if (same && state.data) {
      state.status = 'ready';
      state.stale = true;
      showToast('Odświeżanie nie powiodło się — zostają poprzednie dane.', 'warn');
    } else {
      state.status = 'error';
      state.error = forecastErrorMessage(err);
      if (err) console.info('[Pogoda] Nie udało się pobrać prognozy:', err);
    }
  }
  renderAll();
}

function forecastErrorMessage(err) {
  const raw = String(err?.message || '');
  if (/HTTP\s+\d+/i.test(raw)) return 'Serwis pogodowy jest chwilowo niedostępny. Spróbuj ponownie za chwilę.';
  if (/czas oczekiwania|timeout/i.test(raw)) return 'Serwis pogodowy nie odpowiedział na czas. Spróbuj ponownie.';
  if (/przerwano pobieranie/i.test(raw)) return 'Pobieranie zostało przerwane. Spróbuj ponownie.';
  return 'Nie udało się pobrać prognozy. Sprawdź połączenie z internetem i spróbuj ponownie.';
}

function applyForecast(raw, { resetWindow = false } = {}) {
  const ds = buildDataset(raw);
  state.data = ds;
  state.dataKey = `${Number(state.location.lat).toFixed(3)},${Number(state.location.lon).toFixed(3)}`;
  state.nowIndex = findNowIndex(ds);
  state.location.elevation = state.location.elevation ?? ds.elevation ?? null;
  state.location.timezone = ds.timezone || state.location.timezone;
  state.inspect = null;
  hideReadout();
  const hours = state.windowHours;
  const maxStart = Math.max(0, ds.n - hours);
  if (resetWindow || !Number.isFinite(state.windowStart)) {
    state.windowStart = clamp(state.nowIndex - Math.round(hours * 0.08), 0, maxStart);
  } else {
    state.windowStart = clamp(state.windowStart, 0, maxStart);
  }
  if (state.selectedDay && !ds.dayMeta.has(state.selectedDay)) state.selectedDay = null;
  chart?.setData(ds);
  chart?.setView({
    start: state.windowStart,
    length: hours,
    nowIndex: state.nowIndex,
    visibleBands: visibleBandIds(),
    theme: settings.theme,
    source: state.source,
    units: { wind: settings.wind, pressure: settings.pressure },
    selectedDay: state.selectedDay,
  });
  saveJSON(LAST_KEY, state.location);
  renderAll();
  renderFavorites();
}

function visibleBandIds() {
  const ids = BANDS.filter((b) => settings.bands[b.id] !== false).map((b) => b.id);
  return ids.length ? ids : [BANDS[0].id];
}

async function loadAux({ force = false } = {}) {
  state.auxAbort?.abort();
  const controller = new AbortController();
  state.auxAbort = controller;
  const warnCache = !force ? cacheGet('warn', 10 * 60 * 1000) : null;
  const synopCache = !force ? cacheGet('synop', 10 * 60 * 1000) : null;
  if (warnCache) state.warnings = { status: 'ready', items: warnCache, error: '' };
  else if (!state.warnings.items.length || force) state.warnings = { status: 'loading', items: state.warnings.items, error: '' };
  if (synopCache) state.synop = { status: 'ready', items: synopCache, error: '' };
  else if (!state.synop.items.length || force) state.synop = { status: 'loading', items: state.synop.items, error: '' };
  renderWarnings();
  renderCurrent();

  const [warnResult, synopResult] = await Promise.allSettled([
    fetchWarnings({ signal: controller.signal }),
    fetchSynop({ signal: controller.signal }),
  ]);
  if (controller.signal.aborted) return;
  if (warnResult.status === 'fulfilled') {
    state.warnings = { status: 'ready', items: warnResult.value, error: '' };
    cacheSet('warn', warnResult.value);
  } else if (!warnCache) {
    state.warnings = { status: 'error', items: [], error: warnResult.reason?.message || 'Błąd sieci' };
  }
  if (synopResult.status === 'fulfilled') {
    state.synop = { status: 'ready', items: synopResult.value, error: '' };
    cacheSet('synop', synopResult.value);
  } else if (!synopCache) {
    state.synop = { status: 'error', items: [], error: synopResult.reason?.message || 'Błąd sieci' };
  }
  renderWarnings();
  renderCurrent();
}

function setupAutoRefresh() {
  clearInterval(state.autoTimer);
  const minutes = Number(settings.refresh) || 0;
  if (!minutes) return;
  state.autoTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (!state.location) return;
    loadLocation(state.location, { resetWindow: false, silent: true });
    loadAux();
  }, minutes * 60 * 1000);
}

// ---------- chart / rendering ----------

const MIN_ZOOM_HOURS = 6;
let windowUiRaf = 0;

function scheduleWindowUi() {
  if (windowUiRaf) return;
  windowUiRaf = requestAnimationFrame(() => {
    windowUiRaf = 0;
    updateWindowBadges();
  });
}

/** Tanie odświeżenie okna czasu podczas gestu: bez przebudowy nagłówka. */
function updateWindowBadges() {
  const n = state.data?.n || 0;
  const maxStart = Math.max(0, n - state.windowHours);
  el.winSlider.max = String(maxStart);
  el.winSlider.value = String(clamp(state.windowStart, 0, maxStart));
  el.winSlider.disabled = maxStart <= 0;
  el.winPrev.disabled = !state.data || state.windowStart <= 0;
  el.winNext.disabled = !state.data || state.windowStart >= maxStart;
  el.windowSeg.querySelectorAll('button[data-hours]').forEach((btn) => {
    const active = Number(btn.dataset.hours) === state.windowHours;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const badge = el.meteoHead.querySelector('[data-window-badge]');
  if (badge) badge.textContent = `${state.windowHours} h`;
  updateWindowUI();
}

/**
 * Przesuwanie wykresu jednym palcem w poziomie: zmienia początek okna,
 * zachowując liczbę widocznych godzin.
 */
function handlePan({ start }) {
  if (!state.data) return;
  const total = Number(state.data.n);
  if (!Number.isFinite(total) || !Number.isFinite(start)) return;
  const next = clamp(Math.round(start), 0, Math.max(0, total - state.windowHours));
  if (next === state.windowStart) return;
  state.windowStart = next;
  updateChart();
  scheduleWindowUi();
}

/**
 * Wywoływane przez meteogram podczas szczypania dwoma palcami.
 * Zmienia liczbę widocznych godzin (zoom osi czasu) i przesuwa okno tak,
 * aby godzina pod środkiem gestu pozostała w tym samym miejscu.
 */
function handleZoom({ start, hours }) {
  if (!state.data) return;
  const total = Number(state.data.n);
  if (!Number.isFinite(total) || total < 2) return;
  if (!Number.isFinite(hours) || !Number.isFinite(start)) {
    console.warn(`zoom: zignorowano (start=${start}, hours=${hours}, n=${total})`);
    return;
  }
  const maxHours = Math.min(168, total);
  const minHours = Math.min(MIN_ZOOM_HOURS, maxHours);
  const nextHours = clamp(Math.round(hours), minHours, maxHours);
  state.windowHours = nextHours;
  state.windowStart = clamp(Math.round(start), 0, Math.max(0, total - nextHours));
  updateChart();
  scheduleWindowUi();
}

function updateChart() {
  if (!state.data || !chart) {
    updateOverlays();
    return;
  }
  chart.setView({
    start: state.windowStart,
    length: state.windowHours,
    nowIndex: state.nowIndex,
    visibleBands: visibleBandIds(),
    theme: settings.theme,
    source: state.source,
    units: { wind: settings.wind, pressure: settings.pressure },
    selectedDay: state.selectedDay,
  });
  updateOverlays();
}

function renderAll() {
  renderHeader();
  renderControls();
  renderCurrent();
  renderWarnings();
  renderDays();
  updateChart();
  renderLegend();
  renderAgreement();
  if (state.inspect) renderReadout(state.inspect);
  else hideReadout();
}

function renderHeader() {
  const loc = state.location;
  if (!loc) {
    el.meteoHead.innerHTML = '<div class="muted">Wybierz miejscowość, aby zobaczyć meteogram.</div>';
    return;
  }
  const ds = state.data;
  let day = currentDayEntry();
  if (state.selectedDay && ds?.dayMeta.has(state.selectedDay)) day = ds.dayMeta.get(state.selectedDay);
  if (!day && ds?.daily?.length) day = ds.daily[0];
  const sunrise = day?.sunrise ? fmtDayFromISO(day.sunrise) : '—';
  const sunset = day?.sunset ? fmtDayFromISO(day.sunset) : '—';
  const now = localNow();
  const tz = ds?.timezone || loc.timezone || 'czas lokalny';
  const abbr = ds?.timezoneAbbreviation ? ` (${ds.timezoneAbbreviation})` : '';
  const elev = loc.elevation ?? ds?.elevation;
  const weather = weatherInfo(series('weather_code')[state.nowIndex]);
  el.meteoHead.innerHTML = `
    <div class="sun-block">
      <div class="sun-row"><span class="sun-ico" aria-hidden="true">🌅</span><span>wschód słońca</span><b>${sunrise}</b></div>
      <div class="sun-row"><span class="sun-ico" aria-hidden="true">🌇</span><span>zachód słońca</span><b>${sunset}</b></div>
      <div class="head-note">${esc(day ? dayLabel(parseLocalISO(`${day.key}T12:00`), false) : '')} · czas lokalny ${esc(tz)}${esc(abbr)}</div>
    </div>
    <div class="place-block">
      <div class="place-line"><strong>${esc(loc.name)}</strong> <span class="muted">(${fmt(loc.lat, 3)}, ${fmt(loc.lon, 3)})${elev !== null && elev !== undefined ? ` · ${fmt(elev, 0)} m n.p.m.` : ''}</span></div>
      <div class="place-meta">
        <span class="badge">${esc(modeLabel())}</span>
        <span class="badge" data-window-badge>${state.windowHours} h</span>
        <button type="button" class="badge badge-btn" data-action="center-now" title="Wyśrodkuj wykres na bieżącej godzinie" aria-label="Wyśrodkuj wykres na teraz">Teraz</button>
        <span class="badge badge-weather">${weather.icon} ${esc(weather.label)}</span>
        ${state.stale ? '<span class="badge badge-warn">dane z cache</span>' : ''}
      </div>
      <div class="head-note">teraz ${pad2(now.h)}:${pad2(now.mi)} · ${state.status === 'loading' ? 'aktualizuję…' : state.status === 'error' ? 'brak danych — spróbuj ponownie' : 'dane Open-Meteo + IMGW-PIB'}</div>
    </div>
  `;
}

function renderControls() {
  el.sourceSeg.querySelectorAll('button[data-source]').forEach((btn) => {
    const active = btn.dataset.source === state.source;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  el.modelSelect.value = state.source;
  el.windowSeg.querySelectorAll('button[data-hours]').forEach((btn) => {
    const active = Number(btn.dataset.hours) === state.windowHours;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const n = state.data?.n || 0;
  const maxStart = Math.max(0, n - state.windowHours);
  el.winSlider.max = String(maxStart);
  el.winSlider.value = String(clamp(state.windowStart, 0, maxStart));
  el.winSlider.disabled = maxStart <= 0;
  el.winPrev.disabled = !state.data || state.windowStart <= 0;
  el.winNext.disabled = !state.data || state.windowStart >= maxStart;
  updateWindowUI();
}

function updateWindowUI() {
  if (!state.data) {
    el.winRange.textContent = '—';
    return;
  }
  const start = clamp(state.windowStart, 0, Math.max(0, state.data.n - state.windowHours));
  const end = Math.min(state.data.n - 1, start + state.windowHours - 1);
  const a = state.data.times[start];
  const b = state.data.times[end];
  el.winRange.textContent = `${fmtDateTime(a)} – ${fmtDateTime(b)}`;
  el.winRange.title = el.winRange.textContent;
}

function renderAgreement() {
  if (!state.data) {
    el.agreePill.textContent = 'zgodność —';
    el.agreePill.removeAttribute('title');
    return;
  }
  let idx = state.inspect?.index;
  if (idx === null || idx === undefined) idx = chart?.getFocusedIndex();
  if (idx === null || idx === undefined) idx = state.nowIndex;
  const max = state.data.consensus.temperature_2m.max[idx];
  const min = state.data.consensus.temperature_2m.min[idx];
  const t = state.data.times[idx];
  if (max === null || min === null || max === undefined || min === undefined) {
    el.agreePill.textContent = 'zgodność —';
    el.agreePill.removeAttribute('title');
    return;
  }
  const half = (max - min) / 2;
  el.agreePill.textContent = `zgodność ±${fmt(half, 1)}°C`;
  el.agreePill.title = `Połowa rozrzutu temperatury między 5 modelami: ${fmt(min, 1)}–${fmt(max, 1)}°C o ${timeLabel(t)} (${dayLabel(t, false)}).`;
}

function renderCurrent() {
  const loc = state.location;
  if (!loc) { el.currentPanel.innerHTML = ''; return; }
  const ds = state.data;
  if (!ds) {
    if (state.status === 'error') {
      el.currentPanel.innerHTML = `
        <div class="current-head">
          <div class="current-title">
            <span class="eyebrow">Bieżące warunki</span>
            <h2>${esc(loc.name)}</h2>
          </div>
        </div>
        <div class="current-error" role="status">
          <div>
            <strong>Brak danych dla tej lokalizacji</strong>
            <p class="muted">${esc(state.error || 'Nie udało się pobrać prognozy. Spróbuj ponownie.')}</p>
          </div>
          <button type="button" class="primary-btn" data-action="retry-current">Ponów</button>
        </div>
        <div class="imgw-row muted">IMGW-PIB: obserwacje będą dostępne po pobraniu prognozy.</div>
      `;
      return;
    }
    el.currentPanel.innerHTML = `
      <div class="current-head">
        <div><span class="eyebrow">Bieżące warunki</span><h2>${esc(loc.name)}</h2><p class="muted">Pobieram dane dla tej lokalizacji…</p></div>
      </div>
      <div class="metrics skeleton-metrics">${'<div class="metric skeleton"></div>'.repeat(6)}</div>
      <div class="imgw-row muted">IMGW-PIB: czekam na dane.</div>
    `;
    return;
  }
  const i = state.nowIndex;
  const t = ds.times[i];
  const temp = series('temperature_2m')[i];
  const feels = series('apparent_temperature')[i];
  const dew = series('dew_point_2m')[i];
  const precip = series('precipitation')[i];
  const prob = series('precipitation_probability')[i];
  const hum = series('relative_humidity_2m')[i];
  const wind = series('wind_speed_10m')[i];
  const gust = series('wind_gusts_10m')[i];
  const dir = series('wind_direction_10m')[i];
  const pressure = series('pressure_msl')[i];
  const cloud = series('cloud_cover')[i];
  const vis = series('visibility')[i];
  const rad = series('shortwave_radiation')[i];
  const code = series('weather_code')[i];
  const fog = seriesFog()[i];
  const weather = weatherInfo(code);
  const oct = cloud === null ? null : clamp(Math.round((cloud / 100) * 8), 0, 8);
  const visKm = vis === null ? null : vis / 1000;
  const fogLabel = fog === 2 ? 'wysokie' : fog === 1 ? 'zamglenie' : 'brak';
  const fav = isFavorite(loc);
  const now = localNow();
  const station = synopSummary(ds, i);

  el.currentPanel.innerHTML = `
    <div class="current-head">
      <div class="current-title">
        <span class="eyebrow">Bieżące warunki · ${pad2(now.h)}:${pad2(now.mi)}</span>
        <h2>${esc(loc.name)} <span class="weather-inline">${weather.icon} ${esc(weather.label)}</span></h2>
        <p class="muted">${esc([loc.admin1, loc.country].filter(Boolean).join(' · '))}</p>
      </div>
      <button type="button" class="ghost-btn ${fav ? 'is-fav' : ''}" data-action="toggle-fav">${fav ? '★ W ulubionych' : '☆ Dodaj do ulubionych'}</button>
    </div>
    <div class="metrics">
      ${metric('Temperatura', `${fmt(temp, 1)}°C`, `odczuwalna ${fmt(feels, 1)}°C · punkt rosy ${fmt(dew, 1)}°C`)}
      ${metric('Opad', `${fmt(precip, 1)} mm/h`, `szansa ${fmt(prob, 0)}% · ${precipTypeLabel(seriesType()[i])}`)}
      ${metric('Wilgotność', `${fmt(hum, 0)}%`, `ciśnienie ${pressureText(pressure)}`)}
      ${metric('Wiatr', windText(wind), `porywy ${windText(gust)} · z ${compass(dir)}`)}
      ${metric('Ciśnienie', pressureText(pressure), settings.pressure === 'mmhg' ? `${fmt(pressure, 0)} hPa` : `${fmt(pressure === null ? null : pressure * 0.750062, 0)} mm Hg`)}
      ${metric('Zachmurzenie', `${fmt(cloud, 0)}%`, `${fmt(oct, 0)} oktantów · widzialność ${visKm === null ? '—' : `${fmt(visKm, visKm < 1 ? 2 : 1)} km`}`)}
      ${metric('Mgła', fogLabel, `promieniowanie ${fmt(rad, 0)} W/m²`)}
      ${metric('Wschód / zachód', `${currentDayEntry()?.sunrise ? fmtDayFromISO(currentDayEntry().sunrise) : '—'} / ${currentDayEntry()?.sunset ? fmtDayFromISO(currentDayEntry().sunset) : '—'}`, esc(dayLabel(t, false)))}
    </div>
    <div class="imgw-row">${station.html}</div>
  `;
}

function metric(label, value, sub) {
  return `<div class="metric"><span class="m-label">${esc(label)}</span><strong>${value}</strong><span class="m-sub">${sub}</span></div>`;
}

function precipTypeLabel(type) {
  return type === 'snow' ? 'śnieg' : type === 'sleet' ? 'deszcz ze śniegiem' : type === 'rain' ? 'deszcz' : 'brak opadu';
}

function parseNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function synopSummary(ds, nowIdx) {
  const loc = state.location;
  if (!loc) return { html: '' };
  if (!isInPoland(loc.lat, loc.lon, loc.countryCode)) {
    return { html: '<span class="imgw-dot"></span><span>IMGW-PIB: punkt poza Polską — najbliższa stacja synoptyczna nie jest reprezentatywna dla tej lokalizacji.</span>' };
  }
  if (state.synop.status === 'loading') return { html: '<span class="imgw-dot"></span><span>IMGW-PIB: pobieram obserwacje synoptyczne…</span>' };
  if (state.synop.status === 'error') {
    return { html: `<span class="imgw-dot is-error"></span><span>IMGW-PIB: nie udało się pobrać obserwacji (${esc(state.synop.error)}).</span><button type="button" class="link-btn" data-action="retry-aux">Ponów</button>` };
  }
  if (!state.synop.items.length) return { html: '<span class="imgw-dot"></span><span>IMGW-PIB: brak danych synoptycznych.</span>' };
  const near = nearestStation(loc.lat, loc.lon, SYNOP_STATIONS);
  if (!near) return { html: '<span class="imgw-dot"></span><span>IMGW-PIB: brak dopasowanej stacji.</span>' };
  const row = state.synop.items.find((s) => s.stacja === near.name);
  if (!row) {
    return { html: `<span class="imgw-dot"></span><span>IMGW-PIB: najbliższa stacja ${esc(near.name)} (${fmt(near.distance, 0)} km) — brak aktualnego odczytu.</span>` };
  }
  const stT = parseNum(row.temperatura);
  const stP = parseNum(row.cisnienie);
  const stH = parseNum(row.wilgotnosc_wzgledna);
  const stW = parseNum(row.predkosc_wiatru);
  const stRain = parseNum(row.suma_opadu);
  const idx = stationForecastIndex(ds, row);
  const fcT = idx === null ? null : series('temperature_2m')[idx];
  const delta = stT !== null && fcT !== null ? fcT - stT : null;
  const time = row.godzina_pomiaru ? `${pad2(Number(row.godzina_pomiaru))}:00` : '—';
  const deltaTxt = delta === null ? '' : ` · prognoza ${fmt(fcT, 1)}°C (Δ ${signed(delta, 1)}°C)`;
  return {
    html: `<span class="imgw-dot"></span><span><b>IMGW ${esc(near.name)}</b> · ${fmt(near.distance, 0)} km · pomiar ${esc(time)}: ${fmt(stT, 1)}°C${esc(deltaTxt)} · ${stP === null ? '—' : `${fmt(stP, 0)} hPa`} · ${fmt(stH, 0)}% · wiatr ${stW === null ? '—' : `${fmt(stW, 1)} m/s`}${stRain === null ? '' : ` · opad ${fmt(stRain, 1)} mm`}</span>`,
  };
}

function stationForecastIndex(ds, row) {
  if (!row.data_pomiaru || row.godzina_pomiaru === undefined) return null;
  const h = Number(row.godzina_pomiaru);
  if (!Number.isFinite(h)) return null;
  const iso = `${row.data_pomiaru}T${pad2(h)}:00`;
  const parsed = parseLocalISO(iso);
  if (!parsed) return null;
  const idx = ds.times.findIndex((t) => t.t === parsed.t);
  return idx >= 0 ? idx : null;
}

function renderWarnings() {
  const loc = state.location;
  if (!loc) { el.warningsPanel.innerHTML = ''; return; }
  const status = state.warnings.status;
  const region = (loc.admin1 || '').replace(/województwo/i, '').trim();
  const filtered = filterWarnings(state.warnings.items, loc);
  let summary = '';
  let cls = 'warn-none';
  if (status === 'loading') { summary = 'pobieram ostrzeżenia…'; cls = 'warn-loading'; }
  else if (status === 'error') { summary = 'błąd pobierania ostrzeżeń'; cls = 'warn-error'; }
  else if (filtered.outside) { summary = 'punkt poza Polską — IMGW-PIB nie wydaje tu ostrzeżeń'; cls = 'warn-outside'; }
  else if (!filtered.items.length) { summary = `brak aktywnych ostrzeżeń${region ? ` dla woj. ${region}` : ''}`; cls = 'warn-none'; }
  else {
    const max = Math.max(...filtered.items.map((w) => Number(w.stopien) || 0));
    const meta = warningLevelMeta(max);
    cls = meta.cls;
    summary = `${filtered.items.length} ${filtered.items.length === 1 ? 'ostrzeżenie' : 'ostrzeżenia'}${region ? ` · woj. ${region}` : ''} · najwyższy ${meta.label.toLowerCase()}`;
  }

  let body = '';
  if (status === 'error') {
    body = `<div class="warn-message">Nie udało się pobrać ostrzeżeń IMGW-PIB. ${esc(state.warnings.error)} <button type="button" class="link-btn" data-action="retry-warn">Ponów</button></div>`;
  } else if (status === 'loading') {
    body = '<div class="warn-message">Trwa pobieranie danych IMGW-PIB…</div>';
  } else if (filtered.outside) {
    body = '<div class="warn-message">Ostrzeżenia meteorologiczne IMGW-PIB dotyczą wyłącznie obszaru Polski. Dla tej lokalizacji sprawdź lokalne służby meteorologiczne.</div>';
  } else if (!filtered.items.length) {
    body = `<div class="warn-message">Brak aktywnych ostrzeżeń meteorologicznych IMGW-PIB${region ? ` dla województwa ${esc(region)}` : ''} w chwili pobrania danych.</div>`;
  } else {
    body = `<div class="warn-list">${filtered.items.map((w) => {
      const meta = warningLevelMeta(w.stopien);
      const from = formatWarnDate(w.obowiazuje_od);
      const to = formatWarnDate(w.obowiazuje_do);
      const prob = w.prawdopodobienstwo ? ` · prawdopodobieństwo ${esc(w.prawdopodobienstwo)}%` : '';
      return `
        <article class="warning-item ${meta.cls}">
          <div class="warning-top"><span class="warn-level ${meta.cls}">${meta.label}</span><b>${esc(w.nazwa_zdarzenia)}</b></div>
          <p class="warning-meta">${esc(from)} – ${esc(to)}${prob}</p>
          <p class="warning-text">${esc(w.tresc)}</p>
          ${w.biuro ? `<p class="warning-office">${esc(w.biuro)}</p>` : ''}
        </article>
      `;
    }).join('')}</div>`;
  }

  el.warningsPanel.innerHTML = `
    <details class="warn-card ${cls}">
      <summary>
        <span class="warn-ico" aria-hidden="true">⚠️</span>
        <span class="warn-summary"><b>Ostrzeżenia IMGW-PIB</b><span>${esc(summary)}</span></span>
        <span class="warn-count ${cls}">${status === 'ready' && !filtered.outside ? filtered.items.length : '—'}</span>
      </summary>
      <div class="warn-body">${body}</div>
    </details>
  `;
}

function formatWarnDate(value) {
  if (!value) return '—';
  const t = parseLocalISO(String(value).replace(' ', 'T'));
  return t ? `${dayLabel(t, false)} ${timeLabel(t)}` : String(value);
}

function renderDays() {
  const ds = state.data;
  if (!ds) {
    el.daysPanel.innerHTML = '<div class="days-placeholder muted">Prognoza 7-dniowa pojawi się po pobraniu danych.</div>';
    return;
  }
  const now = localNow();
  const todayKey = `${now.y}-${pad2(now.mo)}-${pad2(now.d)}`;
  const startIdx = Math.max(0, ds.daily.findIndex((d) => d.key === todayKey));
  const days = ds.daily.slice(startIdx, startIdx + 7);
  el.daysPanel.innerHTML = `
    <div class="days-head"><b>7 dni</b><span class="muted">kliknij dzień, aby przewinąć meteogram</span></div>
    <div class="days-grid">
      ${days.map((d) => {
        const w = weatherInfo(d.weatherCode);
        const active = state.selectedDay === d.key;
        const today = d.key === todayKey;
        return `
          <button type="button" class="day-card ${active ? 'is-active' : ''} ${today ? 'is-today' : ''}" data-day="${d.key}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="dc-top"><b>${today ? 'dziś' : dayLabel(parseLocalISO(`${d.key}T12:00`), false).split(',')[0]}</b><span>${d.key.slice(5).replace('-', '.')}</span></span>
            <span class="dc-icon" aria-hidden="true">${w.icon}</span>
            <span class="dc-desc">${esc(w.label)}</span>
            <span class="dc-temp"><b>${fmt(d.tmax, 0)}°</b><span>${fmt(d.tmin, 0)}°</span></span>
            <span class="dc-meta">💧 ${fmt(d.precipProb, 0)}% · ${fmt(d.precipSum, 1)} mm</span>
            <span class="dc-sun">↑${d.sunrise ? fmtDayFromISO(d.sunrise) : '—'} ↓${d.sunset ? fmtDayFromISO(d.sunset) : '—'}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderLegend() {
  const dark = settings.theme === 'dark';
  const items = [
    [dark ? '#f87171' : '#dc2626', 'temperatura'],
    [dark ? '#60a5fa' : '#2563eb', 'odczuwalna'],
    [dark ? '#c084fc' : '#7c3aed', 'punkt rosy'],
    [dark ? '#fb923c' : '#c2410c', 'wilgotność'],
    [dark ? '#4ade80' : '#16a34a', 'szansa opadu'],
    [dark ? '#e2e8f0' : '#0f172a', 'ciśnienie'],
    [dark ? '#4ade80' : '#22c55e', 'wiatr'],
    [dark ? '#f87171' : '#dc2626', 'porywy'],
    [dark ? '#93c5fd' : '#60a5fa', 'chmury'],
    [dark ? '#fb923c' : '#ea580c', 'widzialność'],
    [dark ? '#fbbf24' : '#f59e0b', 'słońce'],
    ['#94a3b8', 'mgła'],
  ];
  el.legend.innerHTML = items.map(([color, label]) => `<span class="legend-item"><i style="background:${color}"></i>${esc(label)}</span>`).join('');
  if (state.source === 'compare') {
    el.legend.innerHTML += '<span class="legend-sep">modele:</span>' + MODELS.map((m) => `<span class="legend-item"><i style="background:${m.color}"></i>${esc(m.short)}</span>`).join('');
  }
}

function handleInspect(info) {
  state.inspect = info;
  if (!info || !state.data) {
    hideReadout();
    renderAgreement();
    return;
  }
  renderReadout(info);
  renderAgreement();
}

function hideReadout() {
  if (!el.readout) return;
  el.readout.hidden = true;
  el.readout.classList.remove('is-pinned');
  el.readout.style.left = '';
  el.readout.style.top = '';
}

function renderReadout(info) {
  if (!state.data || !info) { hideReadout(); return; }
  const ds = state.data;
  const i = clamp(info.index, 0, ds.n - 1);
  const t = ds.times[i];
  const temp = series('temperature_2m')[i];
  const feels = series('apparent_temperature')[i];
  const dew = series('dew_point_2m')[i];
  const precip = series('precipitation')[i];
  const prob = series('precipitation_probability')[i];
  const hum = series('relative_humidity_2m')[i];
  const p = series('pressure_msl')[i];
  const wind = series('wind_speed_10m')[i];
  const gust = series('wind_gusts_10m')[i];
  const dir = series('wind_direction_10m')[i];
  const dirNorm = dir === null || dir === undefined ? null : ((dir % 360) + 360) % 360;
  const cloud = series('cloud_cover')[i];
  const cLow = series('cloud_cover_low')[i];
  const cMid = series('cloud_cover_mid')[i];
  const cHigh = series('cloud_cover_high')[i];
  const vis = series('visibility')[i];
  const rad = series('shortwave_radiation')[i];
  const code = series('weather_code')[i];
  const fog = seriesFog()[i];
  const oct = cloud === null ? null : clamp(Math.round((cloud / 100) * 8), 0, 8);
  const weather = weatherInfo(code);
  const min = ds.consensus.temperature_2m.min[i];
  const max = ds.consensus.temperature_2m.max[i];
  const spread = min === null || max === null ? null : max - min;
  const type = precipTypeLabel(seriesType()[i]);
  const visKm = vis === null ? null : vis / 1000;
  const fogLabel = fog === 2 ? 'wysoka' : fog === 1 ? 'umiarkowana' : 'brak';
  const isNow = i === state.nowIndex;
  const pinned = Boolean(info.pinned);
  const activeModel = state.source !== 'consensus' && state.source !== 'compare' ? state.source : null;

  const rows = MODELS.map((m) => {
    const mm = ds.models[m.id];
    const mt = mm.temperature_2m[i];
    const mp = mm.precipitation[i];
    const mw = mm.wind_speed_10m[i];
    const mc = mm.pressure_msl[i];
    const mpr = mm.precipitation_probability[i];
    return `<tr class="${activeModel === m.id ? 'is-active' : ''}">
      <th scope="row" title="${esc(m.label)}">${esc(m.short)}</th>
      <td>${fmt(mt, 1)}</td>
      <td>${fmt(mp, 1)}</td>
      <td>${fmt(windDisp(mw), settings.wind === 'kmh' ? 0 : 1)}</td>
      <td>${fmt(pressureDisp(mc), 0)}</td>
      <td>${fmt(mpr, 0)}</td>
    </tr>`;
  }).join('');

  el.readout.innerHTML = `
    <div class="readout-head">
      <div class="ro-time"><b>${dayLabel(t, false)}</b><span>${timeLabel(t)}</span></div>
      <div class="ro-badges">
        ${isNow ? '<span class="badge badge-now">teraz</span>' : ''}
        ${pinned ? '<span class="badge badge-pin">przypięte</span>' : ''}
      </div>
      <button type="button" class="icon-btn tiny" data-close-readout aria-label="Zamknij kartę odczytu">✕</button>
    </div>
    <div class="readout-weather">${weather.icon} ${esc(weather.label)}</div>
    <div class="readout-grid">
      ${roItem('Temperatura', `${fmt(temp, 1)}°C`, `odczuwalna ${fmt(feels, 1)}°C · punkt rosy ${fmt(dew, 1)}°C`)}
      ${roItem('Opad', `${fmt(precip, 1)} mm`, `${type} · szansa ${fmt(prob, 0)}%`)}
      ${roItem('Wilgotność', `${fmt(hum, 0)}%`, `punkt rosy ${fmt(dew, 1)}°C`)}
      ${roItem('Ciśnienie', pressureText(p), settings.pressure === 'mmhg' ? `${fmt(p, 0)} hPa` : `${fmt(p === null ? null : p * 0.750062, 0)} mm Hg`)}
      ${roItem('Wiatr', windText(wind), `porywy ${windText(gust)} · z ${compass(dir)} (${fmt(dirNorm, 0)}°)`)}
      ${roItem('Kierunek', compass(dir), `${fmt(dirNorm, 0)}° · róża 16 kierunków`)}
      ${roItem('Chmury', `${fmt(cLow, 0)} / ${fmt(cMid, 0)} / ${fmt(cHigh, 0)}%`, `widzialność ${visKm === null ? '—' : `${fmt(visKm, 1)} km`}`)}
      ${roItem('Zachmurzenie', `${fmt(cloud, 0)}% · ${fmt(oct, 0)} okt.`, `mgła: ${fogLabel} · słońce ${fmt(rad, 0)} W/m²`)}
    </div>
    <div class="ro-range">Rozrzut 5 modeli: <b>${fmt(min, 1)}–${fmt(max, 1)}°C</b> (Δ ${fmt(spread, 1)}°C)</div>
    <div class="model-table-wrap">
      <table class="model-table">
        <caption>Wszystkie modele · ${timeLabel(t)} · ${settings.wind === 'kmh' ? 'km/h' : 'm/s'}, ${pressureUnit()}</caption>
        <thead><tr><th scope="col">model</th><th scope="col">T °C</th><th scope="col">mm</th><th scope="col">wiatr</th><th scope="col">ciśn.</th><th scope="col">P %</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="readout-hint">Kliknij godzinę, aby przypiąć lub odpiąć. <kbd>Esc</kbd> zamyka.</div>
  `;
  el.readout.hidden = false;
  el.readout.classList.toggle('is-pinned', pinned);
  if (pinned) {
    el.readout.style.left = '';
    el.readout.style.top = '';
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rw = el.readout.offsetWidth;
    const rh = el.readout.offsetHeight;
    let left = info.clientX + 18;
    if (left + rw > vw - 10) left = info.clientX - rw - 18;
    left = clamp(left, 10, Math.max(10, vw - rw - 10));
    let top = info.clientY + 16;
    if (top + rh > vh - 10) top = info.clientY - rh - 16;
    top = clamp(top, 74, Math.max(74, vh - rh - 10));
    el.readout.style.left = `${Math.round(left)}px`;
    el.readout.style.top = `${Math.round(top)}px`;
  }
}

function roItem(label, value, sub) {
  return `<div class="ro-item"><span>${esc(label)}</span><b>${value}</b><small>${sub}</small></div>`;
}

function updateOverlays() {
  if (!el.loading) return;
  const loading = state.status === 'loading';
  el.loading.hidden = !loading;
  if (el.loadingText) {
    el.loadingText.textContent = state.location
      ? `Pobieram prognozę dla ${state.location.name}…`
      : 'Pobieram prognozę…';
  }
  const error = state.status === 'error';
  el.chartError.hidden = !error;
  if (error && el.chartErrorText) {
    el.chartErrorText.textContent = state.error || 'Sprawdź połączenie z internetem i spróbuj ponownie.';
  }
  el.canvas.setAttribute('aria-busy', loading ? 'true' : 'false');
  el.canvas.setAttribute('aria-label', state.data
    ? `Meteogram dla ${state.location?.name || ''}: 8 pasm, ${state.windowHours} godzin, ${modeLabel()}. Użyj strzałek, aby wybierać godziny, Enter przypina.`
    : 'Meteogram pogodowy');
}

// ---------- actions ----------

function setSource(source) {
  if (!(source === 'consensus' || source === 'compare' || MODEL_BY_ID[source])) return;
  if (state.source === source) return;
  state.source = source;
  state.inspect = null;
  chart?.clearSelection({ notify: false });
  hideReadout();
  renderAll();
}

/**
 * Przycisk „Teraz” w nagłówku meteogramu: przesuwa okno tak, aby bieżąca
 * godzina wypadła w środku widocznego zakresu (bez zmiany liczby godzin).
 */
function centerOnNow() {
  if (!state.data) return;
  const total = Number(state.data.n);
  const hours = state.windowHours;
  if (!Number.isFinite(total) || total < 2 || !Number.isFinite(hours)) return;
  const maxStart = Math.max(0, total - hours);
  state.windowStart = clamp(Math.round(state.nowIndex - (hours - 1) / 2), 0, maxStart);
  state.selectedDay = null;
  state.inspect = null;
  chart?.clearSelection({ notify: false });
  hideReadout();
  updateChart();
  updateWindowUI();
  renderControls();
  renderAgreement();
  el.daysPanel.querySelectorAll('.day-card.is-active').forEach((card) => {
    card.classList.remove('is-active');
    card.setAttribute('aria-pressed', 'false');
  });
}

function setWindowHours(hours) {
  if (![24, 60, 72, 168].includes(hours)) return;
  state.windowHours = hours;
  const n = state.data?.n || 192;
  const maxStart = Math.max(0, n - hours);
  state.windowStart = clamp(state.nowIndex - Math.round(hours * 0.08), 0, maxStart);
  state.selectedDay = null;
  state.inspect = null;
  chart?.clearSelection({ notify: false });
  hideReadout();
  renderAll();
}

function panWindow(delta) {
  if (!state.data) return;
  const maxStart = Math.max(0, state.data.n - state.windowHours);
  state.windowStart = clamp(state.windowStart + delta, 0, maxStart);
  state.selectedDay = null;
  state.inspect = null;
  chart?.clearSelection({ notify: false });
  hideReadout();
  updateChart();
  updateWindowUI();
  renderControls();
  renderAgreement();
  el.daysPanel.querySelectorAll('.day-card.is-active').forEach((card) => {
    card.classList.remove('is-active');
    card.setAttribute('aria-pressed', 'false');
  });
}

function selectDay(key) {
  if (!state.data) return;
  if (state.selectedDay === key) {
    state.selectedDay = null;
    renderAll();
    return;
  }
  state.selectedDay = key;
  const entry = state.data.dayMeta.get(key);
  if (entry) {
    const maxStart = Math.max(0, state.data.n - state.windowHours);
    const offset = state.windowHours > 24 ? 1 : 0;
    state.windowStart = clamp(entry.start > 0 ? entry.start - offset : 0, 0, maxStart);
  }
  state.inspect = null;
  chart?.clearSelection({ notify: false });
  hideReadout();
  renderAll();
  el.meteoCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- boot ----------

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
