/* ═══════════════════════════════════════════════════════════
   constants.js — EqualPath
   Конфигурация, Supabase клиент, профилни тежести, метаданни
   ═══════════════════════════════════════════════════════════ */

const SOFIA    = [42.6977, 23.3219];
const NOM      = 'https://nominatim.openstreetmap.org';
const API_BASE = 'http://localhost:5000'; // Flask backend

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
  visual:     '🦯 Зрителни затруднения',
  elderly:    '🧓 Бавна походка',
  general:    '🚶 Общ пешеходен',
};

const PICONS = {
  wheelchair: '♿', autism: '🧠', stroller: '👶',
  visual: '🦯', elderly: '🧓', general: '🚶',
};

/* ── Автоматични филтри по профил ─────────────────────────── */
const PFILTERS = {
  wheelchair: { 'filter-no-stairs': true,  'filter-no-cobble': true,  'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
  autism:     { 'filter-no-stairs': false, 'filter-no-cobble': false, 'filter-quiet': true,  'filter-no-crowds': true,  'filter-shade': true  },
  stroller:   { 'filter-no-stairs': true,  'filter-no-cobble': true,  'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
  visual:     { 'filter-no-stairs': true,  'filter-no-cobble': false, 'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
  elderly:    { 'filter-no-stairs': true,  'filter-no-cobble': true,  'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': true  },
  general:    { 'filter-no-stairs': false, 'filter-no-cobble': false, 'filter-quiet': false, 'filter-no-crowds': false, 'filter-shade': false },
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
