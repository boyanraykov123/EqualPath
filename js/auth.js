/* ═══════════════════════════════════════════════════════════
   auth.js — EqualPath
   Автентикация: вход, регистрация, auth gate, logIn/logOut
   ═══════════════════════════════════════════════════════════ */

/* ── Auth Gate (за нелогнати потребители) ─────────────────── */
function showAuthGate() {
  let overlay = gi('auth-gate-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'auth-gate-overlay';
    overlay.innerHTML = `
      <div class="auth-gate-card">
        <div class="auth-gate-icon">🔒</div>
        <h3 class="auth-gate-title">Влез в профила си</h3>
        <p class="auth-gate-desc">За да докладваш или премахваш препятствия, трябва да имаш профил.</p>
        <button class="auth-gate-btn auth-gate-login" id="ag-login">Вход</button>
        <button class="auth-gate-btn auth-gate-register" id="ag-register">Създай профил</button>
        <button class="auth-gate-close" id="ag-close">Не сега</button>
      </div>`;
    document.body.appendChild(overlay);
    gi('ag-login').addEventListener('click', () => { overlay.classList.remove('is-open'); openAuth('login'); });
    gi('ag-register').addEventListener('click', () => { overlay.classList.remove('is-open'); openAuth('register'); });
    gi('ag-close').addEventListener('click', () => overlay.classList.remove('is-open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });
  }
  overlay.classList.add('is-open');
}


/* ── Auth модал ──────────────────────────────────────────── */
const UK = 'ep_users_v1';
const getUsers = () => { try { return JSON.parse(localStorage.getItem(UK) || '[]'); } catch { return []; } };
const saveUsers = u => localStorage.setItem(UK, JSON.stringify(u));

function openAuth(tab = 'login') {
  gi('auth-overlay').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  switchTab(tab);
}

function closeAuth() {
  gi('auth-overlay').classList.remove('is-open');
  document.body.style.overflow = '';
}

gi('btn-login').addEventListener('click', () => openAuth('login'));
gi('auth-close-x').addEventListener('click', closeAuth);
gi('auth-overlay').addEventListener('click', e => { if (e.target === gi('auth-overlay')) closeAuth(); });


/* ── Табове ───────────────────────────────────────────────── */
function switchTab(t) {
  gi('tab-login').classList.toggle('active', t === 'login');
  gi('tab-register').classList.toggle('active', t === 'register');
  gi('panel-login').classList.toggle('active', t === 'login');
  gi('panel-register').classList.toggle('active', t === 'register');
  if (t === 'register') showStep(1);
}
gi('tab-login').addEventListener('click', () => switchTab('login'));
gi('tab-register').addEventListener('click', () => switchTab('register'));
gi('to-register').addEventListener('click', () => switchTab('register'));
gi('to-login').addEventListener('click', () => switchTab('login'));


/* ── Вход (Login) ────────────────────────────────────────── */
gi('btn-do-login').addEventListener('click', async () => {
  const email = gi('login-email').value.trim(), pw = gi('login-pw').value;
  clrE('login-email-err'); clrE('login-pw-err'); clrE('login-gen-err');
  let ok = true;
  if (!email || !email.includes('@')) { shwE('login-email-err', 'Невалиден имейл.'); ok = false; }
  if (!pw) { shwE('login-pw-err', 'Въведи парола.'); ok = false; }
  if (!ok) return;

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) throw error;

    const userId = data.user.id;
    const meta = data.user.user_metadata || {};

    const { data: prof } = await sb.from('profiles').select('*').eq('user_id', userId).single();
    const user = {
      id: userId,
      name: prof?.full_name || meta.full_name || email.split('@')[0],
      email,
      profile: meta.profile || ((prof?.health_needs?.length) ? prof.health_needs[0] : 'general'),
      needs: prof?.health_needs || meta.health_needs || [],
    };
    logIn(user);
    closeAuth();
    toast(`👋 Добре дошъл, ${user.name}!`);
  } catch (err) {
    console.error('Login error:', err);
    shwE('login-gen-err', err.message || '⚠️ Грешен имейл или парола.');
  }
});


/* ── Регистрация (стъпки) ────────────────────────────────── */
let regStep = 1;

