const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const userPrompt = document.getElementById('userPrompt');
const quickActions = document.querySelectorAll('.quick-action');
const sendButton = chatForm ? chatForm.querySelector('button[type="submit"]') : null;
const statusPill = document.querySelector('.status-pill');

const welcomeMessage = 'Hello, I’m Pericles, the AI support client for Stapleton Public Library. What can I help you with today?';
const conversationHistory = [];
const MAX_HISTORY_MESSAGES = 12;
let isAwaitingReply = false;
let isLiveAiMode = false;

function updateStatusPill(mode) {
  if (!statusPill) {
    return;
  }

  if (mode === 'live') {
    statusPill.textContent = 'Pericles Ready';
    statusPill.classList.add('status-live');
    statusPill.classList.remove('status-fallback');
    return;
  }

  statusPill.textContent = 'Limited mode · AI unavailable';
  statusPill.classList.add('status-fallback');
  statusPill.classList.remove('status-live');
}

async function initializeChatMode() {
  try {
    const response = await (window.PericlesApi?.fetch || fetch)('/api/chat/status');
    if (!response.ok) {
      throw new Error('Health check failed');
    }

    const payload = await response.json();
    isLiveAiMode = payload.aiConfigured === true;
  } catch (_error) {
    isLiveAiMode = false;
  }

  updateStatusPill(isLiveAiMode ? 'live' : 'fallback');
}

function addMessage(role, text, sources = []) {
  const message = document.createElement('div');
  message.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  window.PericlesCitationRenderer.renderMessageContent(bubble, text, sources);

  message.appendChild(bubble);
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return bubble;
}

function updateBubbleText(bubble, text, sources = []) {
  if (!bubble) {
    return;
  }

  bubble.classList.remove('is-pending');
  bubble.removeAttribute('role');
  bubble.removeAttribute('aria-label');
  window.PericlesCitationRenderer.renderMessageContent(bubble, text, sources);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function buildReply(prompt) {
  if (/(book|catalog|collection|borrow|fiction)/i.test(prompt)) {
    return 'Live reference chat is unavailable. The Card Catalog remains available for checking the demonstration collection; it does not show current circulation status.';
  }
  if (/(research|reference|genealogy|database|citation|history|source)/i.test(prompt)) {
    return 'Live reference research is unavailable right now. Please try again later or visit the Research Help page for library research support.';
  }
  return 'Live chat is unavailable right now. Please try again later or browse the Stapleton Public Library pages using the navigation above.';
}

async function fetchAssistantReply(prompt) {
  const recentHistory = conversationHistory.slice(-10);
  const response = await (window.PericlesApi?.fetch || fetch)('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: prompt,
      history: recentHistory
    })
  });

  if (!response.ok) {
    let errorMessage = 'Chat request failed';
    try {
      const errorPayload = await response.json();
      if (typeof errorPayload.error === 'string') {
        errorMessage = errorPayload.error;
      }
    } catch (_error) {
      errorMessage = 'Chat request failed';
    }
    throw new Error(errorMessage);
  }

  const payload = await response.json();
  if (payload.fictionalCirculation || payload.fictionalServices) window.FictionalAccounts?.changed();
  else window.FictionalAccounts?.clearPreview();
  if (!payload.reply) {
    throw new Error('Chat response missing reply');
  }

  return {
    reply: payload.reply,
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    responseMode: payload.responseMode,
    notice: typeof payload.notice === 'string' ? payload.notice : ''
  };
}

function setChatPendingState(isPending) {
  isAwaitingReply = isPending;
  chatWindow?.setAttribute('aria-busy', String(isPending));
  quickActions.forEach(button => { button.disabled = isPending; });
  if (sendButton) {
    sendButton.disabled = isPending;
    sendButton.textContent = isPending ? 'Sending…' : 'Send';
  }

  if (userPrompt) {
    userPrompt.disabled = isPending;
  }
}

async function sendPrompt(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed || isAwaitingReply) {
    return;
  }

  addMessage('user', trimmed);
  conversationHistory.push({ role: 'user', content: trimmed });
  conversationHistory.splice(0, Math.max(0, conversationHistory.length - MAX_HISTORY_MESSAGES));

  const pendingBubble = addMessage('assistant', '');
  pendingBubble.classList.add('is-pending');
  pendingBubble.setAttribute('role', 'status');
  pendingBubble.setAttribute('aria-label', 'Pericles is responding');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'pending-dot';
    dot.setAttribute('aria-hidden', 'true');
    pendingBubble.appendChild(dot);
  }
  setChatPendingState(true);

  try {
    const assistantResult = await fetchAssistantReply(trimmed);
    isLiveAiMode = assistantResult.responseMode === 'ai';
    updateStatusPill(isLiveAiMode ? 'live' : 'fallback');
    updateBubbleText(pendingBubble, assistantResult.reply, assistantResult.sources);
    if (assistantResult.notice) {
      const notice = document.createElement('small');
      notice.className = 'response-notice';
      notice.textContent = assistantResult.notice;
      pendingBubble.appendChild(notice);
    }
    const sourceContext = assistantResult.sources
      .map((source) => `${source.title} ${source.url}`)
      .join('\n');
    conversationHistory.push({
      role: 'assistant',
      content: [assistantResult.reply, sourceContext].filter(Boolean).join('\n\n')
    });
    conversationHistory.splice(0, Math.max(0, conversationHistory.length - MAX_HISTORY_MESSAGES));
  } catch (error) {
    isLiveAiMode = false;
    updateStatusPill('fallback');
    const fallbackReply = error.message || buildReply(trimmed);
    updateBubbleText(pendingBubble, fallbackReply);
    conversationHistory.push({ role: 'assistant', content: fallbackReply });
    conversationHistory.splice(0, Math.max(0, conversationHistory.length - MAX_HISTORY_MESSAGES));
  } finally {
    setChatPendingState(false);
  }
}

if (chatWindow) {
  addMessage('assistant', welcomeMessage);
}

initializeChatMode();

quickActions.forEach((button) => {
  button.addEventListener('click', async () => {
    await sendPrompt(button.textContent || '');
  });
});

if (chatForm) {
  userPrompt?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!isAwaitingReply && userPrompt.value.trim()) chatForm.requestSubmit();
  });

  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendPrompt(userPrompt.value);
    userPrompt.value = '';
  });
}
