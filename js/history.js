/* ═══════════════════════════════════════════════════════════
   history.js — EqualPath
   User dropdown меню
   ═══════════════════════════════════════════════════════════ */

/* ── User chip → dropdown toggle ─────────────────────────── */
gi('user-chip').addEventListener('click', e => {
  e.stopPropagation();
  const m = gi('user-menu');
  m.style.display = (m.style.display === 'block') ? 'none' : 'block';
});

document.addEventListener('click', e => {
  const m = gi('user-menu');
  if (m && !gi('user-chip').contains(e.target) && !m.contains(e.target)) m.style.display = 'none';
});
