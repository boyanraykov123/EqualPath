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

  const reqBody = JSON.stringify(body);
  let resp;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      resp = await fetch(`${API_BASE}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reqBody,
        signal: AbortSignal.timeout(90000),
      });
      break;
    } catch (e) {
      if (attempt === 0) {
        // First fail — server may be waking up, wait and retry
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (e.name === 'TimeoutError') throw new Error('Сървърът не отговори. Моля, опитайте отново след малко.');
      throw new Error('Няма връзка със сървъра. Проверете интернет връзката.');
    }
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
  gi('btn-save-route').style.display = 'none';
  var navBtn = gi('btn-start-nav'); if (navBtn) navBtn.style.display = 'none';
}


/* ── Рендериране на маршрут ──────────────────────────────── */
function renderRoute(data) {
  routeL.clearLayers();

  const profile = data.profile || document.querySelector('input[name="user-profile"]:checked')?.value || 'general';
  const color = PCOLORS[profile] || '#1e9e75';

  // GeoJSON [lon,lat] → Leaflet [lat,lng]
  const toLatLngs = (geojson) => (geojson.coordinates || []).map(c => [c[1], c[0]]);

  // Алтернативни маршрути (тънки, профилен цвят, полупрозрачни)
  if (data.alternatives?.length) {
    for (const alt of data.alternatives) {
      if (!alt.geojson || !alt.geojson.coordinates) continue;
      const altLine = L.polyline(toLatLngs(alt.geojson), {
        color, opacity: .3, weight: 4, lineCap: 'round', lineJoin: 'round', dashArray: '8 6',
      }).addTo(routeL);
      altLine.bindTooltip(`${alt.distance_km} км · ${Math.ceil(alt.duration_min)} мин`, { sticky: true, opacity: .9 });
    }
  }

  // Glow + главна линия (L.polyline — винаги прилага цвета коректно)
  const latlngs = toLatLngs(data.geojson);
  S.routeGlow = L.polyline(latlngs, { color, opacity: .2, weight: 18, lineCap: 'round', lineJoin: 'round' }).addTo(routeL);
  S.routePoly = L.polyline(latlngs, { color, opacity: .95, weight: 6, lineCap: 'round', lineJoin: 'round' }).addTo(routeL);

  // Статистики от backend
  gi('route-distance').textContent      = data.distance_km;
  gi('route-duration').textContent      = Math.ceil(data.duration_min);
  gi('route-comfort-score').textContent = data.comfort_index;
  updateDots(data.comfort_index);

  // Профил-специфични метрики (скрити — изчистен UI)

  showRI();
  gi('btn-save-route').style.display = S.user ? 'block' : 'none';
  gi('btn-start-nav').style.display = 'block';
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


/* Profile metrics removed from UI — function intentionally omitted to simplify sidebar */


/* ── Route loading animation ─────────────────────────────── */
const rlTips = [
  '💡 Comfort Index оценява маршрутите по 10+ фактора за удобство',
  '🗺️ Анализираме данни от OpenStreetMap за всяка улица по маршрута',
  '♿ Проверяваме за стълби, тесни пасажи и неравни настилки',
  '🤖 Gemini AI избира маршрута с най-висок комфорт за твоя профил',
  '⚠️ Активните препятствия от общността се заобикалят автоматично',
  '🌳 Търсим паркове, пейки и сенчести участъци по маршрута',
  '🚦 Отчитаме светофари и безопасни пешеходни пресичания',
];

function showRouteLoading() {
  const overlay = gi('route-loading-overlay');
  overlay.classList.add('visible');

  // Reset steps
  for (let i = 1; i <= 5; i++) {
    const step = gi('rl-step-' + i);
    step.className = 'rl-step' + (i === 1 ? ' active' : '');
  }
  gi('rl-progress-fill').style.width = '0%';
  gi('rl-tip').textContent = rlTips[0];

  // Countdown from 30
  let seconds = 30;
  gi('rl-countdown').textContent = seconds;

  const countdownTimer = setInterval(() => {
    seconds--;
    if (seconds < 0) seconds = 0;
    gi('rl-countdown').textContent = seconds;
  }, 1000);

  // Step progression
  const stepTimings = [
    { step: 1, at: 0, progress: 10 },
    { step: 2, at: 3000, progress: 30 },
    { step: 3, at: 8000, progress: 55 },
    { step: 4, at: 15000, progress: 75 },
  ];

  const stepTimers = [];
  stepTimings.forEach(s => {
    const t = setTimeout(() => {
      // Mark previous as done
      for (let i = 1; i < s.step; i++) gi('rl-step-' + i).className = 'rl-step done';
      // Set current as active
      gi('rl-step-' + s.step).className = 'rl-step active';
      gi('rl-progress-fill').style.width = s.progress + '%';
      // Rotate tip
      gi('rl-tip').textContent = rlTips[s.step % rlTips.length];
    }, s.at);
    stepTimers.push(t);
  });

  // Rotate tips every 5s
  let tipIdx = 0;
  const tipTimer = setInterval(() => {
    tipIdx = (tipIdx + 1) % rlTips.length;
    gi('rl-tip').textContent = rlTips[tipIdx];
  }, 5000);

  return {
    finish: function() {
      clearInterval(countdownTimer);
      clearInterval(tipTimer);
      stepTimers.forEach(clearTimeout);
      // Mark all done, show step 5
      for (let i = 1; i <= 4; i++) gi('rl-step-' + i).className = 'rl-step done';
      gi('rl-step-5').className = 'rl-step active';
      gi('rl-progress-fill').style.width = '100%';
      gi('rl-countdown').textContent = '0';
      setTimeout(() => overlay.classList.remove('visible'), 800);
    },
    cancel: function() {
      clearInterval(countdownTimer);
      clearInterval(tipTimer);
      stepTimers.forEach(clearTimeout);
      overlay.classList.remove('visible');
    }
  };
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
  btn.innerHTML = '⏳ &nbsp;Зарежда...';

  // Close sidebar on mobile
  const sb = gi('sidebar');
  if (sb && sb.classList.contains('is-open')) {
    sb.classList.remove('is-open');
    document.body.classList.remove('sidebar-open');
  }

  const loader = showRouteLoading();

  try {
    const data = await fetchRouteFromBackend(S.from, S.to);
    loader.finish();
    setTimeout(() => {
      renderRoute(data);
      const obsNote = data.obstacles_on_route > 0 ? ` · ⚠️ ${data.obstacles_on_route} препятстви(я)` : '';
      toast(`✅ ${data.route_summary} · CI ${data.comfort_index}/10${obsNote}`);
    }, 900);
  } catch (err) {
    loader.cancel();
    console.error('[EqualPath]', err);
    toast(`⚠️ ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🧭 &nbsp;Намери маршрут';
  }
});


