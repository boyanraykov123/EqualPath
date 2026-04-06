/* ═══════════════════════════════════════════════════════════
   buddy.js — EqualPath Buddy System
   Заявки за помощ: създаване, преглед, приемане
   ═══════════════════════════════════════════════════════════ */

/* ── Open/Close modals ──────────────────────────────────── */
function openBuddyRequest() {
  if (!S.user) { showAuthGate(); return; }
  var fromEl = gi('br-from'), toEl = gi('br-to');
  if (fromEl) fromEl.value = gi('input-from')?.value || '';
  if (toEl) toEl.value = gi('input-to')?.value || '';
  var dateEl = gi('br-date');
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
  gi('buddy-req-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeBuddyRequest() {
  gi('buddy-req-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}

var buddyActiveTab = 'open';

function openBuddyBrowse() {
  if (!S.user) { showAuthGate(); return; }
  var isBuddy = S.user.role === 'buddy';
  var title = gi('buddy-browse-title');
  var sub = gi('buddy-browse-subtitle');
  var tabs = gi('buddy-tabs');
  if (title) title.textContent = isBuddy ? '💚 Заявки за помощ' : '🆘 Моите заявки';
  if (sub) sub.textContent = isBuddy ? 'Хора, които имат нужда от Buddy придружител.' : 'Твоите заявки за помощ от Buddy.';
  if (tabs) tabs.style.display = isBuddy ? 'flex' : 'none';
  buddyActiveTab = 'open';
  if (tabs) {
    tabs.querySelectorAll('.buddy-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === 'open'); });
  }
  gi('buddy-browse-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  loadBuddyRequests();
}

// Buddy tabs
document.addEventListener('click', function(e) {
  if (!e.target.classList.contains('buddy-tab')) return;
  buddyActiveTab = e.target.dataset.tab;
  document.querySelectorAll('.buddy-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === buddyActiveTab); });
  loadBuddyRequests();
});

function closeBuddyBrowse() {
  gi('buddy-browse-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}

/* ── Initialize custom pickers ───────────────────────────── */
var brCalendar = new EqCalendar('br-date');
var brTimePicker = new EqTimePicker('br-time');

/* ── Buddy request address autocomplete ─────────────────── */
/* ── Map pick for buddy request ──────────────────────────── */
var brPickTarget = null;
gi('br-pick-map').addEventListener('click', function() {
  brPickTarget = !gi('br-from').value ? 'br-from' : 'br-to';
  closeBuddyRequest();
  setPickMode(brPickTarget === 'br-from' ? 'from' : 'to');
  toast('Кликни на картата за ' + (brPickTarget === 'br-from' ? 'начална' : 'крайна') + ' точка');
  // Override map click to fill buddy fields
  var origHandler = null;
  function handleBuddyPick(e) {
    map.off('click', handleBuddyPick);
    var lat = e.latlng.lat, lng = e.latlng.lng;
    setPickMode(null);
    reverseGeocode(lat, lng).then(function(label) {
      gi(brPickTarget).value = label;
      gi(brPickTarget).classList.add('is-set');
      var clearId = brPickTarget === 'br-from' ? 'br-clear-from' : 'br-clear-to';
      gi(clearId).classList.add('visible');
      if (brPickTarget === 'br-from') {
        S.from = { lat: lat, lng: lng, label: label };
        setA([lat, lng], label);
        gi('input-from').value = label;
        gi('input-from').classList.add('is-set');
        gi('clear-from').classList.add('visible');
      } else {
        S.to = { lat: lat, lng: lng, label: label };
        setB([lat, lng], label);
        gi('input-to').value = label;
        gi('input-to').classList.add('is-set');
        gi('clear-to').classList.add('visible');
      }
      openBuddyRequest();
    });
  }
  // Small delay to let the modal close
  setTimeout(function() { map.once('click', handleBuddyPick); }, 300);
});

function setupBuddyGeo(inputId, spinnerId, dropdownId, clearId) {
  var input = gi(inputId);
  var spinner = gi(spinnerId);
  var dropdown = gi(dropdownId);
  var clearBtn = gi(clearId);
  var debounceTimer = null;

  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    if (q.length < 3) { dropdown.classList.remove('visible'); return; }
    spinner.classList.add('visible');
    debounceTimer = setTimeout(async function() {
      try {
        var resp = await fetch(NOM + '/search?format=json&q=' + encodeURIComponent(q) + '&limit=6&addressdetails=1&accept-language=bg', {
          headers: { 'User-Agent': 'EqualPath/1.0' }
        });
        var results = await resp.json();
        spinner.classList.remove('visible');
        if (!results.length) { dropdown.innerHTML = '<div class="geo-dropdown-empty">Няма резултати</div>'; dropdown.classList.add('visible'); return; }
        dropdown.innerHTML = '';
        results.forEach(function(r) {
          var item = document.createElement('div');
          item.className = 'geo-dropdown-item';
          var addr = r.address || {};
          var street = addr.road || addr.pedestrian || addr.footway || '';
          var number = addr.house_number || '';
          var name = r.display_name.split(',')[0];
          if (street && number) name = street + ' ' + number;
          else if (street) name = street;
          item.innerHTML = '<span class="geo-item-icon">📍</span><div><div class="geo-item-name">' + esc(name) + '</div><div class="geo-item-addr">' + esc(r.display_name.substring(0, 80)) + '</div></div>';
          item.addEventListener('click', function() {
            input.value = r.display_name;
            input.classList.add('is-set');
            clearBtn.classList.add('visible');
            dropdown.classList.remove('visible');
          });
          dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
      } catch(e) {
        spinner.classList.remove('visible');
      }
    }, 400);
  });

  clearBtn.addEventListener('click', function() {
    input.value = '';
    input.classList.remove('is-set');
    clearBtn.classList.remove('visible');
    dropdown.classList.remove('visible');
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!dropdown.contains(e.target) && e.target !== input) dropdown.classList.remove('visible');
  });
}

setupBuddyGeo('br-from', 'br-spinner-from', 'br-dropdown-from', 'br-clear-from');
setupBuddyGeo('br-to', 'br-spinner-to', 'br-dropdown-to', 'br-clear-to');

/* ── Event listeners ────────────────────────────────────── */
gi('btn-buddy-request').addEventListener('click', openBuddyRequest);
gi('btn-buddy-browse').addEventListener('click', openBuddyBrowse);
gi('btn-buddy-my').addEventListener('click', openBuddyBrowse);
gi('buddy-req-close').addEventListener('click', closeBuddyRequest);
gi('buddy-browse-close').addEventListener('click', closeBuddyBrowse);
gi('buddy-req-overlay').addEventListener('click', function(e) { if (e.target === gi('buddy-req-overlay')) closeBuddyRequest(); });
gi('buddy-browse-overlay').addEventListener('click', function(e) { if (e.target === gi('buddy-browse-overlay')) closeBuddyBrowse(); });

/* ── Submit buddy request ───────────────────────────────── */
gi('buddy-req-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  clrE('br-err');
  var from = gi('br-from').value.trim();
  var to = gi('br-to').value.trim();
  var date = gi('br-date').dataset.isoValue || gi('br-date').value;
  var time = gi('br-time').value;
  var note = gi('br-note').value.trim();

  if (!from || !to) { shwE('br-err', 'Въведи начална и крайна точка.'); return; }
  if (!date) { shwE('br-err', 'Избери дата.'); return; }

  var btn = gi('br-submit');
  btn.disabled = true; btn.textContent = '⏳ Изпраща...';

  try {
    var resp = await fetch(API_BASE + '/api/buddy-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: S.user.id, user_name: S.user.name,
        start_location: from, end_location: to,
        start_coords: S.from || {}, end_coords: S.to || {},
        date: date, time: time || '', note: note,
        profile: S.user.profile || 'general',
      }),
    });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    closeBuddyRequest();
    toast('🤝 Заявката е изпратена!');
    gi('br-note').value = '';
  } catch (err) {
    shwE('br-err', err.message || 'Грешка при изпращане.');
  } finally {
    btn.disabled = false; btn.textContent = '📤 Изпрати заявка';
  }
});

/* ── Render a single buddy card ─────────────────────────── */
function renderBuddyCard(req, context) {
  var profileIcons = { wheelchair: '♿', autism: '🧠', stroller: '👨‍👩‍👧‍👦', general: '🚶' };
  var profileIcon = profileIcons[req.profile] || '🚶';
  var isOwn = S.user && req.user_id === S.user.id;
  var isBuddy = S.user && S.user.role === 'buddy';
  var isAccepted = req.status === 'accepted';

  var statusHTML = '';
  if (isAccepted) {
    var who = isOwn ? req.buddy_name : req.user_name;
    var phoneHTML = '';
    if (isOwn && req.buddy_phone) {
      phoneHTML = '<div class="buddy-status-phone"><a href="tel:' + esc(req.buddy_phone) + '">📞 ' + esc(req.buddy_phone) + '</a></div>';
    }
    statusHTML =
      '<div class="buddy-status accepted">' +
        '<div class="buddy-status-icon">✅</div>' +
        '<div class="buddy-status-body">' +
          '<div class="buddy-status-title">Приета!</div>' +
          '<div class="buddy-status-detail">' +
            (isOwn
              ? '💚 ' + esc(req.buddy_name || 'Buddy') + ' ще те придружи'
              : '🤝 Ще придружиш ' + esc(req.user_name)) +
          '</div>' +
          phoneHTML +
        '</div>' +
      '</div>';
  }

  var isCompleted = req.status === 'completed';
  var actionsHTML = '';
  if (isCompleted) {
    actionsHTML = '<span class="buddy-completed-label">✅ Завършена</span>';
  } else if (isAccepted) {
    if (isOwn) {
      actionsHTML = '<span class="buddy-card-hint">💚 Buddy ще те намери на ' + esc(req.date) + '</span>';
    } else {
      // Buddy sees complete + delete
      actionsHTML =
        '<button class="buddy-btn buddy-btn-complete" data-id="' + req.id + '">✅ Завършена</button>' +
        '<button class="buddy-btn buddy-btn-del" data-id="' + req.id + '">🗑️</button>';
    }
  } else {
    if (isOwn) {
      actionsHTML = '<button class="buddy-btn buddy-btn-del" data-id="' + req.id + '">🗑️ Изтрий</button>';
    } else if (isBuddy) {
      actionsHTML = '<button class="buddy-btn buddy-btn-accept" data-id="' + req.id + '">💚 Приемам — ще помогна!</button>';
    }
  }

  var card = document.createElement('div');
  card.className = 'buddy-card' + (isAccepted ? ' buddy-card-accepted' : '') + (isCompleted ? ' buddy-card-completed' : '');
  card.innerHTML =
    '<div class="buddy-card-header">' +
      '<div class="buddy-card-avatar">' + profileIcon + '</div>' +
      '<div class="buddy-card-info">' +
        '<div class="buddy-card-name">' + esc(req.user_name) + '</div>' +
        '<div class="buddy-card-date">📅 ' + esc(req.date) + (req.time ? ' · 🕐 ' + esc(req.time) : '') + '</div>' +
      '</div>' +
      (isAccepted ? '<div class="buddy-accepted-badge">Приета</div>' : '') +
    '</div>' +
    statusHTML +
    '<div class="buddy-card-route">' +
      '<div class="buddy-route-point"><span class="buddy-dot buddy-dot-a"></span>' + esc(req.start_location) + '</div>' +
      '<div class="buddy-route-line"></div>' +
      '<div class="buddy-route-point"><span class="buddy-dot buddy-dot-b"></span>' + esc(req.end_location) + '</div>' +
    '</div>' +
    (req.note ? '<div class="buddy-card-note">"' + esc(req.note) + '"</div>' : '') +
    (actionsHTML ? '<div class="buddy-card-actions">' + actionsHTML + '</div>' : '');

  return card;
}

/* ── Load buddy requests ────────────────────────────────── */
async function loadBuddyRequests() {
  var list = gi('buddy-list');
  list.innerHTML = '<div class="buddy-loading"><div class="buddy-loading-spinner"></div>Зарежда...</div>';

  try {
    var isBuddy = S.user && S.user.role === 'buddy';
    var results = [];

    if (isBuddy) {
      if (buddyActiveTab === 'open') {
        var resp1 = await fetch(API_BASE + '/api/buddy-requests');
        var data1 = await resp1.json();
        if (data1.ok) results = data1.requests || [];
      } else {
        // Accepted or history — load buddy's requests
        var resp2 = await fetch(API_BASE + '/api/buddy-requests/user/' + S.user.id);
        var data2 = await resp2.json();
        if (data2.ok) {
          var accepted = data2.accepted || [];
          var today = new Date().toISOString().split('T')[0];
          if (buddyActiveTab === 'accepted') {
            results = accepted.filter(function(r) { return r.status === 'accepted'; });
          } else {
            results = accepted.filter(function(r) { return r.status === 'completed' || r.date < today; });
          }
        }
      }
    } else {
      var resp = await fetch(API_BASE + '/api/buddy-requests/user/' + S.user.id);
      var data = await resp.json();
      if (data.ok) results = data.my_requests || [];
    }

    if (!results.length) {
      list.innerHTML =
        '<div class="buddy-empty">' +
          '<div class="buddy-empty-icon">' + (isBuddy ? '💚' : '🤷') + '</div>' +
          '<p>' + (isBuddy ? 'Няма активни заявки за помощ.' : 'Нямаш заявки за помощ.') + '</p>' +
          '<p style="font-size:.78rem;color:var(--ink-faint)">' +
            (isBuddy ? 'Когато някой има нужда от Buddy, ще се появи тук.' : 'Натисни "Имам нужда от Buddy" за да създадеш заявка.') +
          '</p>' +
        '</div>';
      return;
    }

    list.innerHTML = '';

    // Sort: accepted first, then by date
    results.sort(function(a, b) {
      if (a.status === 'accepted' && b.status !== 'accepted') return -1;
      if (b.status === 'accepted' && a.status !== 'accepted') return 1;
      return (a.date || '').localeCompare(b.date || '');
    });

    results.forEach(function(req) {
      var card = renderBuddyCard(req);
      list.appendChild(card);
    });

    // Attach events
    list.querySelectorAll('.buddy-btn-accept').forEach(function(btn) {
      btn.addEventListener('click', function() { acceptBuddyRequest(btn.dataset.id); });
    });
    list.querySelectorAll('.buddy-btn-complete').forEach(function(btn) {
      btn.addEventListener('click', function() { completeBuddyRequest(btn.dataset.id); });
    });
    list.querySelectorAll('.buddy-btn-del').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteBuddyRequest(btn.dataset.id, btn.closest('.buddy-card')); });
    });

  } catch (err) {
    list.innerHTML = '<p style="font-size:.85rem;color:var(--red);text-align:center;padding:2rem 0">Грешка: ' + esc(err.message) + '</p>';
  }
}

