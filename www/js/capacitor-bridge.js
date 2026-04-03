/* ═══════════════════════════════════════════════════════════
   capacitor-bridge.js — EqualPath Mobile
   GPS, навигация в реално време (Google Maps стил)
   ═══════════════════════════════════════════════════════════ */

/* ── Platform detection ──────────────────────────────────── */
var isNative = false;
try { isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform(); } catch(e) {}
console.log('[EqualPath] Native:', isNative);

/* ── State ────────────────────────────────────────────────── */
var gpsWatchId = null;
var userLocationMarker = null;
var userAccuracyCircle = null;
var isNavigating = false;
var lastGPS = null;

/* ── User location marker (blue dot) ─────────────────────── */
var blueDot = L.divIcon({
  html: '<div style="width:16px;height:16px;background:#4285F4;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px rgba(66,133,244,.35),0 2px 6px rgba(0,0,0,.3)"></div>',
  className: '', iconSize: [16, 16], iconAnchor: [8, 8],
});

/* ═══════════════════════════════════════════════════════════
   GPS CORE — получаване на позиция
   ═══════════════════════════════════════════════════════════ */

/* Обща функция за получаване на текуща GPS позиция.
   Опитва HIGH ACCURACY, при timeout пробва LOW accuracy. */
async function getGPSPosition() {
  var opts = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };

  if (isNative) {
    var geo = Capacitor.Plugins.Geolocation;
    // Искай разрешение
    try {
      var perms = await geo.checkPermissions();
      if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') {
        var req = await geo.requestPermissions();
        if (req.location !== 'granted' && req.coarseLocation !== 'granted') {
          throw new Error('GPS permission denied');
        }
      }
    } catch(e) {
      throw new Error('GPS permission denied');
    }

    try {
      return await geo.getCurrentPosition(opts);
    } catch(e) {
      // Fallback: опитай без high accuracy
      console.warn('[GPS] High accuracy failed, trying low:', e);
      return await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 0 });
    }
  } else {
    // Browser
    return new Promise(function(resolve, reject) {
      navigator.geolocation.getCurrentPosition(resolve, function(err) {
        if (err.code === 3) {
          // Timeout — опитай без high accuracy
          navigator.geolocation.getCurrentPosition(resolve, reject,
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 });
        } else {
          reject(err);
        }
      }, opts);
    });
  }
}

/* ── Обновяване на позицията на картата ──────────────────── */
function showUserOnMap(lat, lng, accuracy) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
  lastGPS = { lat: lat, lng: lng, acc: accuracy };
  var ll = L.latLng(lat, lng);
  var acc = Math.min(accuracy || 30, 300);

  if (userLocationMarker) {
    userLocationMarker.setLatLng(ll);
  } else {
    userLocationMarker = L.marker(ll, { icon: blueDot, zIndexOffset: 1000 }).addTo(map);
  }

  if (userAccuracyCircle) {
    userAccuracyCircle.setLatLng(ll).setRadius(acc);
  } else {
    userAccuracyCircle = L.circle(ll, {
      radius: acc, color: '#4285F4', fillColor: '#4285F4',
      fillOpacity: 0.07, weight: 1, interactive: false,
    }).addTo(map);
  }
}

/* ═══════════════════════════════════════════════════════════
   WATCH — непрекъснато проследяване
   ═══════════════════════════════════════════════════════════ */
async function startWatch() {
  if (gpsWatchId !== null) return;

  if (isNative) {
    try {
      var geo = Capacitor.Plugins.Geolocation;
      gpsWatchId = await geo.watchPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        function(pos, err) {
          if (err || !pos) return;
          onGPSUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        }
      );
    } catch(e) {
      console.error('[GPS] Native watch fail:', e);
      startBrowserWatch();
    }
  } else {
    startBrowserWatch();
  }
}