/* ── Бутон „Изчисти маршрута" ─────────────────────────────── */
function clearMapRoute() {
  if (typeof isNavigating !== 'undefined' && isNavigating && typeof stopNavigation === 'function') stopNavigation();
  routeL.clearLayers();
  S.routePoly = null;
  S.routeGlow = null;
  hideRI();
  sessionStorage.removeItem('eq_route');
  
  // Изчистване на начална и крайна точка
  S.from = null;
  S.to = null;
  gi('input-from').value = '';
  gi('input-to').value = '';
  gi('input-from').classList.remove('is-set');
  gi('input-to').classList.remove('is-set');
  gi('clear-from').classList.remove('visible');
  gi('clear-to').classList.remove('visible');
  
  // Премахване на маркери
  if (typeof mA !== 'undefined' && mA) {
    markL.removeLayer(mA);
    mA = null;
  }
  if (typeof mB !== 'undefined' && mB) {
    markL.removeLayer(mB);
    mB = null;
  }
}

gi('btn-clear-route').addEventListener('click', () => {
  clearMapRoute();
  toast('Маршрутът е изчистен.');
});


/* ── Смяна на профил → моментална смяна на цвят + нов маршрут */
document.querySelectorAll('input[name="user-profile"]').forEach(r => {
  r.addEventListener('change', async () => {
    const p = r.value;
    const d = PFILTERS[p] ?? PFILTERS.general;
    Object.entries(d).forEach(([id, v]) => { const el = gi(id); if (el) el.checked = v; });
    // Нуждите на потребителя остават винаги отбелязани (добавяме отгоре)
    if (S.user?.needs) {
      S.user.needs.forEach(need => {
        const fid = NEEDS_FILTER[need];
        if (fid) { const el = gi(fid); if (el) el.checked = true; }
      });
    }

    // 1. Моментална смяна на цвета на всички слоеве (главен + алтернативи)
    const newColor = PCOLORS[p] || '#1e9e75';
    if (S.routePoly) {
      S.routePoly.setStyle({ color: newColor });
      if (S.routeGlow) S.routeGlow.setStyle({ color: newColor });
    }
    routeL.eachLayer(layer => {
      if (layer !== S.routePoly && layer !== S.routeGlow && layer.setStyle) {
        layer.setStyle({ color: newColor });
      }
    });

    // 2. Преизчисляване на маршрута с новия профил (фоново)
    if (S.from && S.to && S.routePoly) {
      const btn = gi('btn-find-route');
      btn.disabled = true;
      btn.innerHTML = '🔄 &nbsp;Преизчисляване...';
      try {
        const data = await fetchRouteFromBackend(S.from, S.to);
        renderRoute(data);
        toast(`✅ Маршрут за ${PLABELS[p] || p} · CI ${data.comfort_index}/10`);
      } catch (err) {
        console.error('[EqualPath] Profile reroute:', err);
        toast(`⚠️ ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🧭 &nbsp;Намери маршрут';
      }
    }
  });
});
