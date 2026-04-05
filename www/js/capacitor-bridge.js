/* ═══════════════════════════════════════════════════════════
   capacitor-bridge.js — EqualPath
   GPS, навигация Google Maps стил
   ═══════════════════════════════════════════════════════════ */

/* ── Platform detection ──────────────────────────────────── */
var isNative = false;
try { isNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform(); } catch(e) {}
console.log('[EqualPath] Platform:', isNative ? 'Native' : 'Browser');

/* ── State ────────────────────────────────────────────────── */
var gpsWatchId = null;
var userLocationMarker = null;
var userAccuracyCircle = null;
var isNavigating = false;
var lastGPS = null;
var totalRouteDistance = 0;
var userHasPanned = false;
var autoFollow = true;
var navStartTime = null;
var sheetExpanded = false;
var currentBearing = 0;
var prevGPS = null;
var mapRotation = 0;

/* ── Icons ───────────────────────────────────────────────── */
var blueDot = L.divIcon({
  html: '<div style="width:18px;height:18px;background:#4285F4;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 2px rgba(66,133,244,.4),0 2px 8px rgba(0,0,0,.3)"></div>',
  className: '', iconSize: [18, 18], iconAnchor: [9, 9],
});

var navArrow = L.divIcon({
  html: '<div style="width:32px;height:32px;background:#4285F4;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 3px rgba(66,133,244,.3),0 3px 12px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:11px solid #fff;margin-top:-2px"></div></div>',
  className: '', iconSize: [32, 32], iconAnchor: [16, 16],
});

/* ═══════════════════════════════════════════════════════════
   GPS CORE
   ═══════════════════════════════════════════════════════════ */
async function getGPSPosition() {
  var opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 };
  if (isNative) {
    var geo = Capacitor.Plugins.Geolocation;
    try {
      var perms = await geo.checkPermissions();
      if (perms.location !== 'granted' && perms.coarseLocation !== 'granted') {
        var req = await geo.requestPermissions();
        if (req.location !== 'granted' && req.coarseLocation !== 'granted') throw new Error('GPS достъпът е отказан');
      }
    } catch(e) {
      if (e.message && e.message.indexOf('отказан') !== -1) throw e;
      throw new Error('GPS достъпът е отказан');
    }
    try { return await geo.getCurrentPosition(opts); }
    catch(e) { return await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 }); }
  } else {
    return new Promise(function(resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('Браузърът не поддържа GPS')); return; }
      navigator.geolocation.getCurrentPosition(resolve, function(err) {
        if (err.code === 3) navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 });
        else if (err.code === 1) reject(new Error('GPS достъпът е отказан. Разрешете локацията в настройките на браузъра.'));
        else reject(new Error('GPS грешка: ' + err.message));
      }, opts);
    });
  }
}

/* ── Show user on map ───────────────────────────────────── */
function showUserOnMap(lat, lng, accuracy) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
  lastGPS = { lat: lat, lng: lng, acc: accuracy };
  var ll = L.latLng(lat, lng);
  var acc = Math.min(accuracy || 30, 300);
  var icon = isNavigating ? navArrow : blueDot;
  if (userLocationMarker) { userLocationMarker.setLatLng(ll); userLocationMarker.setIcon(icon); }
  else userLocationMarker = L.marker(ll, { icon: icon, zIndexOffset: 1000 }).addTo(map);
  if (userAccuracyCircle) userAccuracyCircle.setLatLng(ll).setRadius(acc);
  else userAccuracyCircle = L.circle(ll, { radius: acc, color: '#4285F4', fillColor: '#4285F4', fillOpacity: 0.08, weight: 1.5, interactive: false }).addTo(map);
  var accEl = gi('nav-accuracy');
  if (accEl && isNavigating) accEl.textContent = Math.round(acc) + 'м';
}

/* ═══════════════════════════════════════════════════════════
   WATCH
   ═══════════════════════════════════════════════════════════ */
async function startWatch() {
  if (gpsWatchId !== null) return;
  if (isNative) {
    try {
      var geo = Capacitor.Plugins.Geolocation;
      gpsWatchId = await geo.watchPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, function(pos, err) {
        if (err || !pos) return;
        onGPSUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      });
    } catch(e) { startBrowserWatch(); }
  } else startBrowserWatch();
}

