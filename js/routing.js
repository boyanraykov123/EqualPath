/* ═══════════════════════════════════════════════════════════
   routing.js (frontend) — EqualPath
   Заявка към backend, рендериране на маршрут, Comfort Index UI
   ═══════════════════════════════════════════════════════════ */

/* ── Fetch маршрут от backend ─────────────────────────────── */
async function fetchRouteFromBackend(from, to) {
  const profile = document.querySelector('input[name="user-profile"]:checked')?.value ?? 'general';
  const needs   = [...document.querySelectorAll('.filter-option input:checked')].map(el => el.id).filter(Boolean);
  const notes   = S.user?.notes ?? '';

  const needsMap = {
    'filter-no-stairs': 'no-stairs',
    'filter-no-cobble': 'no-cobble',
    'filter-quiet':     'quiet',
    'filter-no-crowds': 'no-crowds',
    'filter-shade':     'shade',
  };
  const mappedNeeds = needs.map(n => needsMap[n]).filter(Boolean);

  const body = {
    from: { lat: from.lat, lng: from.lng },
    to:   { lat: to.lat,   lng: to.lng },
    from_name: gi('input-from').value || `${from.lat.toFixed(5)}, ${from.lng.toFixed(5)}`,
    to_name:   gi('input-to').value   || `${to.lat.toFixed(5)}, ${to.lng.toFixed(5)}`,
    profile,
    needs: mappedNeeds,
    notes,
    user_id: S.user?.id || null,
  };

  let resp;
  try {
    resp = await fetch(`${API_BASE}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('AI сървърът не отговори (timeout). Провери дали е стартиран.');
    throw new Error('Не може да се свърже с AI сървъра. Стартирай: python app.py');
  }

  const data = await resp.json();
  if (!resp.ok || !data.ok) throw new Error(data.error || `Сървърна грешка (${resp.status})`);
  return data;
}


/* ── Comfort Index UI ────────────────────────────────────── */
function calcCI() {
  const p = document.querySelector('input[name="user-profile"]:checked')?.value ?? 'general';
  const w = CW[p] ?? CW.general;
  let s = 5;
  if (gi('filter-no-stairs').checked) s += w.noStairs * 0.15;
  if (gi('filter-no-cobble').checked) s += w.noCobble * 0.15;
  if (gi('filter-quiet').checked)     s += w.quiet * 0.15;
  if (gi('filter-shade').checked)     s += w.shade * 0.10;
  return Math.min(10, s).toFixed(1);
}

function updateDots(ci) {
  const f = Math.round(parseFloat(ci));
  document.querySelectorAll('.comfort-dot').forEach(d =>
    d.classList.toggle('filled', parseInt(d.dataset.i) <= f)
  );
  gi('comfort-label-text').textContent = `${ci}/10`;
}

function showRI() { gi('route-info').classList.add('visible'); }

function hideRI() {
  gi('route-info').classList.remove('visible');
  gi('ai-reason').style.display = 'none';
  gi('ai-warning').style.display = 'none';
}


/* ── Рендериране на маршрут ──────────────────────────────── */
function renderRoute(data) {
  routeL.clearLayers();

  // Glow + главна линия
  L.geoJSON(data.geojson, { style: { color: '#1e9e75', opacity: .12, weight: 16, lineCap: 'round', lineJoin: 'round' } }).addTo(routeL);
  S.routePoly = L.geoJSON(data.geojson, { style: { color: '#1e9e75', opacity: .9, weight: 5, lineCap: 'round', lineJoin: 'round' } }).addTo(routeL);

  // Статистики от backend
  gi('route-distance').textContent      = data.distance_km;
  gi('route-duration').textContent      = Math.ceil(data.duration_min);
  gi('route-comfort-score').textContent = data.comfort_index;
  updateDots(data.comfort_index);

  // AI обяснение
  if (data.reason) {
    gi('ai-reason-text').textContent = data.reason;
    gi('ai-reason').style.display    = 'block';
  }
  // AI предупреждение
  if (data.warning) {
    gi('ai-warning-text').textContent = data.warning;
    gi('ai-warning').style.display    = 'block';
  }

  showRI();
  map.fitBounds(S.routePoly.getBounds(), { padding: [50, 50] });

  // Запазваме маршрута за възстановяване при refresh
  try {
    sessionStorage.setItem('eq_route', JSON.stringify({
      data,
      from: S.from,
      to: S.to,
      fromName: gi('input-from').value,
      toName: gi('input-to').value,
    }));
  } catch {}
}


/* ── Бутон „Намери маршрут" ──────────────────────────────── */
gi('btn-find-route').addEventListener('click', async () => {
  if (!S.from || !S.to) {
    toast('⚠️ Въведи начална и крайна точка!');
    gi(!S.from ? 'input-from' : 'input-to').focus();
    return;
  }

  const btn = gi('btn-find-route');
  btn.disabled = true;

  const steps = ['🗺️ &nbsp;Взимам маршрути...', '🔍 &nbsp;Анализирам улиците...', '🤖 &nbsp;AI избира маршрут...'];
  let si = 0;
  btn.innerHTML = steps[0];
  const stepTimer = setInterval(() => { si = (si + 1) % steps.length; btn.innerHTML = steps[si]; }, 2500);

  try {
    const data = await fetchRouteFromBackend(S.from, S.to);
    clearInterval(stepTimer);
    renderRoute(data);
    toast(`✅ ${data.route_summary} · CI ${data.comfort_index}/10`);
    if (S.user?.id) loadHistory(S.user.id);
  } catch (err) {
    clearInterval(stepTimer);
    console.error('[EqualPath]', err);
    toast(`⚠️ ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🧭 &nbsp;Намери маршрут';
  }
});


/* ── Бутон „Изчисти маршрута" ─────────────────────────────── */
gi('btn-clear-route').addEventListener('click', () => {
  routeL.clearLayers();
  S.routePoly = null;
  hideRI();
  sessionStorage.removeItem('eq_route');
  toast('Маршрутът е изчистен.');
});


/* ── Смяна на профил → обнови филтри ─────────────────────── */
document.querySelectorAll('input[name="user-profile"]').forEach(r => {
  r.addEventListener('change', () => {
    const d = PFILTERS[r.value] ?? PFILTERS.general;
    Object.entries(d).forEach(([id, v]) => { const el = gi(id); if (el) el.checked = v; });
    if (S.routePoly) {
      const ci = calcCI();
      gi('route-comfort-score').textContent = ci;
      updateDots(ci);
    }
  });
});