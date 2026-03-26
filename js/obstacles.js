/* ═══════════════════════════════════════════════════════════
   obstacles.js — EqualPath
   Докладване, показване и премахване на препятствия
   ═══════════════════════════════════════════════════════════ */

/* ── Зареждане на препятствия от DB ──────────────────────── */
async function loadObstaclesFromDB() {
  try {
    const resp = await fetch(`${API_BASE}/api/reports`, { signal: AbortSignal.timeout(5000) });
    const json = await resp.json();
    if (!json.ok) return;
    for (const obs of json.reports) {
      if (!obs.latitude || !obs.longitude) continue;
      const meta = OMETA[obs.type] ?? OMETA.other;
      const report = {
        id: obs.id,
        type: obs.type,
        description: obs.description || '',
        latlng: { lat: obs.latitude, lng: obs.longitude },
        reportedAt: obs.created_at || new Date().toISOString(),
        reporter: '',
      };
      addObsMark(report, meta);
    }
  } catch { /* backend offline */ }
}


/* ── Модал за докладване ─────────────────────────────────── */
function openObs() {
  gi('obs-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => gi('obs-type').focus(), 50);
}

function closeObs() {
  gi('obs-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
  gi('modal-coords-badge').style.display = 'none';
  gi('report-form').reset();
  gi('char-count').textContent = '0';
  clrE('obs-type-err');
  clrE('obs-gen-err');
  S.pendingObs = null;
}

gi('fab-report').addEventListener('click', () => {
  if (!S.user) { showAuthGate(); return; }
  if (!S.pendingObs) {
    setPickMode('obstacle');
    toast('⚠️ Кликни на картата за да маркираш препятствието');
  } else {
    openObs();
  }
});

gi('obs-cancel').addEventListener('click', closeObs);
gi('obs-close-x').addEventListener('click', closeObs);
gi('obs-overlay').addEventListener('click', e => { if (e.target === gi('obs-overlay')) closeObs(); });
gi('obs-desc').addEventListener('input', () => { gi('char-count').textContent = gi('obs-desc').value.length; });


/* ── Изпращане на доклад ─────────────────────────────────── */
gi('report-form').addEventListener('submit', async e => {
  e.preventDefault();
  clrE('obs-type-err');
  clrE('obs-gen-err');
  const type = gi('obs-type').value;
  if (!type) { shwE('obs-type-err', 'Моля, избери тип препятствие.'); gi('obs-type').focus(); return; }

  const btn = gi('obs-submit');
  btn.disabled = true;
  btn.textContent = '⏳ Изпраща...';

  const ll = S.pendingObs ?? { lat: SOFIA[0], lng: SOFIA[1] };
  const meta = OMETA[type] ?? OMETA.other;
  const desc = gi('obs-desc').value.trim();
  const reporter = S.user?.name ?? 'Анонимен';
  let reportId = null;

  // Изпращаме към backend → Supabase
  try {
    const resp = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type, description: desc, latlng: ll,
        location: `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`,
        user_id: S.user?.id || null,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await resp.json();
    if (json.ok) reportId = json.id;
  } catch {
    console.warn('[EqualPath] Backend офлайн, докладът е само локален.');
  }

  const report = {
    id: reportId || Date.now(), type, description: desc,
    latlng: ll, reportedAt: new Date().toISOString(), reporter,
  };
  addObsMark(report, meta);
  closeObs();
  toast(`${meta.emoji} Докладът е изпратен. Благодаря!`);
  btn.disabled = false;
  btn.innerHTML = '✅ Изпрати';

  // Ако има активен маршрут — преизчисли го
  if (S.from && S.to && S.routePoly) {
    toast('🔄 Преизчисляване на маршрута...');
    try {
      const data = await fetchRouteFromBackend(S.from, S.to);
      renderRoute(data);
      toast('✅ Маршрутът е обновен, за да заобиколи препятствието.');
    } catch (err) { console.warn('Reroute failed:', err); }
  }
});


/* ── Маркер за препятствие ───────────────────────────────── */
function addObsMark(report, meta) {
  const icon = L.divIcon({
    html: `<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:1rem;box-shadow:0 2px 8px rgba(220,38,38,.25);cursor:pointer">${meta.emoji}</div>`,
    className: '', iconSize: [34, 34], iconAnchor: [17, 17],
  });

  const removeBtn = S.user
    ? `<button onclick="removeReport('${report.id}',this)" style="width:100%;padding:.4rem;background:#dc2626;color:#fff;border:none;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:.8rem;font-weight:600;cursor:pointer">Премахни</button>`
    : `<p style="font-size:.7rem;color:var(--ink-faint);text-align:center;margin:.25rem 0 0">Влез в профила си за да премахнеш</p>`;

  const marker = L.marker([report.latlng.lat, report.latlng.lng], { icon, alt: meta.label })
    .bindPopup(`<div style="font-family:'DM Sans',sans-serif;min-width:180px"><p style="font-weight:700;font-size:.9rem;margin:0 0 .25rem">${meta.emoji} ${meta.label}</p>${report.description ? `<p style="font-size:.8rem;color:#6b7280;margin:0 0 .375rem">${esc(report.description)}</p>` : ''}<p style="font-size:.7rem;color:#9ca3af;margin:0 0 .5rem">🕐 ${new Date(report.reportedAt).toLocaleTimeString('bg-BG')} · ${esc(report.reporter)}</p>${removeBtn}</div>`)
    .addTo(obsL);
  marker._eqReportId = report.id;
}


/* ── Премахване на препятствие ────────────────────────────── */
async function removeReport(reportId, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }
  try {
    await fetch(`${API_BASE}/api/reports/${reportId}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
  } catch { /* offline — махаме само локално */ }

  obsL.eachLayer(layer => {
    if (layer._eqReportId == reportId) obsL.removeLayer(layer);
  });
  toast('Препятствието е премахнато.');

  // Преизчисли маршрута без премахнатото препятствие
  if (S.from && S.to && S.routePoly) {
    try {
      const data = await fetchRouteFromBackend(S.from, S.to);
      renderRoute(data);
    } catch (err) { console.warn('Reroute after removal failed:', err); }
  }
}