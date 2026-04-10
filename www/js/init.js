/* ═══════════════════════════════════════════════════════════
   init.js — EqualPath
   Инициализация: сесия, health check, restore, toggles, ESC
   ═══════════════════════════════════════════════════════════ */

/* ── Автоматично възстановяване на сесия + маршрут ─────────── */
(async () => {
  // 1. Възстанови Supabase сесия
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    const userId = session.user.id;
    const meta = session.user.user_metadata || {};
    const { data: prof } = await sb.from('profiles').select('*').eq('user_id', userId).single();
    const user = {
      id: userId,
      name: prof?.full_name || meta.full_name || session.user.email.split('@')[0],
      email: session.user.email,
      profile: meta.profile || ((prof?.health_needs?.length) ? prof.health_needs[0] : 'general'),
      needs: prof?.health_needs || meta.health_needs || [],
      role: prof?.role || meta.role || 'user',
      phone: prof?.phone || meta.phone || '',
    };
    logIn(user);
  }

  // 2. Възстанови маршрут от sessionStorage (след logIn, за да не се изтрие)
  try {
    const saved = sessionStorage.getItem('eq_route');
    if (saved) {
      const { data, from, to, fromName, toName } = JSON.parse(saved);
      if (data && from && to) {
        S.from = from;
        S.to = to;
        if (fromName) {
          gi('input-from').value = fromName;
          gi('input-from').classList.add('is-set');
          gi('clear-from').classList.add('visible');
        }
        if (toName) {
          gi('input-to').value = toName;
          gi('input-to').classList.add('is-set');
          gi('clear-to').classList.add('visible');
        }
        setA([from.lat, from.lng], fromName || 'Start');
        setB([to.lat, to.lng], toName || 'End');
        renderRoute(data);
      }
    }
  } catch (e) { console.warn('Route restore failed:', e); }
})();


/* Backend health check removed: AI status element hidden — no DOM updates performed */


/* ── Зареждане на препятствия от DB ──────────────────────── */
loadObstaclesFromDB();


/* ── Global ESC ──────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (gi('obs-overlay').classList.contains('is-open')) closeObs();
  else if (gi('auth-overlay').classList.contains('is-open')) closeAuth();
  else if (S.pickMode) setPickMode(null);
});


/* ── Sidebar toggle (mobile) ─────────────────────────────── */
function closeSidebar() {
  const sidebar = gi('sidebar');
  sidebar.classList.remove('is-open');
  document.body.classList.remove('sidebar-open');
  gi('sidebar-toggle').setAttribute('aria-expanded', 'false');
  gi('sidebar-toggle').setAttribute('aria-label', 'Отвори менюто');
}

gi('sidebar-toggle').addEventListener('click', () => {
  const sidebar = gi('sidebar');
  const open = sidebar.classList.toggle('is-open');
  document.body.classList.toggle('sidebar-open', open);
  gi('sidebar-toggle').setAttribute('aria-expanded', String(open));
  gi('sidebar-toggle').setAttribute('aria-label', open ? 'Затвори менюто' : 'Отвори менюто');
});

// Close sidebar by tapping map area on mobile
gi('map-wrapper').addEventListener('click', (e) => {
  const sidebar = gi('sidebar');
  if (sidebar.classList.contains('is-open') && window.innerWidth <= 768) {
    closeSidebar();
  }
});


/* ── PW toggle бутони ────────────────────────────────────── */
function mkPwToggle(inputId, btnId) {
  gi(btnId).addEventListener('click', () => {
    const inp = gi(inputId);
    if (inp.type === 'password') { inp.type = 'text'; gi(btnId).textContent = '🙈'; }
    else { inp.type = 'password'; gi(btnId).textContent = '👁'; }
  });
}
mkPwToggle('login-pw', 'toggle-login-pw');
mkPwToggle('reg-pw', 'toggle-reg-pw');


/* ── Password recovery handler ──────────────────────────── */
var _recoveryHandled = false;
sb.auth.onAuthStateChange(function(event, session) {
  if (event !== 'PASSWORD_RECOVERY' || _recoveryHandled) return;
  _recoveryHandled = true;

  // Clear URL hash
  history.replaceState(null, '', window.location.pathname);

  // Hide any logged-in UI without signing out (we need the session to change password)
  gi('btn-login').style.display = 'flex';
  gi('user-chip').style.display = 'none';
  gi('profile-user-banner').classList.remove('vis');
  gi('user-menu').style.display = 'none';

  // Show password reset form
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay is-open';
  overlay.style.zIndex = '99999';
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:400px;padding:2rem">' +
      '<h2 class="modal-title">🔒 Нова парола</h2>' +
      '<p class="modal-subtitle">Въведи новата си парола по-долу.</p>' +
      '<div style="display:flex;flex-direction:column;gap:.75rem">' +
        '<div><label class="form-label">Нова парола</label>' +
        '<input type="password" id="recovery-pw" class="form-input" placeholder="Мин. 8 символа"/></div>' +
        '<div><label class="form-label">Потвърди паролата</label>' +
        '<input type="password" id="recovery-pw2" class="form-input" placeholder="Повтори паролата"/></div>' +
        '<p class="form-error" id="recovery-err"></p>' +
        '<button class="btn-full" id="recovery-submit">Запази новата парола</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  gi('recovery-submit').addEventListener('click', async function() {
    var pw = gi('recovery-pw').value;
    var pw2 = gi('recovery-pw2').value;
    clrE('recovery-err');
    if (pw.length < 8) { shwE('recovery-err', 'Паролата трябва да е поне 8 символа.'); return; }
    if (pw !== pw2) { shwE('recovery-err', 'Паролите не съвпадат.'); return; }

    gi('recovery-submit').disabled = true;
    gi('recovery-submit').textContent = 'Запазва...';

    try {
      // Session is still active from PASSWORD_RECOVERY event — just update
      var result = await sb.auth.updateUser({ password: pw });
      if (result.error) throw result.error;
      await sb.auth.signOut();
      S.user = null;
      overlay.remove();
      toast('✅ Паролата е сменена! Влез с новата парола.');
    } catch(err) {
      shwE('recovery-err', err.message || 'Грешка при смяна.');
      gi('recovery-submit').disabled = false;
      gi('recovery-submit').textContent = 'Запази новата парола';
    }
  });
});

/* ── Ready ───────────────────────────────────────────────── */
console.log('%c EqualPath v4.0 ✓ Backend Connected ', 'background:#1e9e75;color:#fff;font-weight:bold;padding:4px 10px;border-radius:4px;');