function startBrowserWatch() {
  if (!navigator.geolocation) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    function(pos) {
      onGPSUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    function(err) { console.warn('[GPS] Watch err:', err.message); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function stopWatch() {
  if (gpsWatchId === null) return;
  try {
    if (isNative) Capacitor.Plugins.Geolocation.clearWatch({ id: gpsWatchId });
    else navigator.geolocation.clearWatch(gpsWatchId);
  } catch(e) {}
  gpsWatchId = null;
}

/* Извиква се при всяка нова GPS позиция */
function onGPSUpdate(lat, lng, acc) {
  showUserOnMap(lat, lng, acc);
  if (isNavigating) {
    // Следвай потребителя (Google Maps стил)
    map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: true, duration: 0.5 });
    updateNavigationProgress(lat, lng);
  }
}

/* ═══════════════════════════════════════════════════════════
   LOCATE ME — еднократно центриране
   ═══════════════════════════════════════════════════════════ */
async function locateMe() {
  var btn = gi('btn-locate-me');
  if (btn) btn.classList.add('locating');

  try {
    var pos = await getGPSPosition();
    var lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy;
    showUserOnMap(lat, lng, acc);
    map.setView([lat, lng], 17, { animate: true });
    toast('Позиция: ' + Math.round(acc) + 'м точност');
    if (gpsWatchId === null) startWatch();
  } catch(e) {
    console.error('[GPS]', e);
    toast('GPS грешка: ' + (e.message || 'Проверете настройките'));
  } finally {
    if (btn) btn.classList.remove('locating');
  }
}

/* ═══════════════════════════════════════════════════════════
   SET START FROM GPS
   ═══════════════════════════════════════════════════════════ */
async function setStartFromGPS() {
  var btn = gi('btn-gps-start');
  if (btn) { btn.disabled = true; btn.textContent = '📍 Търся GPS...'; }

  try {
    var pos = await getGPSPosition();
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var label = await reverseGeocode(lat, lng);

    gi('input-from').value = label;
    gi('input-from').classList.add('is-set');
    gi('clear-from').classList.add('visible');
    S.from = { lat: lat, lng: lng, label: label };
    setA([lat, lng], label);
    showUserOnMap(lat, lng, pos.coords.accuracy);
    if (gpsWatchId === null) startWatch();
    toast('Начална точка от GPS.');
  } catch(e) {
    toast('GPS грешка: ' + (e.message || 'Няма достъп'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📍 Използвай GPS за начало'; }
  }
}

/* ═══════════════════════════════════════════════════════════
   NAVIGATION — Google Maps стил
   ═══════════════════════════════════════════════════════════ */
function startNavigation() {
  if (!S.routePoly) {
    toast('Първо намерете маршрут!');
    return;
  }
  isNavigating = true;

  // UI: fullscreen навигация
  document.body.classList.add('navigating');
  var panel = gi('nav-panel');
  if (panel) panel.classList.add('visible');

  // Скрий sidebar
  var sb = gi('sidebar');
  if (sb) sb.classList.remove('is-open');
  document.body.classList.remove('sidebar-open');

  // Стартирай GPS watch
  if (gpsWatchId === null) startWatch();

  // Ако имаме позиция — центрирай веднага
  if (lastGPS) {
    map.setView([lastGPS.lat, lastGPS.lng], 17, { animate: true });
  }

  // Покажи начални стойности
  var distEl = gi('nav-remaining-dist');
  var timeEl = gi('nav-remaining-time');
  if (distEl) distEl.textContent = gi('route-distance').textContent + ' км';
  if (timeEl) timeEl.textContent = gi('route-duration').textContent + ' мин';

  toast('Навигация стартирана');
}

function stopNavigation() {
  isNavigating = false;
  document.body.classList.remove('navigating');
  var panel = gi('nav-panel');
  if (panel) panel.classList.remove('visible');
  toast('Навигацията е спряна.');
}

function updateNavigationProgress(lat, lng) {
  if (!S.routePoly) return;
  var user = L.latLng(lat, lng);
  var pts = S.routePoly.getLatLngs();
  if (!pts.length) return;

  // Намери най-близката точка
  var minD = Infinity, idx = 0;
  for (var i = 0; i < pts.length; i++) {
    var d = user.distanceTo(pts[i]);
    if (d < minD) { minD = d; idx = i; }
  }

  var instrEl = gi('nav-instruction');
  var distEl = gi('nav-remaining-dist');
  var timeEl = gi('nav-remaining-time');

  // Оставащо разстояние
  var rem = 0;
  for (var j = idx; j < pts.length - 1; j++) rem += pts[j].distanceTo(pts[j+1]);

  if (minD > 100) {
    // Отклонение
    if (instrEl) instrEl.textContent = '⚠️ Отклонение от маршрута (' + Math.round(minD) + 'м)';
    if (instrEl) instrEl.style.color = '#dc2626';
  } else if (rem < 25) {
    // Пристигнал
    if (instrEl) { instrEl.textContent = '🏁 Пристигнахте!'; instrEl.style.color = ''; }
    if (distEl) distEl.textContent = '0 м';
    if (timeEl) timeEl.textContent = '0 мин';
    setTimeout(stopNavigation, 3000);
  } else {
    // Нормално навигиране
    if (instrEl) { instrEl.textContent = '📍 Следвайте маршрута'; instrEl.style.color = ''; }
    if (distEl) distEl.textContent = rem > 1000 ? (rem/1000).toFixed(1) + ' км' : Math.round(rem) + ' м';
    if (timeEl) timeEl.textContent = Math.ceil(rem / 75) + ' мин'; // 75м/мин
  }
}

/* ═══════════════════════════════════════════════════════════
   STATUS BAR
   ═══════════════════════════════════════════════════════════ */
async function configureStatusBar() {
  if (!isNative) return;
  try {
    var sbar = Capacitor.Plugins.StatusBar;
    await sbar.setBackgroundColor({ color: '#4A90D9' });
    await sbar.setStyle({ style: 'DARK' });
    await sbar.setOverlaysWebView({ overlay: false });
  } catch(e) {}
}

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */
function initMobile() {
  console.log('[EqualPath] initMobile');
  configureStatusBar();

  // Locate me
  var locBtn = gi('btn-locate-me');
  if (locBtn) locBtn.addEventListener('click', locateMe);

  // GPS as start
  var gpsBtn = gi('btn-gps-start');
  if (gpsBtn) gpsBtn.addEventListener('click', setStartFromGPS);

  // Start navigation (in route-info)
  var navBtn = gi('btn-start-nav');
  if (navBtn) navBtn.addEventListener('click', startNavigation);

  // Stop navigation
  var stopBtn = gi('btn-stop-nav');
  if (stopBtn) stopBtn.addEventListener('click', stopNavigation);

  // Android back button
  if (isNative) {
    try {
      Capacitor.Plugins.App.addListener('backButton', function() {
        if (isNavigating) { stopNavigation(); return; }
        var sb = gi('sidebar');
        if (sb && sb.classList.contains('is-open')) { sb.classList.remove('is-open'); document.body.classList.remove('sidebar-open'); return; }
        var obs = gi('obs-overlay');
        if (obs && obs.classList.contains('is-open')) { closeObs(); return; }
        var auth = gi('auth-overlay');
        if (auth && auth.classList.contains('is-open')) { closeAuth(); return; }
        Capacitor.Plugins.App.minimizeApp();
      });
    } catch(e) {}

    // Auto-start GPS on native
    setTimeout(startWatch, 1500);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobile);
} else {
  initMobile();
}