function showStep(n) {
  regStep = n;
  document.querySelectorAll('.onboarding-step').forEach((s, i) => s.classList.toggle('active', i === n - 1));
  ['sd1', 'sd2', 'sd3'].forEach((id, i) => {
    const el = gi(id);
    el.classList.toggle('active', i === n - 1);
    el.classList.toggle('done', i < n - 1);
  });
  gi('step-lbl').textContent = `Стъпка ${n} от 3`;
}

gi('reg-next-1').addEventListener('click', () => {
  const name = gi('reg-name').value.trim(), email = gi('reg-email').value.trim(), pw = gi('reg-pw').value;
  clrE('reg-name-err'); clrE('reg-email-err'); clrE('reg-pw-err'); clrE('reg-s1-err');
  let ok = true;
  if (!name) { shwE('reg-name-err', 'Въведи твоето иme.'); ok = false; }
  if (!email || !email.includes('@')) { shwE('reg-email-err', 'Невалиден имейл.'); ok = false; }
  if (pw.length < 8) { shwE('reg-pw-err', 'Паролата трябва да е поне 8 символа.'); ok = false; }
  if (ok) showStep(2);
});

gi('reg-back-2').addEventListener('click', () => showStep(1));
gi('reg-next-2').addEventListener('click', () => showStep(3));
gi('reg-back-3').addEventListener('click', () => showStep(2));

gi('btn-do-register').addEventListener('click', async () => {
  const btn = gi('btn-do-register');
  btn.disabled = true;
  btn.textContent = '⏳ Запазва...';

  const name    = gi('reg-name').value.trim();
  const email   = gi('reg-email').value.trim();
  const pw      = gi('reg-pw').value;
  const profile = document.querySelector('input[name="reg-profile"]:checked')?.value ?? 'general';
  const needs   = [...document.querySelectorAll('input[name="reg-needs"]:checked')].map(c => c.value);
  const notes   = gi('reg-notes').value.trim();

  try {
    // 1. Supabase Auth signup
    const { data: authData, error: authErr } = await sb.auth.signUp({
      email, password: pw,
      options: { data: { full_name: name, profile, health_needs: needs } }
    });
    if (authErr) throw authErr;
    if (!authData.user) throw new Error('Регистрацията не върна потребител.');

    const userId = authData.user.id;

    // 2. Профил в profiles таблицата
    const { error: profErr } = await sb.from('profiles').insert({
      user_id: userId,
      full_name: name,
      health_needs: needs,
    });
    if (profErr) console.warn('Profile insert note:', profErr.message);

    // 3. logIn локално
    const newUser = { id: userId, name, email, profile, needs, notes };
    logIn(newUser);
    closeAuth();
    toast(`🎉 Профилът е създаден! Добре дошъл, ${name}!`);
  } catch (err) {
    console.error('Register error:', err);
    const errEl = document.querySelector('.onboarding-step.active .form-error') || gi('reg-s1-err');
    if (errEl) { errEl.textContent = err.message || 'Грешка при регистрация.'; errEl.classList.add('vis'); }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✅ Готово!';
  }
});



/* ── logIn / logOut ──────────────────────────────────────── */
function logIn(user) {
  S.user = user;
  const prof = user.profile ?? 'general';
  const r = document.querySelector(`input[name="user-profile"][value="${prof}"]`);
  if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }

  // header
  gi('btn-login').style.display = 'none';
  const uc = gi('user-chip');
  uc.style.display = 'flex';
  gi('uc-icon').textContent = PICONS[prof] || '🚶';
  gi('uc-name').textContent = user.name.split(' ')[0];
  gi('um-name').textContent = user.name;
  gi('um-email').textContent = user.email;

  // sidebar banner
  const b = gi('profile-user-banner');
  b.classList.add('vis');
  gi('pub-av').textContent = PICONS[prof] || '🚶';
  gi('pub-nm').textContent = user.name;
  gi('pub-pr').textContent = PLABELS[prof] || '';

  // load search history
  if (user.id) loadHistory(user.id);
}

gi('btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
  S.user = null;
  gi('btn-login').style.display = 'flex';
  gi('user-chip').style.display = 'none';
  gi('profile-user-banner').classList.remove('vis');
  gi('user-menu').style.display = 'none';
  gi('history-list').innerHTML = '<div id="history-empty" style="font-size:.75rem;color:var(--ink-muted);padding:.25rem 0">Няма търсения.</div>';
  toast('Излязохте от профила.');
});