function startBrowserWatch() {
  if (!navigator.geolocation) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    function(pos) { onGPSUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); },
    function(err) { console.warn('[GPS] Watch err:', err.message); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function stopWatch() {
  if (gpsWatchId === null) return;
  try { if (isNative) Capacitor.Plugins.Geolocation.clearWatch({ id: gpsWatchId }); else navigator.geolocation.clearWatch(gpsWatchId); } catch(e) {}
  gpsWatchId = null;
}

function onGPSUpdate(lat, lng, acc) {
  showUserOnMap(lat, lng, acc);

  // Calculate bearing from movement
  if (prevGPS && isNavigating) {
    var dist = L.latLng(lat, lng).distanceTo(L.latLng(prevGPS.lat, prevGPS.lng));
    if (dist > 3) { // Only update bearing if moved > 3m (filter noise)
      var newBearing = bearing({ lat: prevGPS.lat, lng: prevGPS.lng }, { lat: lat, lng: lng });
      // Smooth bearing (weighted average)
      var diff = angleDiff(currentBearing, newBearing);
      currentBearing = (currentBearing + diff * 0.4 + 360) % 360;
      rotateMap(currentBearing);
    }
  }
  prevGPS = { lat: lat, lng: lng };

  if (isNavigating) {
    if (autoFollow && !userHasPanned) map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: true, duration: 0.5 });
    updateNavigationProgress(lat, lng);
  }
}

/* ═══════════════════════════════════════════════════════════
   LOCATE ME
   ═══════════════════════════════════════════════════════════ */
