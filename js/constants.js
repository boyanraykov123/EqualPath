/* ═══════════════════════════════════════════════════════════
   constants.js — EqualPath
   Конфигурация, Supabase клиент, профилни тежести, метаданни
   ═══════════════════════════════════════════════════════════ */

const SOFIA    = [42.6977, 23.3219];
const NOM      = 'https://nominatim.openstreetmap.org';
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : '';

/* ── Supabase client ──────────────────────────────────────── */
const SUPABASE_URL = 'https://hclbceguhpomazrjvkkh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbGJjZWd1aHBvbWF6cmp2a2toIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0Njk5NTQsImV4cCI6MjA5MDA0NTk1NH0.LA3_31q0Q67hRNGxKdL8Vdyzsw8pjkOqdm15MltyLek';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── Comfort weights по профил ────────────────────────────── */
const CW = {
  wheelchair: { noStairs: 10, noCobble: 8, quiet: 3, shade: 2 },
  autism:     { noStairs: 3,  noCobble: 4, quiet: 10, shade: 5 },
  stroller:   { noStairs: 9,  noCobble: 9, quiet: 2,  shade: 2 },
  visual:     { noStairs: 6,  noCobble: 5, quiet: 4,  shade: 3 },
  elderly:    { noStairs: 8,  noCobble: 7, quiet: 4,  shade: 4 },
  general:    { noStairs: 2,  noCobble: 2, quiet: 3,  shade: 3 },
};

/* ── Профилни етикети и икони ─────────────────────────────── */
const PLABELS = {
  wheelchair: '♿ Инвалидна количка',
  autism:     '🧠 Аутизъм/Сензорно',
  stroller:   '👶 Детска количка',
  general:    '🚶 Общ пешеходен',
};

const PICONS = {
  wheelchair: '♿', autism: '🧠', stroller: '👶', general: '🚶',
};

/* ── Цветове на маршрута по профил ─────────────────────────── */
const PCOLORS = {
  wheelchair: '#059669',
  autism:     '#6366f1',
  stroller:   '#d97706',
  general:    '#1e9e75',
};

/* ── Кои метрики са най-важни за всеки профил (за UI) ────── */
const PMETRICS = {
  wheelchair: [
    { key: 'stairs_segments',  icon: '🚫', label: 'Стълби',   bad: v => v > 0 },
    { key: 'cobble_segments',  icon: '🧱', label: 'Павета',   bad: v => v > 0 },
    { key: 'smooth_surface',   icon: '✅', label: 'Гладък път', bad: v => v === 0, invert: true },
  ],
  autism: [
    { key: 'busy_roads_nearby', icon: '🔇', label: 'Шумни улици', bad: v => v > 2 },
    { key: 'parks_nearby',      icon: '🌿', label: 'Паркове',      bad: v => v === 0, invert: true },
    { key: 'significant_turns', icon: '🔄', label: 'Завои',        bad: v => v > 5 },
  ],
  stroller: [
    { key: 'stairs_segments',  icon: '🚫', label: 'Стълби',   bad: v => v > 0 },
    { key: 'cobble_segments',  icon: '🧱', label: 'Павета',   bad: v => v > 0 },
    { key: 'smooth_surface',   icon: '✅', label: 'Гладък път', bad: v => v === 0, invert: true },
  ],
  visual: [
    { key: 'tactile_paving',   icon: '⬛', label: 'Тактилна настилка', bad: v => v === 0, invert: true },
    { key: 'safe_crossings',   icon: '🚦', label: 'Светофари',         bad: v => v === 0, invert: true },
    { key: 'unlit_segments',   icon: '💡', label: 'Тъмни участъци',    bad: v => v > 0 },
  ],
  elderly: [
    { key: 'steep_segments',   icon: '⛰️', label: 'Стръмни',   bad: v => v > 0 },
    { key: 'benches_nearby',   icon: '🪑', label: 'Пейки',     bad: v => v === 0, invert: true },
    { key: 'parks_nearby',     icon: '🌿', label: 'Паркове',   bad: v => v === 0, invert: true },
  ],
  general: [
    { key: 'stairs_segments',  icon: '🚫', label: 'Стълби',    bad: v => v > 0 },
    { key: 'unlit_segments',   icon: '💡', label: 'Тъмни',     bad: v => v > 0 },
    { key: 'footway_segments', icon: '🚶', label: 'Пешеходни', bad: v => v === 0, invert: true },
  ],
};

/* ── Mapping нужди ↔ sidebar филтри ─────────────────────────── */
const NEEDS_FILTER = {
  'no-stairs': 'filter-no-stairs',
  'quiet':     'filter-quiet',
  'smooth':    'filter-smooth',
  'no-crowds': 'filter-no-crowds',
  'shade':     'filter-shade',
  'benches':   'filter-benches',
  'toilets':   'filter-toilets',
  'wide':      'filter-wide',
};

/* ── Автоматични филтри по профил ─────────────────────────── */
const PFILTERS = {
  wheelchair: { 'filter-no-stairs': true,  'filter-smooth': true,  'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
  autism:     { 'filter-no-stairs': false, 'filter-smooth': false, 'filter-quiet': true,  'filter-no-crowds': true,  'filter-shade': true  },
  stroller:   { 'filter-no-stairs': true,  'filter-smooth': true,  'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
  general:    { 'filter-no-stairs': false, 'filter-smooth': false, 'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
};

/* ── Метаданни за препятствия ─────────────────────────────── */
const OMETA = {
  'car-on-ramp':     { emoji: '🚗', label: 'Спряла кола на рампа' },
  'construction':    { emoji: '🚧', label: 'Строителни работи' },
  'broken-pavement': { emoji: '🧱', label: 'Счупен тротоар' },
  'crowd':           { emoji: '👥', label: 'Голямо струпване' },
  'missing-ramp':    { emoji: '♿', label: 'Липсваща рампа' },
  'puddle':          { emoji: '💧', label: 'Локва / наводнение' },
  'other':           { emoji: '❓', label: 'Друго' },
};

/* ── Глобално състояние ───────────────────────────────────── */
const S = { from: null, to: null, pickMode: null, routePoly: null, pendingObs: null, user: null };
