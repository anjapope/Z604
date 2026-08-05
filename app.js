const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const userPrompt = document.getElementById('userPrompt');
const quickActions = document.querySelectorAll('.quick-action');
const sendButton = chatForm ? chatForm.querySelector('button[type="submit"]') : null;
const statusPill = document.querySelector('.status-pill');

const welcomeMessage = 'Welcome to the Library. What can I help you with today?';
const conversationHistory = [];
let isAwaitingReply = false;
let isLiveAiMode = false;

function updateStatusPill(mode) {
  if (!statusPill) {
    return;
  }

  if (mode === 'live') {
    statusPill.textContent = 'Live AI';
    statusPill.classList.add('status-live');
    statusPill.classList.remove('status-fallback');
    return;
  }

  statusPill.textContent = 'Fallback Mode';
  statusPill.classList.add('status-fallback');
  statusPill.classList.remove('status-live');
}

async function initializeChatMode() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) {
      throw new Error('Health check failed');
    }

    const payload = await response.json();
    isLiveAiMode = Boolean(payload.liveAiConfigured);
  } catch (_error) {
    isLiveAiMode = false;
  }

  updateStatusPill(isLiveAiMode ? 'live' : 'fallback');
}

const cannedReplies = [
  {
    match: /(event|week|calendar|author|workshop)/i,
    reply: 'This week the library is highlighting community events, author talks, and hands-on workshops. Open the Events page for the full calendar view, or ask for adult programs, youth activities, or technology classes to narrow it down.'
  },
  {
    match: /(program|children|kids|teen|story)/i,
    reply: 'Our programs include story times, teen maker activities, and lifelong learning workshops for adults. Tell me the age group or topic you want, and I can guide you to a good fit.'
  },
  {
    match: /(research|reference|genealogy|database|citation|history)/i,
    reply: 'For research help, the library can connect you with databases, citation support, local history tools, and genealogy resources. If you share your topic, I can suggest a starting point.'
  },
  {
    match: /(book|catalog|collection|borrow|recommend)/i,
    reply: 'The collection includes print books, ebooks, audiobooks, and media. You can browse the classroom Card Catalog page for full entries, or tell me a genre and I can suggest where to begin.'
  }
];

function addMessage(role, text) {
  const message = document.createElement('div');
  message.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  message.appendChild(bubble);
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  return bubble;
}

function updateBubbleText(bubble, text) {
  if (!bubble) {
    return;
  }

  bubble.textContent = text;
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function buildReply(prompt) {
  const found = cannedReplies.find((entry) => entry.match.test(prompt));
  if (found) {
    return found.reply;
  }

  return 'I can help with library collections, events, programs, and reference questions. Try asking about a book recommendation, this week\'s events, children\'s programming, or research support.';
}

async function fetchAssistantReply(prompt) {
  const recentHistory = conversationHistory.slice(-10);
  const response = await fetch('/api/chat', {
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
    throw new Error('Chat request failed');
  }

  const payload = await response.json();
  if (!payload.reply) {
    throw new Error('Chat response missing reply');
  }

  return payload.reply;
}

function setChatPendingState(isPending) {
  isAwaitingReply = isPending;
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

  const pendingBubble = addMessage('assistant', 'Thinking...');
  setChatPendingState(true);

  try {
    const assistantReply = await fetchAssistantReply(trimmed);
    isLiveAiMode = true;
    updateStatusPill('live');
    updateBubbleText(pendingBubble, assistantReply);
    conversationHistory.push({ role: 'assistant', content: assistantReply });
  } catch (error) {
    isLiveAiMode = false;
    updateStatusPill('fallback');
    const fallbackReply = `${buildReply(trimmed)}\n\n(Demo fallback: live chat service unavailable.)`;
    updateBubbleText(pendingBubble, fallbackReply);
    conversationHistory.push({ role: 'assistant', content: fallbackReply });
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
  chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendPrompt(userPrompt.value);
    userPrompt.value = '';
  });
}
