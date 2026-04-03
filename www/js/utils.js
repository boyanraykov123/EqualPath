'use strict';
/* ═══════════════════════════════════════════════════════════
   utils.js — EqualPath
   Помощни функции: DOM, escaping, toast нотификации, debounce
   ═══════════════════════════════════════════════════════════ */

function gi(id) { return document.getElementById(id); }

/* ── Theme toggle (dark / light) ──────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('eq-theme', theme);
  const sun  = document.getElementById('theme-icon-sun');
  const moon = document.getElementById('theme-icon-moon');
  if (sun && moon) {
    sun.style.display  = theme === 'dark' ? 'none' : 'block';
    moon.style.display = theme === 'dark' ? 'block' : 'none';
  }
}

(function initTheme() {
  const stored = localStorage.getItem('eq-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
  // Attach click handler directly — DOM is ready since script is at end of body
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', function() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
})();

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shwE(id, msg) {
  const el = gi(id);
  if (el) { el.textContent = msg; el.classList.add('vis'); }
}

function clrE(id) {
  const el = gi(id);
  if (el) { el.textContent = ''; el.classList.remove('vis'); }
}

/* ── Toast нотификация ───────────────────────────────────── */
let toastT = null;
function toast(msg, dur = 3500) {
  let t = gi('eq-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'eq-toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  clearTimeout(toastT);
  t.textContent = msg;
  t.style.opacity = '0';
  t.style.transform = 'translateX(-50%) translateY(20px)';
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  toastT = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(10px)';
  }, dur);
}

/* ── Sync нужди ↔ sidebar филтри ─────────────────────────── */
function applyNeedsToFilters(needs) {
  Object.entries(NEEDS_FILTER).forEach(([need, filterId]) => {
    const el = gi(filterId);
    if (el) el.checked = (needs || []).includes(need);
  });
}

function getFiltersAsNeeds() {
  const needs = [];
  Object.entries(NEEDS_FILTER).forEach(([need, filterId]) => {
    const el = gi(filterId);
    if (el && el.checked) needs.push(need);
  });
  return needs;
}

/* ── Debounce ────────────────────────────────────────────── */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
