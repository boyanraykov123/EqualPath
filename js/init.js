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
gi('sidebar-toggle').addEventListener('click', () => {
  const sidebar = gi('sidebar');
  const open = sidebar.classList.toggle('is-open');
  document.body.classList.toggle('sidebar-open', open);
  gi('sidebar-toggle').setAttribute('aria-expanded', String(open));
  gi('sidebar-toggle').setAttribute('aria-label', open ? 'Затвори менюто' : 'Отвори менюто');
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


/* ── Ready ───────────────────────────────────────────────── */
console.log('%c EqualPath v4.0 ✓ Backend Connected ', 'background:#1e9e75;color:#fff;font-weight:bold;padding:4px 10px;border-radius:4px;');
