/* ═══════════════════════════════════════════════════════════
   map.js — EqualPath
   Leaflet карта: инициализация, слоеве, маркери, pick mode
   ═══════════════════════════════════════════════════════════ */

/* ── Инициализация на картата ─────────────────────────────── */
const map = L.map('map', { center: SOFIA, zoom: 14, zoomControl: true });
map.zoomControl.setPosition('topleft');

// OSM base (винаги работи)
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

// CartoDB — ако тайловете се заредят, скриваме OSM
const cartoLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CARTO',
  subdomains: 'abcd',
  maxZoom: 20,
});
let cartoOk = false;
cartoLayer.on('tileload', () => { if (!cartoOk) { cartoOk = true; map.removeLayer(osmLayer); } });
cartoLayer.on('tileerror', () => { if (!cartoOk) map.removeLayer(cartoLayer); });
cartoLayer.addTo(map);

setTimeout(() => map.invalidateSize(), 250);
window.addEventListener('resize', () => map.invalidateSize());

/* ── Слоеве ──────────────────────────────────────────────── */
const routeL = L.layerGroup().addTo(map);
const markL  = L.layerGroup().addTo(map);
const obsL   = L.layerGroup().addTo(map);

/* ── Pin маркер ──────────────────────────────────────────── */
function pinIcon(color, lbl) {
  return L.divIcon({
    html: `<div style="position:relative;width:36px;height:44px"><div style="width:36px;height:36px;background:${color};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 12px rgba(0,0,0,.3)"></div><span style="position:absolute;top:7px;left:50%;transform:translateX(-50%);color:#fff;font-size:.85rem;font-weight:700;font-family:'DM Sans',sans-serif;pointer-events:none">${lbl}</span></div>`,
    className: '', iconSize: [36, 44], iconAnchor: [18, 44], popupAnchor: [0, -46],
  });
}

const iconA = pinIcon('#1e9e75', 'A');
const iconB = pinIcon('#111827', 'B');
let mA = null, mB = null;

function setA(ll, lbl) {
  if (mA) markL.removeLayer(mA);
  mA = L.marker(ll, { icon: iconA }).bindPopup(`<b style="font-family:'DM Sans',sans-serif">📍 ${esc(lbl)}</b>`).addTo(markL);
}
function setB(ll, lbl) {
  if (mB) markL.removeLayer(mB);
  mB = L.marker(ll, { icon: iconB }).bindPopup(`<b style="font-family:'DM Sans',sans-serif">🏁 ${esc(lbl)}</b>`).addTo(markL);
}

/* ── Pick mode (избор на точка от картата) ─────────────── */
const badge = gi('map-mode-badge');

function setPickMode(mode) {
  S.pickMode = mode;
  const mapEl = gi('map');
  if (mode) {
    mapEl.classList.add('pick-mode');
    badge.textContent = {
      from: '📍 Кликни за начална точка',
      to: '🏁 Кликни за крайна точка',
      obstacle: '⚠️ Кликни за препятствието',
    }[mode] || '';
    badge.classList.add('visible');
  } else {
    mapEl.classList.remove('pick-mode');
    badge.classList.remove('visible');
  }
}

gi('btn-pick-on-map').addEventListener('click', () => {
  const t = !S.from ? 'from' : (!S.to ? 'to' : 'from');
  setPickMode(t);
  // Close sidebar on mobile so user can see the map
  const sidebar = gi('sidebar');
  if (sidebar.classList.contains('is-open') && window.innerWidth <= 768) {
    sidebar.classList.remove('is-open');
    document.body.classList.remove('sidebar-open');
  }
  toast(`Кликни на картата за ${t === 'from' ? 'начална' : 'крайна'} точка`);
});

/* ── Клик върху картата ──────────────────────────────────── */
map.on('click', async e => {
  const { lat, lng } = e.latlng;

  if (S.pickMode === 'from' || S.pickMode === 'to') {
    const w = S.pickMode;
    setPickMode(null);
    const inp = gi(`input-${w}`), clr = gi(`clear-${w}`);
    inp.value = '📍 Зарежда...';
    inp.classList.add('is-set');
    const label = await reverseGeocode(lat, lng);
    inp.value = label;
    clr.classList.add('visible');
    S[w] = { lat, lng, label };
    if (w === 'from') setA({ lat, lng }, label); else setB({ lat, lng }, label);
    if (S.from && S.to) map.fitBounds(L.latLngBounds([S.from.lat, S.from.lng], [S.to.lat, S.to.lng]), { padding: [60, 60] });
    return;
  }

  if (S.pickMode === 'obstacle') {
    S.pendingObs = { lat, lng };
    setPickMode(null);
    const cb = gi('modal-coords-badge');
    cb.textContent = `📌 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    cb.style.display = 'block';
    openObs();
  }
});
