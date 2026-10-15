const API = window.API_BASE || '';
const $ = id => document.getElementById(id);
const ARROW = { up: '▲', down: '▼', left: '◄', right: '►' };
const KEYS = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
const STATUS = { online: 'Online', in_game: 'In a game', offline: 'Offline' };

let token = localStorage.getItem('token'), me = null, socket = null, room = null;
let friends = { friends: [], incoming: [], outgoing: [] };
let frame = null;

async function api(path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; throw e; }
  return j;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flash = (id, msg) => { $(id).textContent = msg || ''; if (msg) setTimeout(() => { if ($(id).textContent === msg) $(id).textContent = ''; }, 4000); };

/* ---------- Auth ---------- */
$('tabLogin').onclick = () => { $('loginForm').classList.remove('hidden'); $('regForm').classList.add('hidden'); $('tabLogin').className = 'on'; $('tabReg').className = ''; };
$('tabReg').onclick = () => { $('regForm').classList.remove('hidden'); $('loginForm').classList.add('hidden'); $('tabReg').className = 'on'; $('tabLogin').className = ''; };

async function authDone(r) { token = r.token; localStorage.setItem('token', token); me = r.user; await enter(); }
$('loginForm').onsubmit = async e => { e.preventDefault(); try { await authDone(await api('/api/login', 'POST', { identifier: $('lIdent').value, password: $('lPass').value })); } catch (x) { $('authErr').textContent = x.message; } };
$('regForm').onsubmit = async e => { e.preventDefault(); try { await authDone(await api('/api/register', 'POST', { username: $('rUser').value, email: $('rEmail').value, password: $('rPass').value })); } catch (x) { $('authErr').textContent = x.message; } };
$('logoutBtn').onclick = logout;
function logout() { localStorage.removeItem('token'); token = null; if (socket) socket.disconnect(); location.reload(); }
$('deleteBtn').onclick = async () => { if (confirm('Permanently delete your account and friends list?')) { try { await api('/api/me', 'DELETE'); logout(); } catch (x) { flash('homeErr', x.message); } } };

/* ---------- Enter app ---------- */
async function enter() {
  $('authView').classList.add('hidden'); $('appView').classList.remove('hidden');
  $('meName').textContent = '@' + me.username;
  connect(); await loadFriends();
}
function connect() {
  socket = io(API || undefined, { auth: { token } });
  socket.on('connect_error', m => { if (m.message === 'auth') logout(); });
  socket.on('room', r => { room = r; if (!r) frame = null; renderRoom(); });
  socket.on('frame', f => { frame = f; $('scoreTxt').textContent = 'Score: ' + f.score; draw(); });
  socket.on('over', o => { $('scoreTxt').textContent = 'Final score: ' + o.score; $('bestTxt').textContent = 'Best: ' + o.best; flash('roomErr', o.reason || 'Game over! Ready for another round?'); draw(); });
  socket.on('presence', p => { const f = friends.friends.find(x => x.id === p.userId); if (f) { f.status = p.status; renderFriends(); } });
  socket.on('friends:update', loadFriends);
  socket.on('invite', i => addBanner(`<b>${esc(i.from)}</b> invited you to play`, 'Join', () => socket.emit('room:join', { code: i.code })));
  socket.on('toast', t => addBanner(esc(t)));
  socket.on('err', m => { flash(room ? 'roomErr' : 'homeErr', m); addBanner(esc(m)); });
}
function addBanner(html, label, fn) {
  const d = document.createElement('div'); d.className = 'toast'; d.innerHTML = `<span>${html}</span>`;
  const rm = () => d.remove();
  if (label) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); rm(); }; d.appendChild(b); }
  const x = document.createElement('button'); x.className = 'sec'; x.textContent = '✕'; x.onclick = rm; d.appendChild(x);
  $('banner').appendChild(d); setTimeout(rm, label ? 30000 : 4000);
}

