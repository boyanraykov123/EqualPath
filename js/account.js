/* ═══════════════════════════════════════════════════════════
   account.js — EqualPath
   Акаунт: редакция на профил, нужди, запазени маршрути
   ═══════════════════════════════════════════════════════════ */

/* ── Отваряне / затваряне ─────────────────────────────────── */
function openAccount() {
  if (!S.user) return;
  gi('user-menu').style.display = 'none';

  // Попълни текущите данни
  gi('edit-name').value = S.user.name || '';
  gi('edit-email').value = S.user.email || '';
  gi('edit-pw').value = '';

  // Попълни нуждите
  document.querySelectorAll('input[name="edit-needs"]').forEach(cb => {
    cb.checked = (S.user.needs || []).includes(cb.value);
  });

  loadSavedRoutes();

  gi('account-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeAccount() {
  gi('account-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}

gi('btn-account').addEventListener('click', openAccount);
gi('account-close-x').addEventListener('click', closeAccount);
gi('account-overlay').addEventListener('click', e => { if (e.target === gi('account-overlay')) closeAccount(); });


/* ── Accordion секции ─────────────────────────────────────── */
document.querySelectorAll('.acc-section-header').forEach(header => {
  header.addEventListener('click', () => {
    const targetId = header.dataset.toggle;
    const body = gi(targetId);
    const isOpen = header.classList.contains('open');
    header.classList.toggle('open', !isOpen);
    body.classList.toggle('open', !isOpen);
  });
});


/* ── Редакция на лични данни ──────────────────────────────── */
gi('edit-profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  clrE('edit-profile-err');

  const name = gi('edit-name').value.trim();
  const email = gi('edit-email').value.trim();
  const pw = gi('edit-pw').value;

  if (!name) { shwE('edit-profile-err', 'Въведи име.'); return; }
  if (!email || !email.includes('@')) { shwE('edit-profile-err', 'Невалиден имейл.'); return; }
  if (pw && pw.length < 8) { shwE('edit-profile-err', 'Паролата трябва да е поне 8 символа.'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Запазва...';

  try {
    // Обнови всичко през backend (Auth + profiles)
    const resp = await fetch(`${API_BASE}/api/profiles/update-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: S.user.id,
        full_name: name,
        ...(email !== S.user.email ? { email } : {}),
        ...(pw ? { password: pw } : {}),
      }),
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);

    // Обнови локалното състояние
    S.user.name = name;
    S.user.email = email;
    gi('uc-name').textContent = name.split(' ')[0];
    gi('um-name').textContent = name;
    gi('um-email').textContent = email;
    gi('pub-nm').textContent = name;

    // Ако паролата е сменена, ре-логваме за да обновим сесията
    if (pw) {
      await sb.auth.signInWithPassword({ email, password: pw });
    }

    toast('Данните са обновени.');
  } catch (err) {
    console.error('Profile update error:', err);
    const msg = err.message || '';
    const bgMsg =
      msg.includes('already been registered') ? 'Този имейл вече е зает.' :
      msg.includes('same password') ? 'Новата парола е същата като старата.' :
      'Грешка при обновяване.';
    shwE('edit-profile-err', bgMsg);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Запази промените';
  }
});


/* ── Редакция на нужди ────────────────────────────────────── */
gi('btn-save-needs').addEventListener('click', async () => {
  const btn = gi('btn-save-needs');
  btn.disabled = true;
  btn.textContent = 'Запазва...';
  clrE('edit-needs-err');

  const needs = [...document.querySelectorAll('input[name="edit-needs"]:checked')].map(c => c.value);

  try {
    const resp = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: S.user.id,
        full_name: S.user.name,
        health_needs: needs,
      }),
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);

    S.user.needs = needs;
    applyNeedsToFilters(needs);
    toast('Нуждите са обновени.');
  } catch (err) {
    console.error('Needs update error:', err);
    shwE('edit-needs-err', 'Грешка при запазване.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Запази нуждите';
  }
});


/* ── Запазване на маршрут ─────────────────────────────────── */
gi('btn-save-route').addEventListener('click', async () => {
  if (!S.user) { showAuthGate(); return; }

  const stored = sessionStorage.getItem('eq_route');
  if (!stored) { toast('Няма маршрут за запазване.'); return; }

  const btn = gi('btn-save-route');
  btn.disabled = true;
  btn.textContent = 'Запазва...';

  try {
    const parsed = JSON.parse(stored);
    const data = parsed.data;

    const resp = await fetch(`${API_BASE}/api/saved-routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: S.user.id,
        start_location: parsed.fromName || '',
        end_location: parsed.toName || '',
        start_coords: parsed.from,
        end_coords: parsed.to,
        distance_km: data.distance_km,
        duration_min: Math.ceil(data.duration_min),
        comfort_index: data.comfort_index,
        geojson: data.geojson,
        ai_analysis: data.reason || '',
        profile: data.profile || 'general',
      }),
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error);

    toast('Маршрутът е запазен!');
  } catch (err) {
    console.error('Save route error:', err);
    toast('Грешка при запазване на маршрута.');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Запази маршрут';
  }
});


/* ── Зареждане на запазени маршрути ───────────────────────── */
async function loadSavedRoutes() {
  const list = gi('saved-routes-list');
  list.innerHTML = '<p style="font-size:.8rem;color:var(--ink-muted)">Зарежда...</p>';

  try {
    const resp = await fetch(`${API_BASE}/api/saved-routes/user/${S.user.id}`, { signal: AbortSignal.timeout(5000) });
    const json = await resp.json();

    if (!json.ok || !json.routes.length) {
      list.innerHTML = '<p style="font-size:.8rem;color:var(--ink-muted)">Няма запазени маршрути.</p>';
      return;
    }

    list.innerHTML = '';
    for (const rt of json.routes) {
      const startName = (rt.start_location || '').length > 25 ? rt.start_location.substring(0, 25) + '...' : (rt.start_location || '');
      const endName = (rt.end_location || '').length > 25 ? rt.end_location.substring(0, 25) + '...' : (rt.end_location || '');
      const date = new Date(rt.created_at).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

      const item = document.createElement('div');
      item.className = 'sr-item';
      item.innerHTML = `
        <div class="sr-header" data-sr-id="${rt.id}">
          <div style="flex:1;min-width:0">
            <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(rt.start_location)} → ${esc(rt.end_location)}">${esc(startName)} → ${esc(endName)}</div>
            <div style="font-size:.68rem;color:var(--ink-muted)">${rt.distance_km} км · ${rt.duration_min} мин · CI ${rt.comfort_index} · ${date}</div>
          </div>
          <svg class="sr-chevron" width="10" height="7" viewBox="0 0 10 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M1 1l4 4 4-4"/></svg>
        </div>
        <div class="sr-body" id="sr-body-${rt.id}">
          <div class="sr-stats">
            <div class="sr-stat"><div class="sr-stat-val">${rt.distance_km}</div><div class="sr-stat-lbl">км</div></div>
            <div class="sr-stat"><div class="sr-stat-val">${rt.duration_min}</div><div class="sr-stat-lbl">мин</div></div>
            <div class="sr-stat"><div class="sr-stat-val">${rt.comfort_index}</div><div class="sr-stat-lbl">CI</div></div>
          </div>
          ${rt.ai_analysis ? `<div class="sr-analysis">${esc(rt.ai_analysis)}</div>` : ''}
          <div class="sr-actions">
            <button class="sr-btn sr-btn-load" data-sr-load="${rt.id}">Зареди на картата</button>
            <button class="sr-btn sr-btn-del" data-sr-del="${rt.id}">Изтрий</button>
          </div>
        </div>`;
      list.appendChild(item);

      // Expand/collapse
      item.querySelector('.sr-header').addEventListener('click', () => {
        const header = item.querySelector('.sr-header');
        const body = item.querySelector('.sr-body');
        header.classList.toggle('open');
        body.classList.toggle('open');
      });

      // Зареди на картата
      item.querySelector(`[data-sr-load="${rt.id}"]`).addEventListener('click', () => {
        loadSavedRouteOnMap(rt);
        closeAccount();
      });

      // Изтрий
      item.querySelector(`[data-sr-del="${rt.id}"]`).addEventListener('click', async (ev) => {
        const delBtn = ev.target;
        delBtn.disabled = true;
        delBtn.textContent = '...';
        try {
          await fetch(`${API_BASE}/api/saved-routes/${rt.id}`, { method: 'DELETE' });
          item.remove();
          if (!list.children.length) {
            list.innerHTML = '<p style="font-size:.8rem;color:var(--ink-muted)">Няма запазени маршрути.</p>';
          }
          toast('Маршрутът е изтрит.');
        } catch { toast('Грешка при изтриване.'); }
      });
    }
  } catch {
    list.innerHTML = '<p style="font-size:.8rem;color:var(--ink-muted)">Няма запазени маршрути.</p>';
  }
}


/* ── Зареждане на запазен маршрут на картата ──────────────── */
function loadSavedRouteOnMap(rt) {
  // Подготви данните в формата, който renderRoute очаква
  const data = {
    geojson: rt.geojson,
    distance_km: rt.distance_km,
    duration_min: rt.duration_min,
    comfort_index: rt.comfort_index,
    reason: rt.ai_analysis,
    profile: rt.profile || 'general',
    alternatives: [],
  };

  // Постави координатите
  if (rt.start_coords) {
    S.from = { lat: rt.start_coords.lat, lng: rt.start_coords.lng, label: rt.start_location };
    gi('input-from').value = rt.start_location;
    gi('input-from').classList.add('is-set');
  }
  if (rt.end_coords) {
    S.to = { lat: rt.end_coords.lat, lng: rt.end_coords.lng, label: rt.end_location };
    gi('input-to').value = rt.end_location;
    gi('input-to').classList.add('is-set');
  }

  renderRoute(data);
  toast(`Маршрутът е зареден: ${rt.start_location} → ${rt.end_location}`);
}