/* ── Accept buddy request ───────────────────────────────── */
async function acceptBuddyRequest(id) {
  if (!S.user) { showAuthGate(); return; }
  try {
    var resp = await fetch(API_BASE + '/api/buddy-requests/' + id + '/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buddy_id: S.user.id, buddy_name: S.user.name, buddy_phone: S.user.phone || '' }),
    });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    toast('💚 Прие заявката! Благодарим ти!');
    loadBuddyRequests();
  } catch (err) {
    toast('Грешка: ' + (err.message || 'Опитай пак'));
  }
}

/* ── Complete buddy request ──────────────────────────────── */
async function completeBuddyRequest(id) {
  try {
    var resp = await fetch(API_BASE + '/api/buddy-requests/' + id + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    toast('✅ Заявката е маркирана като завършена!');
    loadBuddyRequests();
  } catch (err) {
    toast('Грешка: ' + (err.message || 'Опитай пак'));
  }
}

/* ── Delete buddy request ───────────────────────────────── */
async function deleteBuddyRequest(id, cardEl) {
  try {
    var resp = await fetch(API_BASE + '/api/buddy-requests/' + id, { method: 'DELETE' });
    var data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    if (cardEl) cardEl.remove();
    toast('Заявката е изтрита.');
    // Check if list is empty
    var list = gi('buddy-list');
    if (list && !list.querySelector('.buddy-card')) {
      list.innerHTML = '<div class="buddy-empty"><div class="buddy-empty-icon">🤷</div><p>Нямаш заявки за помощ.</p></div>';
    }
  } catch (err) {
    toast('Грешка: ' + (err.message || 'Опитай пак'));
  }
}
