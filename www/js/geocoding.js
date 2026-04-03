/* ═══════════════════════════════════════════════════════════
   geocoding.js — EqualPath
   Geocoding (Nominatim), reverse geocoding, autocomplete
   ═══════════════════════════════════════════════════════════ */

async function geocode(q) {
  const p = new URLSearchParams({ q, format: 'json', addressdetails: 1, limit: 6, countrycodes: 'bg' });
  const r = await fetch(`${NOM}/search?${p}`, { headers: { 'Accept-Language': 'bg,en' } });
  if (!r.ok) throw new Error('Geocode error');
  return r.json();
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`${NOM}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'bg,en' } });
    const d = await r.json();
    return d.display_name?.split(',').slice(0, 3).join(', ') || `${lat.toFixed(5)},${lng.toFixed(5)}`;
  } catch { return `${lat.toFixed(5)},${lng.toFixed(5)}`; }
}

function fmtAddr(item) {
  const a = item.address ?? {};
  return [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || a.town || a.village || a.municipality]
    .filter(Boolean).join(', ') || item.display_name.split(',').slice(0, 3).join(', ');
}

function locIco(t, c) {
  const m = {
    restaurant: '🍽️', cafe: '☕', hospital: '🏥', pharmacy: '💊', school: '🏫',
    university: '🎓', park: '🌳', station: '🚉', bus_stop: '🚌', hotel: '🏨',
    bank: '🏦', supermarket: '🛒', mall: '🏬', church: '⛪', museum: '🏛️',
  };
  return m[t] || m[c] || '📍';
}


/* ── Autocomplete setup ──────────────────────────────────── */

function setupGeo(inpId, dropId, spinId, clrId, which) {
  const inp = gi(inpId), drop = gi(dropId), spin = gi(spinId), clr = gi(clrId);
  let idx = -1;

  const render = res => {
    drop.innerHTML = '';
    idx = -1;
    if (!res.length) {
      drop.innerHTML = '<div class="geo-dropdown-empty">Няма резултати</div>';
      drop.classList.add('visible');
      return;
    }
    res.forEach(item => {
      const name = item.name || item.display_name.split(',')[0];
      const addr = fmtAddr(item), icon = locIco(item.type, item.class);
      const el = document.createElement('div');
      el.className = 'geo-dropdown-item';
      el.setAttribute('role', 'option');
      el.innerHTML = `<span class="geo-item-icon">${icon}</span><span><div class="geo-item-name">${esc(name)}</div><div class="geo-item-addr">${esc(addr)}</div></span>`;
      el.onclick = () => pick(item, name, addr);
      drop.appendChild(el);
    });
    drop.classList.add('visible');
  };

  const pick = (item, name, addr) => {
    const ll = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
    const label = name || addr;
    inp.value = label;
    inp.classList.add('is-set');
    clr.classList.add('visible');
    drop.classList.remove('visible');
    idx = -1;
    S[which] = { ...ll, label };
    if (which === 'from') setA(ll, label); else setB(ll, label);
    if (S.from && S.to) map.fitBounds(L.latLngBounds([S.from.lat, S.from.lng], [S.to.lat, S.to.lng]), { padding: [60, 60] });
    else map.setView(ll, 16, { animate: true });
  };

  inp.addEventListener('keydown', e => {
    const open = drop.classList.contains('visible');
    const items = drop.querySelectorAll('.geo-dropdown-item');
    if (e.key === 'ArrowDown') { e.preventDefault(); if (open && items.length) { items.forEach(i => i.classList.remove('active')); idx = Math.min(items.length - 1, idx + 1); items[idx].classList.add('active'); } }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (open && items.length && idx > 0) { items.forEach(i => i.classList.remove('active')); idx--; items[idx].classList.add('active'); } }
    if (e.key === 'Escape') drop.classList.remove('visible');
    if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); items[idx]?.click(); }
  });

  const search = debounce(async q => {
    if (q.length < 3) { drop.classList.remove('visible'); return; }
    spin.classList.add('visible');
    clr.classList.remove('visible');
    try { render(await geocode(q)); }
    catch { drop.innerHTML = '<div class="geo-dropdown-empty">⚠️ Грешка при търсене.</div>'; drop.classList.add('visible'); }
    finally { spin.classList.remove('visible'); }
  }, 350);

  inp.addEventListener('input', () => {
    const v = inp.value.trim();
    if (!v) { drop.classList.remove('visible'); clr.classList.remove('visible'); inp.classList.remove('is-set'); S[which] = null; return; }
    clr.classList.add('visible');
    search(v);
  });

  clr.addEventListener('click', () => {
    inp.value = '';
    inp.classList.remove('is-set');
    clr.classList.remove('visible');
    drop.classList.remove('visible');
    S[which] = null;
    if (which === 'from' && mA) { markL.removeLayer(mA); mA = null; }
    if (which === 'to' && mB)   { markL.removeLayer(mB); mB = null; }
    if (!S.from || !S.to) hideRI();
    inp.focus();
  });

  document.addEventListener('click', e => {
    if (!gi(`wrapper-${which}`).contains(e.target)) drop.classList.remove('visible');
  });
}

/* ── Инициализация ───────────────────────────────────────── */
setupGeo('input-from', 'dropdown-from', 'spinner-from', 'clear-from', 'from');
setupGeo('input-to',   'dropdown-to',   'spinner-to',   'clear-to',   'to');