/* ---------- Friends ---------- */
async function loadFriends() { try { friends = await api('/api/friends'); renderFriends(); } catch (x) { if (x.status === 401) logout(); } }
function renderFriends() {
  $('reqCard').classList.toggle('hidden', !friends.incoming.length);
  $('reqList').innerHTML = friends.incoming.map(r => `<div class="friend"><span class="n">${esc(r.username)}</span>
    <button data-acc="${r.id}">Accept</button><button class="sec" data-dec="${r.id}">Decline</button></div>`).join('');
  const out = friends.outgoing.map(r => `<div class="friend"><span class="dot"></span><span class="n">${esc(r.username)}</span><span class="lbl">Request sent</span></div>`).join('');
  const inRoomFull = room && room.players.length >= 4;
  const list = friends.friends.map(f => {
    // Invite is only offered while the friend is online (not offline, not in another game).
    let act = '';
    if (f.status === 'online') act = `<button data-inv="${f.id}" ${inRoomFull || (room && room.phase !== 'lobby') ? 'disabled' : ''}>Invite</button>`;
    return `<div class="friend"><span class="dot ${f.status}"></span><span class="n">${esc(f.username)}<div class="lbl">${STATUS[f.status]}</div></span>${act}</div>`;
  }).join('');
  $('friendList').innerHTML = (list + out) || '<span class="small">No friends yet.</span>';
}
$('reqList').onclick = async e => {
  const a = e.target.dataset.acc, d = e.target.dataset.dec;
  if (a || d) { await api('/api/friends/respond', 'POST', { id: a || d, accept: !!a }); loadFriends(); }
};
$('friendList').onclick = e => { if (e.target.dataset.inv) socket.emit('invite:send', { friendId: e.target.dataset.inv }); };
$('addBtn').onclick = async () => {
  try { const r = await api('/api/friends/request', 'POST', { username: $('friendName').value }); $('friendName').value = ''; flash('friendErr', r.accepted ? 'You are now friends!' : 'Request sent!'); loadFriends(); }
  catch (x) { flash('friendErr', x.message); }
};

/* ---------- Rooms ---------- */
$('createBtn').onclick = () => socket.emit('room:create');
$('joinBtn').onclick = () => socket.emit('room:join', { code: $('joinCode').value });
$('leaveBtn').onclick = () => socket.emit('room:leave');
$('startBtn').onclick = () => socket.emit('room:start');

function renderRoom() {
  $('homeView').classList.toggle('hidden', !!room); $('roomView').classList.toggle('hidden', !room);
  renderFriends();
  if (!room) return;
  $('roomCode').textContent = room.code;
  $('players').innerHTML = room.players.map(p => `<div class="pl ${p.id === me.id ? 'me' : ''}">
    <b>${esc(p.username)}</b>${p.id === room.host ? ' 👑' : ''}<div class="keys">${p.dirs.map(d => ARROW[d]).join(' ') || '–'}</div></div>`).join('')
    + Array.from({ length: 4 - room.players.length }, () => '<div class="pl small">Open slot</div>').join('');
  $('startBtn').disabled = !(room.host === me.id && room.phase === 'lobby' && room.players.length >= 2);
  $('startBtn').textContent = room.phase === 'countdown' ? 'Get ready…' : room.phase === 'playing' ? 'Playing…' : (room.host === me.id ? 'Start game' : 'Waiting for host');
  const mine = (room.players.find(p => p.id === me.id) || {}).dirs || [];
  document.querySelectorAll('#pad button').forEach(b => { b.disabled = !mine.includes(b.dataset.d); b.classList.toggle('mine', mine.includes(b.dataset.d)); });
  if (room.phase === 'countdown') { frame = null; $('scoreTxt').textContent = 'Score: 0'; }
  if (room.best) $('bestTxt').textContent = 'Best: ' + room.best;
  draw();
}

/* ---------- Input ---------- */
const send = dir => socket && room && socket.emit('input', { dir });
addEventListener('keydown', e => { if (KEYS[e.key] && room && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); send(KEYS[e.key]); } });
document.querySelectorAll('#pad button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); send(b.dataset.d); }));

/* ---------- Drawing ---------- */
function draw() {
  const c = $('board'), g = c.getContext('2d'), W = 30, H = 20, s = c.width / W;
  g.fillStyle = '#0d1219'; g.fillRect(0, 0, c.width, c.height);
  if (frame) {
    g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc((frame.food.x + .5) * s, (frame.food.y + .5) * s, s * .38, 0, 7); g.fill();
    frame.snake.forEach((p, i) => { g.fillStyle = i ? '#5be37d' : '#b8ffc9'; g.fillRect(p.x * s + 1, p.y * s + 1, s - 2, s - 2); });
  }
  const msg = !room ? '' : room.phase === 'countdown' ? 'Get ready…' : (room.phase === 'lobby' && !frame) ? 'Waiting to start' : '';
  if (msg) { g.fillStyle = '#e8eef6'; g.font = 'bold 28px system-ui'; g.textAlign = 'center'; g.fillText(msg, c.width / 2, c.height / 2); }
}

/* ---------- Auto sign-in ---------- */
(async () => { if (token) { try { me = await api('/api/me'); await enter(); } catch { localStorage.removeItem('token'); token = null; } } })();
