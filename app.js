const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const userPrompt = document.getElementById('userPrompt');
const quickActions = document.querySelectorAll('.quick-action');

const welcomeMessage = 'Welcome to the Library. What can I help you with today?';

const cannedReplies = [
  {
    match: /(event|week|calendar|author|workshop)/i,
    reply: 'This week the library is highlighting community events, author talks, and hands-on workshops. You could ask for adult programs, youth activities, or technology classes to narrow it down.'
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
    reply: 'The collection includes print books, ebooks, audiobooks, and special collections. If you want recommendations, tell me a genre or interest and I will suggest where to begin.'
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
}

function buildReply(prompt) {
  const found = cannedReplies.find((entry) => entry.match.test(prompt));
  if (found) {
    return found.reply;
  }

  return 'I can help with library collections, events, programs, and reference questions. Try asking about a book recommendation, this week\'s events, children\'s programming, or research support.';
}

function sendPrompt(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return;
  }

  addMessage('user', trimmed);
  addMessage('assistant', buildReply(trimmed));
}

if (chatWindow) {
  addMessage('assistant', welcomeMessage);
}

quickActions.forEach((button) => {
  button.addEventListener('click', () => {
    sendPrompt(button.textContent || '');
  });
});

if (chatForm) {
  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendPrompt(userPrompt.value);
    userPrompt.value = '';
  });
}
