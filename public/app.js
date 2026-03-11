const authSection = document.getElementById('auth');
const chatSection = document.getElementById('chat');
const usernameInput = document.getElementById('username');
const spaceNameInput = document.getElementById('spaceName');
const passwordInput = document.getElementById('password');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const errorText = document.getElementById('error');
const spaceTitle = document.getElementById('spaceTitle');
const memberCount = document.getElementById('memberCount');
const messages = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');

let sessionToken = '';
let lastMessageId = 0;
let pollTimer = null;

function appendMessage(meta, text) {
  const item = document.createElement('li');
  const metaEl = document.createElement('span');
  metaEl.className = 'meta';
  metaEl.textContent = meta;
  item.append(metaEl, text);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

function showError(text = '') {
  errorText.textContent = text;
}

function setChatMode(spaceName) {
  authSection.classList.add('hidden');
  chatSection.classList.remove('hidden');
  spaceTitle.textContent = `Space: ${spaceName}`;
}

async function request(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || 'Request failed');
  }
  return body;
}

function getAuthPayload() {
  return {
    username: usernameInput.value.trim(),
    spaceName: spaceNameInput.value.trim(),
    password: passwordInput.value.trim()
  };
}

async function connectToSpace(endpoint) {
  try {
    showError('');
    const result = await request(endpoint, getAuthPayload());
    sessionToken = result.token;
    lastMessageId = 0;
    messages.innerHTML = '';
    setChatMode(result.spaceName);
    await pollState();
  } catch (error) {
    showError(error.message);
  }
}

async function pollState() {
  if (!sessionToken) return;

  try {
    const response = await fetch(`/api/state?token=${encodeURIComponent(sessionToken)}&since=${lastMessageId}`);
    const state = await response.json();
    if (!response.ok) {
      throw new Error(state.error || 'Failed to load updates');
    }

    memberCount.textContent = `${state.users.length} member${state.users.length === 1 ? '' : 's'} online`;
    state.messages.forEach((message) => {
      lastMessageId = Math.max(lastMessageId, message.id);
      if (message.type === 'chat') {
        const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        appendMessage(`${message.username} • ${time}`, message.text);
      } else {
        appendMessage('System', message.text);
      }
    });
  } catch (error) {
    showError(error.message);
  } finally {
    pollTimer = setTimeout(pollState, 1200);
  }
}

createBtn.addEventListener('click', () => connectToSpace('/api/create'));
joinBtn.addEventListener('click', () => connectToSpace('/api/join'));

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !sessionToken) return;

  try {
    await request('/api/send', { token: sessionToken, message: text });
    messageInput.value = '';
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    pollState();
  } catch (error) {
    showError(error.message);
  }
});
