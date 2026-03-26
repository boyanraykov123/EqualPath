/* ═══════════════════════════════════════════════════════════
   ai-assistant.js — EqualPath
   AI чат панел + гласов вход (Web Speech API)
   ═══════════════════════════════════════════════════════════ */

/* ── Отваряне / затваряне ────────────────────────────────── */
gi('ai-fab').addEventListener('click', () => {
  gi('ai-panel').classList.toggle('is-open');
});

gi('ai-panel-close').addEventListener('click', () => {
  gi('ai-panel').classList.remove('is-open');
});


/* ── Изпращане на съобщение ──────────────────────────────── */
async function sendAiMessage(text) {
  if (!text.trim()) return;
  const msgs = gi('ai-messages');

  // Потребителско съобщение
  const uDiv = document.createElement('div');
  uDiv.className = 'ai-msg user';
  uDiv.textContent = text;
  msgs.appendChild(uDiv);
  gi('ai-input').value = '';
  msgs.scrollTop = msgs.scrollHeight;

  // Typing индикатор
  const tDiv = document.createElement('div');
  tDiv.className = 'ai-msg bot typing';
  tDiv.textContent = 'Мисля...';
  msgs.appendChild(tDiv);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const resp = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await resp.json();
    tDiv.classList.remove('typing');
    tDiv.textContent = json.ok ? json.reply : 'Грешка при отговора.';
  } catch {
    tDiv.classList.remove('typing');
    tDiv.textContent = 'Не мога да се свържа с AI сървъра.';
  }
  msgs.scrollTop = msgs.scrollHeight;
}

gi('ai-send').addEventListener('click', () => sendAiMessage(gi('ai-input').value));
gi('ai-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(gi('ai-input').value); }
});


/* ── Гласов вход (Web Speech API) ────────────────────────── */
let aiRecognition = null;

gi('ai-mic').addEventListener('click', () => {
  const mic = gi('ai-mic');
  if (aiRecognition) { aiRecognition.stop(); return; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Браузърът не поддържа гласов вход.'); return; }

  aiRecognition = new SR();
  aiRecognition.lang = 'bg-BG';
  aiRecognition.interimResults = false;
  aiRecognition.continuous = false;
  mic.classList.add('recording');
  mic.textContent = '🔴';

  aiRecognition.onresult = (ev) => {
    const text = ev.results[0][0].transcript;
    gi('ai-input').value = text;
    sendAiMessage(text);
  };

  aiRecognition.onend = () => {
    mic.classList.remove('recording');
    mic.textContent = '🎤';
    aiRecognition = null;
  };

  aiRecognition.onerror = (ev) => {
    console.warn('Speech error:', ev.error);
    if (ev.error === 'not-allowed') toast('Разреши достъп до микрофона.');
    mic.classList.remove('recording');
    mic.textContent = '🎤';
    aiRecognition = null;
  };

  aiRecognition.start();
});