/* ═══════════════════════════════════════════════════════════
   history.js — EqualPath
   История на търсенията + user dropdown меню
   ═══════════════════════════════════════════════════════════ */

async function loadHistory(userId) {
  const list = gi('history-list');
  list.innerHTML = '<div style="font-size:.72rem;color:var(--ink-muted);padding:.25rem 0">Зарежда...</div>';

  try {
    const resp = await fetch(`${API_BASE}/api/routes/${userId}`, { signal: AbortSignal.timeout(5000) });
    const json = await resp.json();

    if (!json.ok || !json.routes.length) {
      list.innerHTML = '<div style="font-size:.75rem;color:var(--ink-muted);padding:.25rem 0">Няма търсения.</div>';
      return;
    }

    list.innerHTML = '';
    const routes = json.routes.slice(0, 10); // последните 10

    for (const rt of routes) {
      const div = document.createElement('div');
      div.className = 'history-item';
      const startName = rt.start_location.length > 20 ? rt.start_location.substring(0, 20) + '...' : rt.start_location;
      const endName   = rt.end_location.length > 20   ? rt.end_location.substring(0, 20) + '...'   : rt.end_location;
      const date = new Date(rt.created_at).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      div.innerHTML = `<span class="hi-icon">🧭</span><div class="hi-text"><div class="hi-route" title="${esc(rt.start_location)} → ${esc(rt.end_location)}">${esc(startName)} → ${esc(endName)}</div><div class="hi-meta">${rt.distance_km} км · ${rt.duration_min} мин · CI ${rt.safety_score} · ${date}</div></div>`;
      div.addEventListener('click', () => {
        gi('input-from').value = rt.start_location;
        gi('input-to').value = rt.end_location;
        gi('user-menu').style.display = 'none';
        toast('Маршрутът е зареден от историята. Натисни "Намери маршрут".');
      });
      list.appendChild(div);
    }
  } catch (err) {
    console.warn('History load failed:', err);
    list.innerHTML = '<div style="font-size:.75rem;color:var(--ink-muted);padding:.25rem 0">Няма търсения.</div>';
  }
}


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