async function locateMe() {
  var btn = gi('btn-locate-me'); if (btn) btn.classList.add('locating');
  try {
    var pos = await getGPSPosition();
    showUserOnMap(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    map.setView([pos.coords.latitude, pos.coords.longitude], 17, { animate: true });
    toast('Позиция: ' + Math.round(pos.coords.accuracy) + 'м точност');
    if (gpsWatchId === null) startWatch();
  } catch(e) { toast(e.message || 'GPS грешка'); }
  finally { if (btn) btn.classList.remove('locating'); }
}

/* ═══════════════════════════════════════════════════════════
   SET START FROM GPS
   ═══════════════════════════════════════════════════════════ */
async function setStartFromGPS() {
  var btn = gi('btn-gps-start'); if (btn) { btn.disabled = true; btn.textContent = '📍 Търся GPS...'; }
  try {
    var pos = await getGPSPosition();
    var lat = pos.coords.latitude, lng = pos.coords.longitude;
    var label = await reverseGeocode(lat, lng);
    gi('input-from').value = label; gi('input-from').classList.add('is-set'); gi('clear-from').classList.add('visible');
    S.from = { lat: lat, lng: lng, label: label };
    setA([lat, lng], label); showUserOnMap(lat, lng, pos.coords.accuracy);
    if (gpsWatchId === null) startWatch();
    toast('Начална точка от GPS');
  } catch(e) { toast(e.message || 'GPS грешка'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '📍 Използвай GPS за начало'; } }
}

/* ═══════════════════════════════════════════════════════════
   TURN DETECTION — Analyze route geometry for turns
   ═══════════════════════════════════════════════════════════ */
function bearing(p1, p2) {
  var dLng = (p2.lng - p1.lng) * Math.PI / 180;
  var lat1 = p1.lat * Math.PI / 180, lat2 = p2.lat * Math.PI / 180;
  var y = Math.sin(dLng) * Math.cos(lat2);
  var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDiff(a, b) {
  var d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function getTurnType(angle) {
  var a = Math.abs(angle);
  if (a < 25) return { type: 'straight', label: 'Продължете направо', icon: 'straight' };
  if (angle > 0 && a < 70) return { type: 'slight-right', label: 'Леко надясно', icon: 'slight-right' };
  if (angle < 0 && a < 70) return { type: 'slight-left', label: 'Леко наляво', icon: 'slight-left' };
  if (angle > 0 && a < 130) return { type: 'right', label: 'Завийте надясно', icon: 'right' };
  if (angle < 0 && a < 130) return { type: 'left', label: 'Завийте наляво', icon: 'left' };
  if (angle > 0) return { type: 'sharp-right', label: 'Остро надясно', icon: 'sharp-right' };
  return { type: 'sharp-left', label: 'Остро наляво', icon: 'sharp-left' };
}

var turnSVGs = {
  'straight': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  'right': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19v-6a4 4 0 014-4h8M14 5l5 4-5 4"/></svg>',
  'left': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 19v-6a4 4 0 00-4-4H7M10 5L5 9l5 4"/></svg>',
  'slight-right': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19v-8l10-6M17 5v5h-5"/></svg>',
  'slight-left': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 19v-8L7 5M7 5v5h5"/></svg>',
  'sharp-right': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5v10l10 4M17 19l-1-5h5"/></svg>',
  'sharp-left': '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 5v10L7 19M7 19l1-5H3"/></svg>',
};

function findTurns(pts) {
  var turns = [];
  var MIN_SEG = 15; // meters for bearing calculation
  for (var i = 1; i < pts.length - 1; i++) {
    // Find segment before (at least MIN_SEG meters)
    var prevIdx = i - 1;
    var prevDist = 0;
    while (prevIdx > 0 && prevDist < MIN_SEG) { prevDist += pts[prevIdx].distanceTo(pts[prevIdx + 1]); prevIdx--; }
    // Find segment after
    var nextIdx = i + 1;
    var nextDist = 0;
    while (nextIdx < pts.length - 1 && nextDist < MIN_SEG) { nextDist += pts[nextIdx].distanceTo(pts[nextIdx - 1]); nextIdx++; }
    var b1 = bearing(pts[prevIdx], pts[i]);
    var b2 = bearing(pts[i], pts[nextIdx]);
    var angle = angleDiff(b1, b2);
    if (Math.abs(angle) > 25) {
      // Distance from route start to this turn
      var distFromStart = 0;
      for (var j = 0; j < i; j++) distFromStart += pts[j].distanceTo(pts[j + 1]);
      var turn = getTurnType(angle);
      turn.index = i;
      turn.distFromStart = distFromStart;
      turn.latlng = pts[i];
      turns.push(turn);
    }
  }
  return turns;
}

var navTurns = [];

/* ═══════════════════════════════════════════════════════════
   NAVIGATION — Google Maps style
   ═══════════════════════════════════════════════════════════ */
async function startNavigation() {
  if (!S.routePoly) { toast('Първо намерете маршрут!'); return; }
  var btn = gi('btn-start-nav');
  if (btn) { btn.disabled = true; btn.textContent = '📍 Търся GPS...'; }
  try {
    if (!lastGPS || !lastGPS.lat) {
      var pos = await getGPSPosition();
      showUserOnMap(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    }
    isNavigating = true;
    autoFollow = true;
    userHasPanned = false;
    sheetExpanded = false;
    navStartTime = Date.now();

    // Calculate total route distance & turns
    var pts = S.routePoly.getLatLngs();
    totalRouteDistance = 0;
    for (var i = 0; i < pts.length - 1; i++) totalRouteDistance += pts[i].distanceTo(pts[i + 1]);
    navTurns = findTurns(pts);

    // UI
    document.body.classList.add('navigating');
    var destEl = gi('nav-dest-name');
    if (destEl) destEl.textContent = gi('input-to')?.value || 'Дестинация';
    var ciEl = gi('nav-ci');
    if (ciEl) ciEl.textContent = (gi('route-comfort-score')?.textContent || '—') + '/10';
    var totalDistEl = gi('nav-total-dist');
    if (totalDistEl) totalDistEl.textContent = totalRouteDistance > 1000 ? (totalRouteDistance / 1000).toFixed(1) + ' км' : Math.round(totalRouteDistance) + ' м';

    // Initial values
    updateNavETA(totalRouteDistance);

    // Hide sidebar
    var sb = gi('sidebar'); if (sb) sb.classList.remove('is-open');

    // Start GPS watch
    if (gpsWatchId === null) startWatch();

    // Map drag detection
    map.on('dragstart', onMapDrag);

    // Center and zoom
    if (lastGPS) map.setView([lastGPS.lat, lastGPS.lng], Math.max(map.getZoom(), 17), { animate: true });

    // Switch icon
    if (userLocationMarker) userLocationMarker.setIcon(navArrow);

    // Progress
    var progEl = gi('nav-progress-fill'); if (progEl) progEl.style.width = '0%';

    // Invalidate map size for the bigger canvas
    setTimeout(function() { map.invalidateSize(); }, 400);

    // Sheet handle drag
    setupSheetDrag();

    toast('Навигация стартирана');
  } catch(e) { toast(e.message || 'GPS грешка. Разрешете локацията.'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🧭 Стартирай навигация'; } }
}

function stopNavigation() {
  isNavigating = false;
  autoFollow = true;
  userHasPanned = false;
  sheetExpanded = false;
  navTurns = [];
  document.body.classList.remove('navigating');
  var recBtn = gi('btn-recenter'); if (recBtn) recBtn.style.display = 'none';
  var sheet = gi('nav-bottom-sheet'); if (sheet) sheet.classList.remove('expanded');
  map.off('dragstart', onMapDrag);
  if (userLocationMarker) userLocationMarker.setIcon(blueDot);
  resetMapRotation();
  setTimeout(function() { map.invalidateSize(); }, 500);
  toast('Навигацията е спряна');
}

function onMapDrag() {
  if (!isNavigating) return;
  userHasPanned = true;
  autoFollow = false;
  var recBtn = gi('btn-recenter'); if (recBtn) recBtn.style.display = 'flex';
}

function recenterMap() {
  if (!lastGPS) return;
  userHasPanned = false;
  autoFollow = true;
  map.setView([lastGPS.lat, lastGPS.lng], Math.max(map.getZoom(), 17), { animate: true });
  var recBtn = gi('btn-recenter'); if (recBtn) recBtn.style.display = 'none';
}

function updateNavETA(remainingMeters) {
  var mins = Math.ceil(remainingMeters / 75); // 75m/min walking
  var etaMin = gi('nav-eta-min');
  var etaDist = gi('nav-eta-dist');
  var etaArrival = gi('nav-eta-arrival');
  if (etaMin) etaMin.textContent = mins.toString();
  if (etaDist) etaDist.textContent = remainingMeters > 1000 ? (remainingMeters / 1000).toFixed(1) + ' км' : Math.round(remainingMeters) + ' м';
  if (etaArrival) {
    var now = new Date();
    now.setMinutes(now.getMinutes() + mins);
    etaArrival.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  }
}

function formatDist(m) {
  return m > 1000 ? (m / 1000).toFixed(1) + ' км' : Math.round(m) + ' м';
}

function updateNavigationProgress(lat, lng) {
  if (!S.routePoly) return;
  var user = L.latLng(lat, lng);
  var pts = S.routePoly.getLatLngs();
  if (!pts.length) return;

  // Find closest point
  var minD = Infinity, idx = 0;
  for (var i = 0; i < pts.length; i++) {
    var d = user.distanceTo(pts[i]);
    if (d < minD) { minD = d; idx = i; }
  }

  // Remaining distance
  var rem = 0;
  for (var j = idx; j < pts.length - 1; j++) rem += pts[j].distanceTo(pts[j + 1]);

  // Distance traveled from start
  var traveled = totalRouteDistance - rem;

  // Progress bar
  var progress = totalRouteDistance > 0 ? (traveled / totalRouteDistance) * 100 : 0;
  progress = Math.max(0, Math.min(100, progress));
  var progEl = gi('nav-progress-fill'); if (progEl) progEl.style.width = progress + '%';

  // Update ETA
  updateNavETA(rem);

  // Accuracy
  var accEl = gi('nav-accuracy');
  if (accEl) accEl.textContent = Math.round(lastGPS?.acc || 0) + 'м';

  // Turn instructions
  var turnIcon = gi('nav-turn-icon');
  var turnStreet = gi('nav-turn-street');
  var nextTurnEl = gi('nav-next-turn');

  if (minD > 100) {
    // Off route
    if (turnStreet) turnStreet.textContent = 'Отклонение от маршрута (' + Math.round(minD) + 'м)';
    if (turnIcon) turnIcon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>';
    if (nextTurnEl) nextTurnEl.classList.remove('visible');
    var topBar = gi('nav-top-bar'); if (topBar) topBar.style.background = '#b91c1c';
  } else if (rem < 25) {
    // Arrived
    if (turnStreet) turnStreet.textContent = 'Вие пристигнахте на желаната дестинация!';
    if (turnIcon) turnIcon.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>';
    if (nextTurnEl) nextTurnEl.classList.remove('visible');
    var topBar = gi('nav-top-bar'); if (topBar) topBar.style.background = '#059669';
    toast('🏁 Вие пристигнахте на желаната дестинация!');
    setTimeout(stopNavigation, 5000);
  } else {
    // Normal — find next turn
    var topBar = gi('nav-top-bar'); if (topBar) topBar.style.background = '#1a6b54';
    var nextTurn = null, afterTurn = null;
    for (var t = 0; t < navTurns.length; t++) {
      if (navTurns[t].distFromStart > traveled) {
        nextTurn = navTurns[t];
        if (t + 1 < navTurns.length) afterTurn = navTurns[t + 1];
        break;
      }
    }

    if (nextTurn) {
      var distToTurn = nextTurn.distFromStart - traveled;
      if (turnStreet) turnStreet.textContent = 'След ' + formatDist(distToTurn) + ' — ' + nextTurn.label;
      if (turnIcon) turnIcon.innerHTML = turnSVGs[nextTurn.icon] || turnSVGs['straight'];
      if (nextTurnEl && afterTurn) {
        nextTurnEl.classList.add('visible');
        nextTurnEl.textContent = 'След това ' + afterTurn.label;
      } else if (nextTurnEl) {
        nextTurnEl.classList.remove('visible');
      }
    } else {
      if (turnStreet) turnStreet.textContent = 'Продължете направо до дестинацията';
      if (turnIcon) turnIcon.innerHTML = turnSVGs['straight'];
      if (nextTurnEl) nextTurnEl.classList.remove('visible');
    }
  }
}

/* ── Map rotation ────────────────────────────────────────── */
function rotateMap(deg) {
  mapRotation = deg;
  var mapEl = document.getElementById('map');
  if (!mapEl) return;
  mapEl.style.transform = 'rotate(' + (-deg) + 'deg)';
  // Counter-rotate controls so they stay upright
  var controls = mapEl.querySelectorAll('.leaflet-control-container');
  controls.forEach(function(c) { c.style.transform = 'rotate(' + deg + 'deg)'; });
  // Counter-rotate markers
  if (userLocationMarker) {
    var el = userLocationMarker.getElement();
    if (el) el.style.transform = (el.style.transform || '').replace(/rotate\([^)]*\)/, '') + ' rotate(' + deg + 'deg)';
  }
}

function resetMapRotation() {
  mapRotation = 0;
  currentBearing = 0;
  prevGPS = null;
  var mapEl = document.getElementById('map');
  if (!mapEl) return;
  mapEl.style.transform = '';
  var controls = mapEl.querySelectorAll('.leaflet-control-container');
  controls.forEach(function(c) { c.style.transform = ''; });
  if (userLocationMarker) {
    var el = userLocationMarker.getElement();
    if (el) el.style.transform = el.style.transform.replace(/rotate\([^)]*\)/, '');
  }
}

/* ── Bottom sheet expand/collapse ────────────────────────── */
function setupSheetDrag() {
  var handle = gi('nav-sheet-handle');
  var sheet = gi('nav-bottom-sheet');
  if (!handle || !sheet) return;
  handle.onclick = function() {
    sheetExpanded = !sheetExpanded;
    sheet.classList.toggle('expanded', sheetExpanded);
  };
}

/* ═══════════════════════════════════════════════════════════
   STATUS BAR (native only)
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
  console.log('[EqualPath] initMobile — isNative:', isNative);
  configureStatusBar();

  var locBtn = gi('btn-locate-me'); if (locBtn) locBtn.addEventListener('click', locateMe);
  var gpsBtn = gi('btn-gps-start'); if (gpsBtn) gpsBtn.addEventListener('click', setStartFromGPS);
  var navBtn = gi('btn-start-nav'); if (navBtn) navBtn.addEventListener('click', startNavigation);
  var stopBtn = gi('btn-stop-nav'); if (stopBtn) stopBtn.addEventListener('click', stopNavigation);
  var recBtn = gi('btn-recenter'); if (recBtn) recBtn.addEventListener('click', recenterMap);

  if (isNative) {
    try {
      Capacitor.Plugins.App.addListener('backButton', function() {
        if (isNavigating) { stopNavigation(); return; }
        var sb = gi('sidebar');
        if (sb && sb.classList.contains('is-open')) { sb.classList.remove('is-open'); return; }
        var obs = gi('obs-overlay');
        if (obs && obs.classList.contains('is-open')) { closeObs(); return; }
        var auth = gi('auth-overlay');
        if (auth && auth.classList.contains('is-open')) { closeAuth(); return; }
        Capacitor.Plugins.App.minimizeApp();
      });
    } catch(e) {}
    setTimeout(startWatch, 1500);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMobile);
else initMobile();
