// Silnik meteogramu: Canvas HiDPI, 8 zsynchronizowanych pasm, crosshair i przypinanie.

import {
  MODELS, BANDS, fmt, dayLabel, timeLabel, dayKeyOf, clamp,
} from './data.js';

const BAND_LAYOUT = {
  temp: { h: 128, mh: 106 },
  precip: { h: 104, mh: 90 },
  prob: { h: 84, mh: 74 },
  pressure: { h: 96, mh: 84 },
  wind: { h: 104, mh: 90 },
  dir: { h: 80, mh: 64 },
  clouds: { h: 118, mh: 100 },
  cover: { h: 108, mh: 94 },
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const PALETTE = {
  light: {
    bg: '#ffffff', plot: '#ffffff', text: '#1f2937', muted: '#64748b',
    grid: 'rgba(15,23,42,0.10)', gridSoft: 'rgba(15,23,42,0.055)', border: '#475569', borderSoft: 'rgba(15,23,42,0.25)',
    night: 'rgba(15,23,42,0.055)', nightAlt: 'rgba(15,23,42,0.09)',
    dayCell: 'rgba(15,23,42,0.055)', dayCellAlt: 'rgba(15,23,42,0.09)', dayText: '#334155',
    temp: '#dc2626', dew: '#7c3aed', feels: '#2563eb', range: 'rgba(37,99,235,0.14)', cold: 'rgba(96,165,250,0.18)',
    rain: '#2563eb', snow: '#7dd3fc', sleet: '#8b5cf6', humidity: '#c2410c',
    prob: '#16a34a', probFill: 'rgba(22,163,74,0.13)',
    pressure: '#0f172a', zoneLow: 'rgba(37,99,235,0.15)', zoneMid: 'rgba(14,165,233,0.12)',
    zoneNorm: 'rgba(234,179,8,0.15)', zoneHigh: 'rgba(249,115,22,0.20)',
    wind: '#0f172a', gust: '#dc2626', arrow: '#1e3a8a',
    cloudLow: 'rgba(96,165,250,', cloudMid: 'rgba(59,130,246,', cloudHigh: 'rgba(29,78,216,',
    vis: '#ea580c', cover: 'rgba(30,41,59,0.72)', fog: 'rgba(148,163,184,0.42)', sun: '#f59e0b',
    now: '#e11d48', pin: '#2563eb', crosshair: '#0f172a', selected: 'rgba(37,99,235,0.075)',
    dotHalo: '#ffffff', labelBg: 'rgba(255,255,255,0.92)',
  },
  dark: {
    bg: '#22262b', plot: '#262b30', text: '#e8eaed', muted: '#a6adb6',
    grid: 'rgba(232,234,237,0.14)', gridSoft: 'rgba(232,234,237,0.07)', border: '#79828d', borderSoft: 'rgba(232,234,237,0.30)',
    night: 'rgba(0,0,0,0.20)', nightAlt: 'rgba(0,0,0,0.32)',
    dayCell: 'rgba(200,210,220,0.10)', dayCellAlt: 'rgba(200,210,220,0.17)', dayText: '#d5dae0',
    temp: '#f87171', dew: '#c084fc', feels: '#60a5fa', range: 'rgba(96,165,250,0.20)', cold: 'rgba(56,189,248,0.14)',
    rain: '#60a5fa', snow: '#bae6fd', sleet: '#c4b5fd', humidity: '#fb923c',
    prob: '#4ade80', probFill: 'rgba(74,222,128,0.13)',
    pressure: '#e2e8f0', zoneLow: 'rgba(96,165,250,0.17)', zoneMid: 'rgba(56,189,248,0.12)',
    zoneNorm: 'rgba(250,204,21,0.15)', zoneHigh: 'rgba(251,146,60,0.20)',
    wind: '#e2e8f0', gust: '#f87171', arrow: '#93c5fd',
    cloudLow: 'rgba(125,211,252,', cloudMid: 'rgba(96,165,250,', cloudHigh: 'rgba(59,130,246,',
    vis: '#fb923c', cover: 'rgba(203,213,225,0.58)', fog: 'rgba(148,163,184,0.28)', sun: '#fbbf24',
    now: '#fb7185', pin: '#60a5fa', crosshair: '#e2e8f0', selected: 'rgba(96,165,250,0.10)',
    dotHalo: '#262b30', labelBg: 'rgba(38,43,48,0.92)',
  },
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function niceScale(min, max, count = 5) {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = mag;
  if (norm > 5) step = 10 * mag;
  else if (norm > 2.5) step = 5 * mag;
  else if (norm > 2) step = 2.5 * mag;
  else if (norm > 1) step = 2 * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-7; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: lo, max: hi, step, ticks };
}

function strokeSeries(ctx, values, i0, i1, xOf, yOf, color, width, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  let started = false;
  ctx.beginPath();
  for (let i = i0; i <= i1; i += 1) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) { started = false; continue; }
    const x = xOf(i);
    const y = yOf(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function fillUnder(ctx, values, i0, i1, xOf, yOf, baseY, fill) {
  let seg = [];
  const flush = () => {
    if (seg.length > 1) {
      ctx.beginPath();
      ctx.moveTo(seg[0][0], baseY);
      for (const [x, y] of seg) ctx.lineTo(x, y);
      ctx.lineTo(seg[seg.length - 1][0], baseY);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    seg = [];
  };
  for (let i = i0; i <= i1; i += 1) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) { flush(); continue; }
    seg.push([xOf(i), yOf(v)]);
  }
  flush();
}

function fillBetweenV(ctx, upper, lower, i0, i1, xOf, yOf, fill) {
  let seg = [];
  const flush = () => {
    if (seg.length > 1) {
      ctx.beginPath();
      ctx.moveTo(seg[0][0], seg[0][1]);
      for (const [x, yu, yl] of seg) ctx.lineTo(x, yu);
      for (let k = seg.length - 1; k >= 0; k -= 1) ctx.lineTo(seg[k][0], seg[k][2]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    seg = [];
  };
  for (let i = i0; i <= i1; i += 1) {
    const a = upper[i];
    const b = lower[i];
    if (a === null || b === null || a === undefined || b === undefined) { flush(); continue; }
    seg.push([xOf(i), yOf(a), yOf(b)]);
  }
  flush();
}

export class Meteogram {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.bctx = this.base.getContext('2d');
    this.callbacks = callbacks;
    this.ds = null;
    this.view = {
      start: 0, length: 60, visibleBands: BANDS.map((b) => b.id),
      theme: 'light', source: 'consensus', units: { wind: 'ms', pressure: 'hpa' },
      selectedDay: null, nowIndex: 0,
    };
    this.hover = null;
    this.pinned = null;
    this.layout = null;
    this.raf = null;
    this.pointerStart = null;
    this.pointers = new Map();
    this.pinch = null;
    this._bind();
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.lastWidth = 0;
  }

  setData(ds) {
    this.ds = ds;
    this.clearSelection({ notify: false });
    this.schedule();
  }

  setView(view) {
    const next = { ...this.view, ...view };
    if (!Number.isFinite(next.length) || next.length < 2) next.length = 60;
    if (!Number.isFinite(next.start)) next.start = 0;
    this.view = next;
    if (this.pinned !== null) {
      const last = this.view.start + this.view.length - 1;
      if (this.pinned < this.view.start || this.pinned > last) this.clearSelection();
    }
    this.schedule();
  }

  clearSelection({ notify = true } = {}) {
    const had = this.pinned !== null || this.hover !== null;
    this.pinned = null;
    this.hover = null;
    this.schedule();
    if (had && notify) this.callbacks.onInspect?.(null);
  }

  togglePin(index) {
    if (this.pinned === index) {
      this.clearSelection();
      return;
    }
    this.pinned = index;
    this.hover = index;
    this.schedule();
    this._notify(index, true, null);
  }

  getFocusedIndex() {
    return this.pinned ?? this.hover;
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.render();
    });
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => this._onPointerMove(e));
    c.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    c.addEventListener('pointerup', (e) => this._onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this._onPointerCancel(e));
    c.addEventListener('pointerleave', () => this._onPointerLeave());
    c.addEventListener('keydown', (e) => this._onKeyDown(e));
    // Dwa palce na wykresie to zoom, nie przewijanie strony. Jeden palec nadal
    // przewija stronę dzieki touch-action: pan-y.
    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 2) e.preventDefault();
    }, { passive: false });
    // Ctrl + rolka myszy: zoom osi czasu wykresu (odpowiednik szczypania),
    // zakotwiczony pod kursorem. Bez Ctrl rolka przewija stronę normalnie.
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  _eventIndex(e) {
    if (!this.layout) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { left, top, plotW, plotH, step, start, len } = this.layout;
    if (x < left - 2 || x > left + plotW + 2 || y < top - 2 || y > top + plotH + 2) return null;
    const idx = start + Math.round((x - left) / step);
    return clamp(idx, start, start + len - 1);
  }

  _notify(index, pinned, event) {
    if (index === null) { this.callbacks.onInspect?.(null); return; }
    let cx = event?.clientX;
    let cy = event?.clientY;
    if (cx === undefined || cy === undefined) {
      const rect = this.canvas.getBoundingClientRect();
      cx = rect.left + this.xOf(index);
      cy = rect.top + this.layout.top + 70;
    }
    this.callbacks.onInspect?.({
      index, pinned, clientX: cx, clientY: cy,
    });
  }

  _onPointerMove(e) {
    if (!this.layout) return;
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.pinch) {
      if (this.pointers.size >= 2) {
        this._updatePinch(e);
        return;
      }
      this._endPinch();
    }
    if (this.pointerStart && e.pointerType !== 'mouse') {
      const dx = e.clientX - this.pointerStart.x;
      const dy = e.clientY - this.pointerStart.y;
      if (!this.pointerStart.panning && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        this.pointerStart.panning = true;
        if (this.pinned === null && this.hover !== null) {
          this.hover = null;
          this.schedule();
          this.callbacks.onInspect?.(null);
        }
      }
      if (this.pointerStart.panning) {
        e.preventDefault();
        const step = this.layout.step;
        if (Number.isFinite(step) && step > 0) {
          const shift = -dx / step;
          const total = this.ds?.n || this.view.length;
          const maxStart = Math.max(0, total - this.view.length);
          const next = clamp(this.pointerStart.startStart + shift, 0, maxStart);
          if (Math.abs(next - this.view.start) > 1e-4) {
            this.callbacks.onPan?.({ start: next });
          }
        }
        return;
      }
      // Palec jest na wykresie, ale gest jeszcze nie przekroczył progu:
      // nie pokazujemy kart odczytu, żeby przy przeciąganiu nic nie mrugało.
      return;
    }
    const idx = this._eventIndex(e);
    if (idx === null) {
      if (this.pinned === null && this.hover !== null) {
        this.hover = null;
        this.schedule();
        this.callbacks.onInspect?.(null);
      }
      return;
    }
    if (this.pointerStart && e.pointerType === 'mouse') {
      const dx = e.clientX - this.pointerStart.x;
      const dy = e.clientY - this.pointerStart.y;
      if (!this.pointerStart.scrubbing && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        this.pointerStart.scrubbing = true;
      }
      if (this.pointerStart.scrubbing) {
        e.preventDefault();
        if (this.pinned !== null) return;
        this.hover = idx;
        this.schedule();
        this._notify(idx, false, e);
        return;
      }
    }
    if (this.pinned !== null) return;
    if (idx !== this.hover) {
      this.hover = idx;
      this.schedule();
    }
    this._notify(idx, false, e);
  }

  _onPointerDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.layout) {
      this._startPinch();
      if (this.pinch) return;
    }
    const idx = this._eventIndex(e);
    if (idx === null) return;
    this.pointerStart = {
      x: e.clientX,
      y: e.clientY,
      index: idx,
      scrubbing: false,
      panning: false,
      startStart: this.layout.start,
    };
    if (e.pointerType !== 'mouse') {
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  }

  /**
   * Start szczypania: zapamiętuje początkowy rozstaw palców i godzinę
   * pod ich środkiem, żeby zoom nie uciekał w bok.
   */
  _startPinch() {
    const pts = [...this.pointers.values()].slice(0, 2);
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (!Number.isFinite(dist) || dist < 12) return;
    const rect = this.canvas.getBoundingClientRect();
    const midX = (pts[0].x + pts[1].x) / 2;
    const { left, plotW, start, len } = this.layout;
    const frac = clamp((midX - rect.left - left) / plotW, 0, 1);
    this.pinch = {
      dist, left, plotW, frac, len,
      anchor: start + frac * (len - 1),
    };
    this.pointerStart = null;
    if (this.pinned === null) {
      this.hover = null;
      this.schedule();
      this.callbacks.onInspect?.(null);
    }
    this.canvas.style.touchAction = 'none';
  }

  _updatePinch(e) {
    e.preventDefault();
    const pts = [...this.pointers.values()].slice(0, 2);
    if (pts.length < 2) return;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const midX = (pts[0].x + pts[1].x) / 2;
    const rect = this.canvas.getBoundingClientRect();
    const total = this.ds?.n || this.pinch.len;
    if (!Number.isFinite(dist) || !Number.isFinite(midX) || !Number.isFinite(this.pinch.len)
      || !Number.isFinite(total) || this.pinch.plotW <= 0) {
      console.warn(`zoom: pominięty gest (dist=${dist}, len=${this.pinch.len}, plotW=${this.pinch.plotW}, n=${total})`);
      this._endPinch();
      return;
    }
    const frac = clamp((midX - rect.left - this.pinch.left) / this.pinch.plotW, 0, 1);
    const maxHours = Math.min(168, total);
    const minHours = Math.min(6, maxHours);
    const ratio = dist / Math.max(16, this.pinch.dist);
    const hours = clamp(Math.round(this.pinch.len / ratio), minHours, maxHours);
    const start = clamp(
      Math.round(this.pinch.anchor - frac * (hours - 1)),
      0,
      Math.max(0, total - hours),
    );
    if (!Number.isFinite(hours) || !Number.isFinite(start)) {
      console.warn(`zoom: niepoprawne wartości (hours=${hours}, start=${start}, anchor=${this.pinch.anchor}, frac=${frac})`);
      return;
    }
    if (hours !== this.view.length || start !== this.view.start) {
      this.callbacks.onZoom?.({ start, hours });
    }
  }

  _endPinch() {
    this.pinch = null;
    this.canvas.style.touchAction = '';
  }

  /**
   * Zoom kółkiem myszy z wciśniętym Ctrl: skaluje liczbę widocznych godzin
   * (6-168 h) tak, aby godzina pod kursorem została w tym samym miejscu.
   * Bazuje na this.view, więc szybkie kręcenie rolką kumuluje się płynnie,
   * bez czekania na przerysowanie.
   */
  _onWheel(e) {
    if (!e.ctrlKey || !this.layout || !this.ds) return;
    const { left, plotW } = this.layout;
    const len = this.view.length;
    const start = this.view.start;
    const total = this.ds?.n || len;
    if (!(plotW > 0) || !Number.isFinite(len) || !Number.isFinite(total) || total < 2) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left - left) / plotW, 0, 1);
    const anchor = start + frac * (len - 1);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
    const maxHours = Math.min(168, total);
    const minHours = Math.min(6, maxHours);
    const hours = clamp(Math.round(len * Math.exp(clamp(delta, -240, 240) * 0.0022)), minHours, maxHours);
    if (hours === len) return;
    const nextStart = clamp(Math.round(anchor - frac * (hours - 1)), 0, Math.max(0, total - hours));
    this.callbacks.onZoom?.({ start: nextStart, hours });
  }

  _onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this._endPinch();
    this.pointerStart = null;
  }

  _onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this._endPinch();
        this.pointerStart = null;
      }
      return;
    }
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start) return;
    if (start.panning) return;
    const idx = this._eventIndex(e);
    if (idx === null) return;
    if (start.scrubbing) {
      if (this.pinned === null) {
        this.hover = idx;
        this.schedule();
        this._notify(idx, false, e);
      }
      return;
    }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 10) return;
    this.togglePin(idx);
  }

  _onPointerLeave() {
    if (this.pinned === null && this.hover !== null) {
      this.hover = null;
      this.schedule();
      this.callbacks.onInspect?.(null);
    }
  }

  _onKeyDown(e) {
    if (!this.layout || !this.ds) return;
    const { start, len, nowIndex } = this.layout;
    let idx = this.getFocusedIndex();
    if (idx === null) idx = clamp(nowIndex, start, start + len - 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      idx = clamp(idx + (e.key === 'ArrowLeft' ? -1 : 1), start, start + len - 1);
      this.hover = idx;
      this.schedule();
      this._notify(idx, false, null);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      idx = e.key === 'Home' ? start : start + len - 1;
      this.hover = idx;
      this.schedule();
      this._notify(idx, false, null);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.togglePin(idx);
    } else if (e.key === 'Escape') {
      this.clearSelection();
    }
  }

  _theme() {
    return PALETTE[this.view.theme] || PALETTE.light;
  }

  xOf(index) {
    return this.layout.left + (index - this.layout.start) * this.layout.step;
  }

  render() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const width = Math.max(320, Math.round(wrap.clientWidth));
    if (width < 10) return;
    this.lastWidth = width;
    const compact = width < 700;
    const C = this._theme();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const visibleIds = BANDS.map((b) => b.id).filter((id) => this.view.visibleBands.includes(id));
    const bands = BANDS.filter((b) => visibleIds.includes(b.id)).map((b) => ({
      ...b,
      ...BAND_LAYOUT[b.id],
      h: compact ? BAND_LAYOUT[b.id].mh : BAND_LAYOUT[b.id].h,
    }));

    const left = compact ? 52 : 58;
    const right = compact ? 50 : 74;
    const top = compact ? 58 : 66;
    const bottom = 42;
    const plotW = Math.max(20, width - left - right);
    const heights = bands.reduce((s, b) => s + b.h, 0);
    const totalH = top + heights + bottom;

    this.canvas.style.height = `${totalH}px`;
    this.canvas.style.width = '100%';
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(totalH * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(totalH * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.base.width !== this.canvas.width || this.base.height !== this.canvas.height) {
      this.base.width = this.canvas.width;
      this.base.height = this.canvas.height;
    }
    this.bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const len = Math.max(2, Math.min(
      Number.isFinite(this.view.length) ? this.view.length : 60,
      this.ds && Number.isFinite(this.ds.n) ? this.ds.n : (Number.isFinite(this.view.length) ? this.view.length : 60),
    ));
    const maxStart = Math.max(0, (this.ds ? this.ds.n : len) - len);
    const start = clamp(this.view.start, 0, maxStart);
    const step = plotW / (len - 1);
    const plotBottom = top + heights;

    const rects = [];
    let y = top;
    for (const b of bands) {
      rects.push({ ...b, top: y, bottom: y + b.h, h: b.h });
      y += b.h;
    }

    this.layout = {
      width, height: totalH, dpr, compact, left, right, top, bottom,
      plotW, plotH: heights, plotBottom, step, start, len,
      bands: rects, nowIndex: this.view.nowIndex, C,
    };
    this.bandRects = Object.fromEntries(rects.map((r) => [r.id, r]));
    this.bandScales = {};

    const b = this.bctx;
    b.clearRect(0, 0, width, totalH);
    b.fillStyle = C.bg;
    b.fillRect(0, 0, width, totalH);
    b.fillStyle = C.plot;
    b.fillRect(left, top, plotW, heights);

    if (!this.ds) {
      b.fillStyle = C.muted;
      b.font = `500 ${compact ? 12 : 13}px ${FONT}`;
      b.textAlign = 'center';
      b.textBaseline = 'middle';
      b.fillText('Brak danych — wybierz miejscowość i spróbuj ponownie.', width / 2, top + Math.max(60, heights / 2));
      this.ctx.clearRect(0, 0, width, totalH);
      this.ctx.drawImage(this.base, 0, 0, width, totalH);
      return;
    }

    this._drawNight(b, C, start, len, step);
    this._drawSelection(b, C, start, len, step);
    this._drawVerticalGrid(b, C, start, len, step);

    for (const rect of rects) {
      b.save();
      const fn = this[`_band_${rect.id}`];
      if (fn) fn.call(this, b, rect, C, compact, start, len, step);
      b.restore();
    }

    if (this.ds) this._drawNow(b, C, start, len, step);

    this._drawTopAxis(b, C, start, len, step, compact);
    this._drawBottomAxis(b, C, start, len, step, compact);

    this.ctx.clearRect(0, 0, width, totalH);
    this.ctx.drawImage(this.base, 0, 0, width, totalH);
    this._drawOverlay(this.ctx, C, compact);
  }

  _indexForDay(dayKey) {
    if (!this.ds) return null;
    const entry = this.ds.dayMeta.get(dayKey);
    return entry || null;
  }

  _nightAt(i, C) {
    const d = this.ds;
    const t = d.times[i];
    const entry = d.dayMeta.get(dayKeyOf(t));
    if (!entry || entry.sunriseMin === null || entry.sunsetMin === null) return null;
    const minutes = t.h * 60 + t.mi;
    const isNight = minutes < entry.sunriseMin || minutes >= entry.sunsetMin;
    if (!isNight) return null;
    const nightIndex = minutes < entry.sunriseMin ? entry.index - 1 : entry.index;
    return { color: nightIndex % 2 === 0 ? C.night : C.nightAlt };
  }

  _drawNight(ctx, C, start, len, step) {
    if (!this.ds) return;
    const { left, top, plotBottom } = this.layout;
    for (let i = start; i < start + len; i += 1) {
      const n = this._nightAt(i, C);
      if (!n) continue;
      const x0 = Math.max(left, this.xOf(i) - step / 2);
      const x1 = Math.min(left + this.layout.plotW, this.xOf(i) + step / 2);
      ctx.fillStyle = n.color;
      ctx.fillRect(x0, top, Math.max(0.5, x1 - x0), plotBottom - top);
    }
  }

  _drawSelection(ctx, C, start, len, step) {
    if (!this.view.selectedDay || !this.ds) return;
    const entry = this.ds.dayMeta.get(this.view.selectedDay);
    if (!entry) return;
    const s = Math.max(start, entry.start);
    const e = Math.min(start + len - 1, entry.end);
    if (s > e) return;
    const { left, top, plotW, plotBottom } = this.layout;
    const x0 = entry.start < start ? left : this.xOf(entry.start) - step / 2;
    const x1 = entry.end > start + len - 1 ? left + plotW : this.xOf(entry.end) + step / 2;
    ctx.fillStyle = C.selected;
    ctx.fillRect(x0, top, Math.max(1, x1 - x0), plotBottom - top);
    ctx.strokeStyle = 'rgba(37,99,235,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(1, x1 - x0) - 1, plotBottom - top - 1);
  }

  _dayOfHour(i) {
    if (!this.ds) return null;
    return this.ds.dayMeta.get(dayKeyOf(this.ds.times[i]));
  }

  _drawVerticalGrid(ctx, C, start, len, step) {
    if (!this.ds) return;
    const { left, top, plotW, plotBottom } = this.layout;
    ctx.save();
    for (let i = start; i < start + len; i += 1) {
      const t = this.ds.times[i];
      const x = this.xOf(i);
      if (x < left - 0.5 || x > left + plotW + 0.5) continue;
      const midnight = t.h === 0;
      if (midnight) {
        ctx.strokeStyle = C.borderSoft;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, top);
        ctx.lineTo(Math.round(x) + 0.5, plotBottom);
        ctx.stroke();
      } else if (step >= 9 && t.h % 1 === 0) {
        ctx.strokeStyle = C.gridSoft;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, top);
        ctx.lineTo(Math.round(x) + 0.5, plotBottom);
        ctx.stroke();
      }
      if (t.h % 3 === 0 && step * 3 >= 22) {
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, top);
        ctx.lineTo(Math.round(x) + 0.5, plotBottom);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _activeSeries(varName) {
    if (!this.ds) return [];
    if (this.view.source === 'consensus' || this.view.source === 'compare') {
      return this.ds.consensus[varName]?.median || [];
    }
    return this.ds.models[this.view.source]?.[varName] || [];
  }

  _activeType() {
    if (!this.ds) return [];
    if (this.view.source === 'consensus' || this.view.source === 'compare') return this.ds.consensus.precip_type;
    return this.ds.models[this.view.source]?.precip_type || [];
  }

  _activeFog() {
    if (!this.ds) return [];
    if (this.view.source === 'consensus' || this.view.source === 'compare') return this.ds.consensus.fog_risk;
    return this.ds.models[this.view.source]?.fog_risk || [];
  }

  _drawBandFrame(ctx, rect, C, leftTitle, rightTitle, compact) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    ctx.moveTo(rect.top + 0.5, this.layout.left);
    ctx.lineTo(rect.top + 0.5, this.layout.left + this.layout.plotW);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = C.borderSoft;
    ctx.beginPath();
    ctx.moveTo(this.layout.left, rect.bottom + 0.5);
    ctx.lineTo(this.layout.left + this.layout.plotW, rect.bottom + 0.5);
    ctx.stroke();
    this._rotatedTitle(ctx, leftTitle, compact ? 9.5 : 10, 10, (rect.top + rect.bottom) / 2, C.text, rect.h);
    if (rightTitle) {
      this._rotatedTitle(ctx, rightTitle, compact ? 9.5 : 10, this.layout.width - 10, (rect.top + rect.bottom) / 2, C.text, rect.h);
    }
  }

  _rotatedTitle(ctx, text, size, x, cy, color, maxHeight = Infinity) {
    if (!text) return;
    const limit = Number.isFinite(maxHeight) ? Math.max(0, maxHeight - 6) : Infinity;
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let s = size;
    let label = text;
    ctx.font = `500 ${s}px ${FONT}`;
    while (ctx.measureText(label).width > limit && s > 7.5) {
      s -= 0.5;
      ctx.font = `500 ${s}px ${FONT}`;
    }
    if (ctx.measureText(label).width > limit) {
      while (label.length > 1 && ctx.measureText(`${label}…`).width > limit) {
        label = label.slice(0, -1);
      }
      label = `${label}…`;
    }
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  _ticks(ctx, ticks, yOf, x, align, color, size, formatter = (v) => fmt(v), limit = null) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    const top = (limit?.top ?? -Infinity) + 5;
    const bottom = (limit?.bottom ?? Infinity) - 5;
    const items = [];
    for (const tick of ticks) {
      const y = yOf(tick);
      if (!Number.isFinite(y)) continue;
      if (y < top - 7 || y > bottom + 7) continue;
      items.push({ tick, yy: Math.min(bottom, Math.max(top, y)) });
    }
    items.sort((a, b) => a.yy - b.yy);
    let last = -Infinity;
    for (const { tick, yy } of items) {
      if (yy - last < size + 1.5) continue;
      last = yy;
      ctx.fillText(formatter(tick), x, yy);
    }
    ctx.restore();
  }

  _hline(ctx, rect, y, color, dash = [1, 3]) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(this.layout.left, Math.round(y) + 0.5);
    ctx.lineTo(this.layout.left + this.layout.plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  _band_temp(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const temp = this._activeSeries('temperature_2m');
    const feels = this._activeSeries('apparent_temperature');
    const dew = this._activeSeries('dew_point_2m');
    const min = ds.consensus.temperature_2m.min;
    const max = ds.consensus.temperature_2m.max;
    const vals = [];
    for (let i = start; i <= i1; i += 1) {
      for (const s of [temp, feels, dew]) {
        const v = s[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
      }
      if (this.view.source === 'consensus' || this.view.source === 'compare') {
        if (min[i] !== null) vals.push(min[i]);
        if (max[i] !== null) vals.push(max[i]);
      }
    }
    let lo = Math.floor((Math.min(...vals, 0) - 1) / 5) * 5;
    let hi = Math.ceil((Math.max(...vals, 1) + 1) / 5) * 5;
    if (hi - lo < 10) hi = lo + 10;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-6; v += 5) ticks.push(v);
    const yOf = (v) => rect.bottom - ((v - lo) / (hi - lo)) * rect.h;
    const { left, plotW } = this.layout;

    if (lo < 0) {
      ctx.fillStyle = C.cold;
      ctx.fillRect(left, yOf(0), plotW, rect.bottom - yOf(0));
      this._hline(ctx, rect, yOf(0), C.grid, [3, 3]);
    }
    this._hline(ctx, rect, yOf(0), C.grid, [4, 4]);

    if (this.view.source === 'consensus' || this.view.source === 'compare') {
      fillBetweenV(ctx, max, min, start, i1, (i) => this.xOf(i), yOf, C.range);
    }

    if (this.view.source === 'compare') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      for (const m of MODELS) {
        strokeSeries(ctx, ds.models[m.id].temperature_2m, start, i1, (i) => this.xOf(i), yOf, m.color, 1);
      }
      ctx.restore();
    }

    strokeSeries(ctx, temp, start, i1, (i) => this.xOf(i), yOf, C.temp, compact ? 1.8 : 2.2);
    strokeSeries(ctx, feels, start, i1, (i) => this.xOf(i), yOf, C.feels, compact ? 1.3 : 1.6);
    strokeSeries(ctx, dew, start, i1, (i) => this.xOf(i), yOf, C.dew, compact ? 1.3 : 1.5, [4, 3]);

    this._drawBandFrame(ctx, rect, C, 'temperatura (°C)', '°C', compact);
    this._ticks(ctx, ticks, yOf, left - 6, 'right', C.text, compact ? 9.5 : 10, (v) => fmt(v, 0), rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.temp = { lo, hi, yOf, rect };
    this.bandScales.dew = { yOf, rect };
    this.bandScales.feels = { yOf, rect };
  }

  _band_precip(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const precip = this._activeSeries('precipitation');
    const hum = this._activeSeries('relative_humidity_2m');
    const types = this._activeType();
    let maxP = 0;
    for (let i = start; i <= i1; i += 1) {
      if (precip[i] !== null && precip[i] > maxP) maxP = precip[i];
    }
    const pMax = Math.max(2, Math.ceil(maxP * 1.25));
    const pStep = pMax <= 5 ? 1 : pMax <= 12 ? 2 : 5;
    const pTicks = [];
    for (let v = 0; v <= pMax + 1e-6; v += pStep) pTicks.push(v);
    const yP = (v) => rect.bottom - (v / pMax) * rect.h;

    let hMin = 100;
    for (let i = start; i <= i1; i += 1) {
      if (hum[i] !== null && hum[i] < hMin) hMin = hum[i];
    }
    const hLo = hMin >= 85 ? 70 : hMin >= 60 ? 40 : 0;
    const hTicks = [];
    for (let v = hLo; v <= 100 + 1e-6; v += 20) hTicks.push(v);
    const yH = (v) => rect.bottom - ((v - hLo) / (100 - hLo)) * rect.h;

    const barW = Math.max(1, step * 0.68);
    const colorFor = (type) => (type === 'snow' ? C.snow : type === 'sleet' ? C.sleet : C.rain);
    for (let i = start; i <= i1; i += 1) {
      const v = precip[i];
      if (v === null || v === undefined || v <= 0.02) continue;
      const x = this.xOf(i);
      const y = yP(v);
      ctx.fillStyle = colorFor(types[i] || 'rain');
      ctx.globalAlpha = 0.88;
      ctx.fillRect(x - barW / 2, y, barW, Math.max(1, rect.bottom - y));
      ctx.globalAlpha = 1;
      if (types[i] === 'snow') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let yy = y + 2; yy < rect.bottom; yy += 4) {
          ctx.moveTo(x - barW / 2 + 1, yy);
          ctx.lineTo(x + barW / 2 - 1, yy + 2);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    this._hline(ctx, rect, yH(hLo), C.grid, [1, 3]);
    strokeSeries(ctx, hum, start, i1, (i) => this.xOf(i), yH, C.humidity, compact ? 1.4 : 1.6);

    this._drawBandFrame(ctx, rect, C, 'opad (mm/h)', 'wilgotność (%)', compact);
    this._ticks(ctx, pTicks, yP, this.layout.left - 6, 'right', C.text, compact ? 9.5 : 10, (v) => fmt(v, 0), rect);
    this._ticks(ctx, hTicks, yH, this.layout.left + this.layout.plotW + 6, 'left', C.humidity, compact ? 9.5 : 10, (v) => fmt(v, 0), rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.precip = { yOf: yP, rect };
    this.bandScales.humidity = { yOf: yH, rect };
  }

  _band_prob(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const prob = this._activeSeries('precipitation_probability');
    const yOf = (v) => rect.bottom - (v / 100) * rect.h;
    const ticks = [0, 25, 50, 75, 100];

    for (const v of ticks) this._hline(ctx, rect, yOf(v), C.grid, [1, 3]);
    fillUnder(ctx, prob, start, i1, (i) => this.xOf(i), yOf, rect.bottom, C.probFill);
    strokeSeries(ctx, prob, start, i1, (i) => this.xOf(i), yOf, C.prob, compact ? 1.5 : 1.8);

    if (this.view.source === 'compare') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const m of MODELS) {
        strokeSeries(ctx, ds.models[m.id].precipitation_probability, start, i1, (i) => this.xOf(i), yOf, m.color, 1);
      }
      ctx.restore();
    }

    let any = false;
    for (let i = start; i <= i1; i += 1) if (prob[i] !== null) { any = true; break; }
    if (!any) {
      ctx.save();
      ctx.fillStyle = C.muted;
      ctx.font = `${compact ? 10 : 11}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('brak danych o prawdopodobieństwie opadu', this.layout.left + this.layout.plotW / 2, rect.top + rect.h / 2);
      ctx.restore();
    }

    this._drawBandFrame(ctx, rect, C, 'szansa opadu (%)', '%', compact);
    this._ticks(ctx, ticks, yOf, this.layout.left - 6, 'right', C.text, compact ? 9.5 : 10, (v) => fmt(v, 0), rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.prob = { yOf, rect };
  }

  _band_pressure(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const p = this._activeSeries('pressure_msl');
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i <= i1; i += 1) {
      if (p[i] !== null && p[i] !== undefined) {
        min = Math.min(min, p[i]);
        max = Math.max(max, p[i]);
      }
    }
    if (!Number.isFinite(min)) { min = 1013; max = 1020; }
    let pStep = 5;
    let lo = Math.floor((min - 2) / pStep) * pStep;
    let hi = Math.max(lo + 10, Math.ceil((max + 2) / pStep) * pStep);
    if ((hi - lo) / pStep > 6) {
      pStep = 10;
      lo = Math.floor((min - 2) / pStep) * pStep;
      hi = Math.max(lo + 20, Math.ceil((max + 2) / pStep) * pStep);
    }
    const ticks = [];
    for (let v = lo; v <= hi + 1e-6; v += pStep) ticks.push(v);
    const yOf = (v) => rect.bottom - ((v - lo) / (hi - lo)) * rect.h;
    const { left, plotW } = this.layout;

    const zones = [
      { from: -Infinity, to: 1000, color: C.zoneLow },
      { from: 1000, to: 1013, color: C.zoneMid },
      { from: 1013, to: 1025, color: C.zoneNorm },
      { from: 1025, to: Infinity, color: C.zoneHigh },
    ];
    for (const zone of zones) {
      const a = Math.max(lo, zone.from);
      const b = Math.min(hi, zone.to);
      if (b <= a) continue;
      const ya = yOf(b);
      const yb = yOf(a);
      ctx.fillStyle = zone.color;
      ctx.fillRect(left, ya, plotW, yb - ya);
    }

    for (const v of ticks) this._hline(ctx, rect, yOf(v), C.grid, [1, 3]);
    if (this.view.source === 'compare') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      for (const m of MODELS) {
        strokeSeries(ctx, ds.models[m.id].pressure_msl, start, i1, (i) => this.xOf(i), yOf, m.color, 1);
      }
      ctx.restore();
    }
    strokeSeries(ctx, p, start, i1, (i) => this.xOf(i), yOf, C.pressure, compact ? 1.8 : 2.2);

    const unit = this.view.units?.pressure || 'hpa';
    const toMm = (hpa) => hpa * 0.750062;
    const leftFmt = unit === 'mmhg' ? (v) => fmt(toMm(v), 0) : (v) => fmt(v, 0);
    const rightFmt = unit === 'mmhg' ? (v) => fmt(v, 0) : (v) => fmt(toMm(v), 0);
    const leftTitle = unit === 'mmhg' ? 'ciśnienie (mm Hg)' : 'ciśnienie (hPa)';
    const rightTitle = unit === 'mmhg' ? 'hPa' : 'mm Hg';
    this._drawBandFrame(ctx, rect, C, leftTitle, rightTitle, compact);
    this._ticks(ctx, ticks, yOf, left - 6, 'right', C.text, compact ? 9.5 : 10, leftFmt, rect);
    this._ticks(ctx, ticks, yOf, left + plotW + 6, 'left', C.muted, compact ? 9.5 : 10, rightFmt, rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.pressure = { yOf, rect };
  }

  _band_wind(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const wind = this._activeSeries('wind_speed_10m');
    const gust = this._activeSeries('wind_gusts_10m');
    let max = 0;
    for (let i = start; i <= i1; i += 1) {
      if (wind[i] !== null) max = Math.max(max, wind[i]);
      if (gust[i] !== null) max = Math.max(max, gust[i]);
    }
    const hi = Math.max(10, Math.ceil(max / 5) * 5);
    const yOf = (v) => rect.bottom - (v / hi) * rect.h;
    const { left, plotW } = this.layout;

    const grad = ctx.createLinearGradient(0, rect.bottom, 0, rect.top);
    grad.addColorStop(0, 'rgba(34,197,94,0.32)');
    grad.addColorStop(0.45, 'rgba(59,130,246,0.34)');
    grad.addColorStop(0.75, 'rgba(124,58,237,0.34)');
    grad.addColorStop(1, 'rgba(220,38,38,0.30)');
    fillUnder(ctx, wind, start, i1, (i) => this.xOf(i), yOf, rect.bottom, grad);

    for (const level of [5, 10, 15]) {
      if (level > hi) continue;
      this._hline(ctx, rect, yOf(level), C.grid, [2, 4]);
    }

    if (this.view.source === 'compare') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const m of MODELS) {
        strokeSeries(ctx, ds.models[m.id].wind_speed_10m, start, i1, (i) => this.xOf(i), yOf, m.color, 1);
      }
      ctx.restore();
    }

    strokeSeries(ctx, wind, start, i1, (i) => this.xOf(i), yOf, C.wind, compact ? 1.6 : 2);
    for (let i = start; i <= i1; i += 1) {
      const g = gust[i];
      if (g === null || g === undefined) continue;
      const x = this.xOf(i);
      const y = yOf(g);
      ctx.fillStyle = C.gust;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, compact ? 1.6 : 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const unit = this.view.units?.wind || 'ms';
    const dispMax = unit === 'kmh' ? hi * 3.6 : hi;
    const stepDisp = unit === 'kmh' ? (dispMax <= 40 ? 10 : 20) : 5;
    const dTicks = [];
    for (let v = 0; v <= dispMax + 1e-6; v += stepDisp) dTicks.push(v);
    const toMs = (v) => (unit === 'kmh' ? v / 3.6 : v);
    const leftFmt = (ms) => fmt(unit === 'kmh' ? ms * 3.6 : ms, 0);
    const rightFmt = (ms) => fmt(unit === 'kmh' ? ms : ms * 3.6, 0);
    const leftTitle = unit === 'kmh' ? 'wiatr (km/h)' : 'wiatr (m/s)';
    const rightTitle = unit === 'kmh' ? 'm/s' : 'km/h';

    this._drawBandFrame(ctx, rect, C, leftTitle, rightTitle, compact);
    this._ticks(ctx, dTicks.map(toMs), yOf, left - 6, 'right', C.text, compact ? 9.5 : 10, leftFmt, rect);
    this._ticks(ctx, dTicks.map(toMs), yOf, left + plotW + 6, 'left', C.muted, compact ? 9.5 : 10, rightFmt, rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.wind = { yOf, rect };
    this.bandScales.gust = { yOf, rect };
  }

  _drawArrow(ctx, x, y, fromDeg, size, color) {
    const toRad = ((fromDeg + 180) * Math.PI) / 180;
    const dx = Math.sin(toRad);
    const dy = -Math.cos(toRad);
    const x0 = x - dx * size * 0.75;
    const y0 = y - dy * size * 0.75;
    const x1 = x + dx * size * 0.85;
    const y1 = y + dy * size * 0.85;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(angle - 0.45) * size * 0.55, y1 - Math.sin(angle - 0.45) * size * 0.55);
    ctx.lineTo(x1 - Math.cos(angle + 0.45) * size * 0.55, y1 - Math.sin(angle + 0.45) * size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _band_dir(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const dirs = this._activeSeries('wind_direction_10m');
    const i1 = start + len - 1;
    const cy = rect.top + rect.h / 2;
    const { left, plotW } = this.layout;

    this._hline(ctx, rect, cy, C.grid, [1, 4]);

    const every = step >= 13 ? 1 : step >= 7 ? 2 : 3;
    for (let i = start; i <= i1; i += every) {
      const deg = dirs[i];
      if (deg === null || deg === undefined) continue;
      const x = this.xOf(i);
      if (x < left - 4 || x > left + plotW + 4) continue;
      this._drawArrow(ctx, x, cy, deg, clamp(step * 0.55, 4.5, 8), C.arrow);
    }

    const size = compact ? 8 : 9;
    ctx.save();
    ctx.fillStyle = C.muted;
    ctx.font = `600 ${size}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', left - 7, rect.top + 12);
    ctx.fillText('W', left - 7, rect.top + rect.h * 0.38);
    ctx.fillText('E', left - 7, rect.top + rect.h * 0.64);
    ctx.fillText('S', left - 7, rect.bottom - 10);
    ctx.textAlign = 'left';
    const rx = left + plotW + 7;
    ctx.fillText('N', rx, rect.top + 12);
    ctx.fillText('W', rx, rect.top + rect.h * 0.38);
    ctx.fillText('E', rx, rect.top + rect.h * 0.64);
    ctx.fillText('S', rx, rect.bottom - 10);
    ctx.restore();

    this._drawBandFrame(ctx, rect, C, compact ? 'kier. wiatru' : 'kierunek wiatru', '', compact);
    this.bandScales = this.bandScales || {};
    this.bandScales.dir = { center: cy, rect };
  }

  _cloudY(rect, km) {
    const points = [
      { km: 0, frac: 0 },
      { km: 0.5, frac: 0.22 },
      { km: 2, frac: 0.45 },
      { km: 7, frac: 0.72 },
      { km: 15, frac: 1 },
    ];
    const v = clamp(km, 0, 15);
    for (let i = 1; i < points.length; i += 1) {
      if (v <= points[i].km) {
        const a = points[i - 1];
        const b = points[i];
        const f = (v - a.km) / (b.km - a.km);
        return rect.bottom - (a.frac + f * (b.frac - a.frac)) * rect.h;
      }
    }
    return rect.top;
  }

  _band_clouds(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const visKm = this._activeSeries('visibility').map((v) => (v === null ? null : v / 1000));

    for (const km of [0.5, 2, 7]) this._hline(ctx, rect, this._cloudY(rect, km), C.grid, [1, 3]);

    const layers = [
      { key: 'cloud_cover_low', from: 0.5, to: 2, color: C.cloudLow },
      { key: 'cloud_cover_mid', from: 2, to: 7, color: C.cloudMid },
      { key: 'cloud_cover_high', from: 7, to: 15, color: C.cloudHigh },
    ];
    const colW = Math.max(1, step * 0.94);
    for (const layer of layers) {
      const arr = this._activeSeries(layer.key);
      const yTop = this._cloudY(rect, layer.to);
      const yBot = this._cloudY(rect, layer.from);
      for (let i = start; i <= i1; i += 1) {
        const pct = arr[i];
        if (pct === null || pct === undefined || pct <= 2) continue;
        ctx.fillStyle = `${layer.color}${(0.62 * (pct / 100)).toFixed(3)})`;
        ctx.fillRect(this.xOf(i) - colW / 2, yTop, colW, yBot - yTop);
      }
    }

    const vLo = 0.1;
    const vHi = 100;
    const yVis = (km) => {
      const v = clamp(km, vLo, vHi);
      const f = (Math.log10(v) - Math.log10(vLo)) / (Math.log10(vHi) - Math.log10(vLo));
      return rect.bottom - f * rect.h;
    };
    const vTicks = compact ? [0.1, 1, 10, 100] : [0.1, 0.5, 1, 5, 10, 50, 100];
    for (const v of vTicks) this._hline(ctx, rect, yVis(v), C.grid, [1, 4]);

    if (this.view.source === 'compare') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const m of MODELS) {
        const arr = ds.models[m.id].visibility.map((v) => (v === null ? null : v / 1000));
        strokeSeries(ctx, arr, start, i1, (i) => this.xOf(i), yVis, m.color, 1);
      }
      ctx.restore();
    }
    strokeSeries(ctx, visKm, start, i1, (i) => this.xOf(i), yVis, C.vis, compact ? 1.6 : 2);

    this._drawBandFrame(ctx, rect, C, 'chmury (km)', 'widzialność (km)', compact);
    this._ticks(ctx, [0, 0.5, 2, 7, 15], (v) => this._cloudY(rect, v), this.layout.left - 6, 'right', C.text, compact ? 9.5 : 10, (v) => fmt(v, v === 0.5 ? 1 : 0), rect);
    this._ticks(ctx, vTicks, yVis, this.layout.left + this.layout.plotW + 6, 'left', C.vis, compact ? 9.5 : 10, (v) => fmt(v, v < 1 ? 1 : 0), rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.vis = { yOf: yVis, rect };
    this.bandScales.cloud = { yOf: (km) => this._cloudY(rect, km), rect };
  }

  _band_cover(ctx, rect, C, compact, start, len, step) {
    if (!this.ds) return;
    const ds = this.ds;
    const i1 = start + len - 1;
    const cover = this._activeSeries('cloud_cover');
    const oct = cover.map((v) => (v === null ? null : clamp(Math.round((v / 100) * 8), 0, 8)));
    const fog = this._activeFog();
    const rad = this._activeSeries('shortwave_radiation');
    const { left, plotW } = this.layout;

    let maxRad = 0;
    for (let i = start; i <= i1; i += 1) {
      if (rad[i] !== null && rad[i] > maxRad) maxRad = rad[i];
    }
    maxRad = Math.max(200, maxRad);

    const yOct = (v) => rect.bottom - (v / 8) * rect.h;
    const yFog = (v) => rect.bottom - (v / 1) * rect.h * 0.42;
    const radBarW = Math.max(1, step * 0.5);

    fillUnder(ctx, oct, start, i1, (i) => this.xOf(i), yOct, rect.bottom, C.cover);
    strokeSeries(ctx, oct, start, i1, (i) => this.xOf(i), yOct, C.text, 1.1);

    for (let i = start; i <= i1; i += 1) {
      const v = rad[i];
      if (v === null || v === undefined || v <= 0) continue;
      const x = this.xOf(i);
      const h = (v / maxRad) * rect.h * 0.82;
      ctx.fillStyle = 'rgba(245,158,11,0.55)';
      ctx.fillRect(x - radBarW / 2, rect.bottom - h, radBarW, h);
    }

    fillUnder(ctx, fog.map((v) => v / 2), start, i1, (i) => this.xOf(i), yFog, rect.bottom, C.fog);
    strokeSeries(ctx, fog.map((v) => v / 2), start, i1, (i) => this.xOf(i), yFog, C.muted, 1, [3, 3]);

    if (this.view.source === 'compare') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (const m of MODELS) {
        const arr = ds.models[m.id].cloud_cover.map((v) => (v === null ? null : (v / 100) * 8));
        strokeSeries(ctx, arr, start, i1, (i) => this.xOf(i), yOct, m.color, 1);
      }
      ctx.restore();
    }

    for (const v of [0, 2, 4, 6, 8]) this._hline(ctx, rect, yOct(v), C.grid, [1, 3]);

    this._drawBandFrame(ctx, rect, C, 'zachmurzenie (okt.)', 'mgła (0–1)', compact);
    this._ticks(ctx, [0, 2, 4, 6, 8], yOct, left - 6, 'right', C.text, compact ? 9.5 : 10, (v) => fmt(v, 0), rect);
    this._ticks(ctx, [0, 0.5, 1], yFog, left + plotW + 6, 'left', C.muted, compact ? 9.5 : 10, (v) => fmt(v, v % 1 === 0 ? 0 : 1), rect);
    this.bandScales = this.bandScales || {};
    this.bandScales.cover = { yOf: yOct, rect };
    this.bandScales.fog = { yOf: yFog, rect };
  }

  _drawNow(ctx, C, start, len, step) {
    const idx = this.layout.nowIndex;
    if (idx === null || idx < start || idx > start + len - 1) return;
    const x = this.xOf(idx);
    const { top, plotBottom } = this.layout;
    ctx.save();
    ctx.strokeStyle = C.now;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const label = 'Teraz';
    ctx.font = `600 9px ${FONT}`;
    const tw = ctx.measureText(label).width + 10;
    let bx = x - tw / 2;
    if (bx < this.layout.left) bx = this.layout.left;
    if (bx + tw > this.layout.left + this.layout.plotW) bx = this.layout.left + this.layout.plotW - tw;
    roundRect(ctx, bx, 3, tw, 14, 7);
    ctx.fillStyle = C.now;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + tw / 2, 10.5);
    ctx.restore();
  }

  _tickStep(step) {
    for (const candidate of [3, 6, 12, 24]) {
      if (candidate * step >= 16.5) return candidate;
    }
    return 24;
  }

  _drawTopAxis(ctx, C, start, len, step, compact) {
    if (!this.ds) return;
    const { left, plotW } = this.layout;
    const tickStep = this._tickStep(step);
    const dayY = 22;
    const dayH = 19;
    const seen = new Set();
    for (let i = start; i < start + len; i += 1) {
      const entry = this._dayOfHour(i);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      const s = Math.max(start, entry.start);
      const e = Math.min(start + len - 1, entry.end);
      if (s > e) continue;
      const x0 = entry.start < start ? left : this.xOf(entry.start) - step / 2;
      const x1 = entry.end > start + len - 1 ? left + plotW : this.xOf(entry.end) + step / 2;
      const w = Math.max(0, x1 - x0);
      if (w < 2) continue;
      ctx.fillStyle = entry.index % 2 === 0 ? C.dayCell : C.dayCellAlt;
      roundRect(ctx, x0 + 0.5, dayY, Math.max(0, w - 1), dayH, 3);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 2, dayY, Math.max(0, w - 4), dayH);
      ctx.clip();
      ctx.fillStyle = C.dayText;
      ctx.font = `600 ${compact ? 10 : 11}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let label = dayLabel(entry.t, false);
      if (w < 92) label = `${entry.t.d}.${String(entry.t.mo).padStart(2, '0')}`;
      if (w < 48) label = String(entry.t.d);
      ctx.fillText(label, x0 + 6, dayY + dayH / 2 + 0.5);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = C.muted;
    ctx.font = `${compact ? 9.5 : 10}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = start; i < start + len; i += 1) {
      const t = this.ds.times[i];
      if (t.h % tickStep !== 0) continue;
      const x = this.xOf(i);
      if (x < left - 1 || x > left + plotW + 1) continue;
      ctx.fillText(`${String(t.h).padStart(2, '0')}`, x, this.layout.top - 8);
    }
    ctx.restore();

    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, this.layout.top + 0.5);
    ctx.lineTo(left + plotW, this.layout.top + 0.5);
    ctx.stroke();
  }

  _drawBottomAxis(ctx, C, start, len, step, compact) {
    if (!this.ds) return;
    const { left, plotW, plotBottom } = this.layout;
    const tickStep = this._tickStep(step);
    ctx.save();
    ctx.fillStyle = C.muted;
    ctx.font = `${compact ? 9.5 : 10}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = start; i < start + len; i += 1) {
      const t = this.ds.times[i];
      if (t.h % tickStep !== 0) continue;
      const x = this.xOf(i);
      if (x < left - 1 || x > left + plotW + 1) continue;
      ctx.fillText(`${String(t.h).padStart(2, '0')}`, x, plotBottom + 14);
    }
    ctx.restore();

    const seen = new Set();
    for (let i = start; i < start + len; i += 1) {
      const entry = this._dayOfHour(i);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      const s = Math.max(start, entry.start);
      const e = Math.min(start + len - 1, entry.end);
      if (s > e) continue;
      const x0 = entry.start < start ? left : this.xOf(entry.start) - step / 2;
      const x1 = entry.end > start + len - 1 ? left + plotW : this.xOf(entry.end) + step / 2;
      const avail = Math.max(0, x1 - x0);
      ctx.save();
      ctx.fillStyle = C.dayText;
      ctx.font = `600 ${compact ? 9.5 : 10}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fullLabel = dayLabel(entry.t, false);
      const dateLabel = `${entry.t.d}.${String(entry.t.mo).padStart(2, '0')}`;
      const dayOnly = String(entry.t.d);
      const fits = (text) => ctx.measureText(text).width + 8 <= avail;
      const label = fits(fullLabel) ? fullLabel : fits(dateLabel) ? dateLabel : fits(dayOnly) ? dayOnly : '';
      if (label) {
        ctx.beginPath();
        ctx.rect(x0, plotBottom + 22, avail, 16);
        ctx.clip();
        ctx.fillText(label, (x0 + x1) / 2, plotBottom + 30);
      }
      ctx.restore();
    }
  }

  _drawOverlay(ctx, C, compact) {
    if (!this.ds || !this.layout) return;
    const idx = this.pinned ?? this.hover;
    if (idx === null || idx === undefined) return;
    const { start, len, top, plotBottom } = this.layout;
    if (idx < start || idx > start + len - 1) return;
    const x = this.xOf(idx);
    const pinned = this.pinned !== null;

    ctx.save();
    ctx.strokeStyle = pinned ? C.pin : C.crosshair;
    ctx.globalAlpha = pinned ? 0.9 : 0.55;
    ctx.lineWidth = 1.2;
    ctx.setLineDash(pinned ? [5, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (pinned) {
      ctx.fillStyle = C.pin;
      ctx.beginPath();
      ctx.moveTo(x - 4, top);
      ctx.lineTo(x + 4, top);
      ctx.lineTo(x, top + 6);
      ctx.closePath();
      ctx.fill();
    }

    const dots = [];
    const bsc = this.bandScales || {};
    if (bsc.temp) {
      const v = this._activeSeries('temperature_2m')[idx];
      if (v !== null) dots.push([bsc.temp.yOf(v), C.temp]);
      const f = this._activeSeries('apparent_temperature')[idx];
      if (f !== null) dots.push([bsc.temp.yOf(f), C.feels]);
      const d = this._activeSeries('dew_point_2m')[idx];
      if (d !== null) dots.push([bsc.temp.yOf(d), C.dew]);
    }
    if (bsc.precip) {
      const v = this._activeSeries('precipitation')[idx];
      if (v !== null && v > 0) dots.push([bsc.precip.yOf(v), C.rain]);
    }
    if (bsc.humidity) {
      const v = this._activeSeries('relative_humidity_2m')[idx];
      if (v !== null) dots.push([bsc.humidity.yOf(v), C.humidity]);
    }
    if (bsc.prob) {
      const v = this._activeSeries('precipitation_probability')[idx];
      if (v !== null) dots.push([bsc.prob.yOf(v), C.prob]);
    }
    if (bsc.pressure) {
      const v = this._activeSeries('pressure_msl')[idx];
      if (v !== null) dots.push([bsc.pressure.yOf(v), C.pressure]);
    }
    if (bsc.wind) {
      const v = this._activeSeries('wind_speed_10m')[idx];
      if (v !== null) dots.push([bsc.wind.yOf(v), C.wind]);
      const g = this._activeSeries('wind_gusts_10m')[idx];
      if (g !== null) dots.push([bsc.wind.yOf(g), C.gust]);
    }
    if (bsc.vis) {
      const v = this._activeSeries('visibility')[idx];
      if (v !== null) dots.push([bsc.vis.yOf(v / 1000), C.vis]);
    }
    if (bsc.cover) {
      const v = this._activeSeries('cloud_cover')[idx];
      if (v !== null) dots.push([bsc.cover.yOf(v / 12.5), C.text]);
    }
    if (bsc.fog) {
      const v = this._activeFog()[idx];
      if (v !== null && v !== undefined) dots.push([bsc.fog.yOf(v / 2), C.muted]);
    }

    for (const [y, color] of dots) {
      if (!Number.isFinite(y)) continue;
      ctx.beginPath();
      ctx.arc(x, y, compact ? 3 : 3.4, 0, Math.PI * 2);
      ctx.fillStyle = C.dotHalo;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  }
}
