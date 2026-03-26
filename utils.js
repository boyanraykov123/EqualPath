'use strict';
/* ═══════════════════════════════════════════════════════════
   utils.js — EqualPath
   Помощни функции: DOM, escaping, toast нотификации, debounce
   ═══════════════════════════════════════════════════════════ */

function gi(id) { return document.getElementById(id); }

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

/* ── Debounce ────────────────────────────────────────────── */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
