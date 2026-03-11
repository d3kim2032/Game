const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const publicDir = path.join(__dirname, 'public');
const spaces = new Map();
const sessions = new Map();

function sanitize(value) {
  return String(value || '').trim();
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function ensureSpace(name, password) {
  if (!spaces.has(name)) {
    spaces.set(name, { name, password, users: new Map(), messages: [] });
  }
  return spaces.get(name);
}

function postMessage(space, type, text, username = 'System') {
  const id = space.messages.length + 1;
  space.messages.push({ id, type, text, username, timestamp: new Date().toISOString() });
}

function handleCreate(body, res) {
  const spaceName = sanitize(body.spaceName);
  const password = sanitize(body.password);
  const username = sanitize(body.username);

  if (!spaceName || !password || !username) {
    return sendJson(res, 400, { error: 'Space name, password, and username are required.' });
  }

  if (spaces.has(spaceName)) {
    return sendJson(res, 409, { error: 'That space already exists.' });
  }

  const space = ensureSpace(spaceName, password);
  const token = createToken();
  space.users.set(token, username);
  sessions.set(token, { token, spaceName, username });
  postMessage(space, 'system', `${username} created and joined the space.`);
  return sendJson(res, 201, { token, spaceName, username });
}

function handleJoin(body, res) {
  const spaceName = sanitize(body.spaceName);
  const password = sanitize(body.password);
  const username = sanitize(body.username);

  if (!spaceName || !password || !username) {
    return sendJson(res, 400, { error: 'Space name, password, and username are required.' });
  }

  const space = spaces.get(spaceName);
  if (!space) {
    return sendJson(res, 404, { error: 'Space not found.' });
  }
  if (space.password !== password) {
    return sendJson(res, 403, { error: 'Incorrect password.' });
  }

  const token = createToken();
  space.users.set(token, username);
  sessions.set(token, { token, spaceName, username });
  postMessage(space, 'system', `${username} joined the space.`);
  return sendJson(res, 200, { token, spaceName, username });
}

function getSession(reqUrl) {
  const token = sanitize(reqUrl.searchParams.get('token'));
  if (!token) return null;
  return sessions.get(token) || null;
}

function handleState(reqUrl, res) {
  const session = getSession(reqUrl);
  if (!session) {
    return sendJson(res, 401, { error: 'Invalid session token.' });
  }

  const space = spaces.get(session.spaceName);
  if (!space) {
    return sendJson(res, 404, { error: 'Space no longer exists.' });
  }

  const since = Number(reqUrl.searchParams.get('since') || 0);
  const messages = space.messages.filter((message) => message.id > since);
  return sendJson(res, 200, {
    spaceName: session.spaceName,
    username: session.username,
    users: Array.from(space.users.values()),
    messages
  });
}

function handleSend(body, res) {
  const token = sanitize(body.token);
  const text = sanitize(body.message);
  if (!token || !text) {
    return sendJson(res, 400, { error: 'Token and message are required.' });
  }

  const session = sessions.get(token);
  if (!session) {
    return sendJson(res, 401, { error: 'Invalid session token.' });
  }

  const space = spaces.get(session.spaceName);
  if (!space) {
    return sendJson(res, 404, { error: 'Space not found.' });
  }

  postMessage(space, 'chat', text, session.username);
  return sendJson(res, 201, { ok: true });
}

function serveStatic(reqPath, res) {
  const normalized = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const typeMap = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': typeMap[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'POST' && reqUrl.pathname === '/api/create') {
      return handleCreate(await readJson(req), res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/join') {
      return handleJoin(await readJson(req), res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/state') {
      return handleState(reqUrl, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/send') {
      return handleSend(await readJson(req), res);
    }

    if (req.method === 'GET') {
      return serveStatic(reqUrl.pathname, res);
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Bad request' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
