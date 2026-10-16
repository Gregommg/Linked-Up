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

function setPasswordVisibility(inputId, buttonId) {
  const input = $(inputId), button = $(buttonId);
  const openEye = button.querySelector('.eye-open'), closedEye = button.querySelector('.eye-closed');
  button.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(show));
    openEye.classList.toggle('hidden', show);
    closedEye.classList.toggle('hidden', !show);
  };
}
setPasswordVisibility('lPass', 'toggleLoginPassword');
setPasswordVisibility('rPass', 'toggleRegisterPassword');

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
  connect(); await Promise.all([loadFriends(), loadHighScores()]);
}
function connect() {
  socket = io(API || undefined, { auth: { token } });
  socket.on('connect_error', m => { if (m.message === 'auth') logout(); });
  socket.on('room', r => { if (!r || !room || room.code !== r.code) frame = null; room = r; renderRoom(); });
  socket.on('frame', f => {
    frame = f;
    if (room && room.mode === 'clash') {
      renderClashScores(f.teams);
      $('scoreTxt').textContent = 'Snake Clash';
      $('bestTxt').textContent = f.remainingMs === null ? 'Until all teams are eliminated' : Math.ceil(f.remainingMs / 1000) + 's left';
    } else $('scoreTxt').textContent = 'Score: ' + f.score;
    draw();
  });
  socket.on('over', o => {
    loadHighScores();
    if (room && room.mode === 'clash') {
      const result = o.winners.length > 1 ? 'Tie: ' + o.winners.join(', ') : (o.winners[0] || 'No winning team');
      $('scoreTxt').textContent = 'High score: ' + o.highScore;
      $('bestTxt').textContent = '';
      renderClashScores(o.teams);
      flash('roomErr', `${o.reason ? o.reason + ' ' : ''}${result} wins with ${o.highScore} points.`);
    } else {
      $('scoreTxt').textContent = 'Final score: ' + o.score;
      $('bestTxt').textContent = 'Best: ' + o.best;
      flash('roomErr', o.reason || 'Game over! Ready for another round?');
    }
    draw();
  });
  socket.on('presence', p => { const f = friends.friends.find(x => x.id === p.userId); if (f) { f.status = p.status; renderFriends(); } });
  socket.on('friends:update', loadFriends);
  socket.on('invite', i => addBanner(`<b>${esc(i.from)}</b> invited you to play`, 'Join', () => {
    if (i.teamId) socket.emit('arena:teamJoin', { code: i.code, teamId: i.teamId });
    else socket.emit('room:join', { code: i.code });
  }));
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
async function loadHighScores() {
  try {
    const data = await api('/api/highscores');
    $('highScoreVisibility').value = data.visibility;
    $('personalBest').textContent = data.visibility === 'hidden'
      ? 'Hidden from your dashboard'
      : data.personalBest > 0 ? `${data.personalBest} points` : 'No Clash score yet';
    $('publicLeaderboard').innerHTML = data.leaders.length
      ? data.leaders.map(player => `<li><span class="rank">#${player.rank}</span><span class="name">${esc(player.username)}</span><b>${player.score}</b></li>`).join('')
      : '<li class="small">No public scores yet.</li>';
  } catch (x) {
    if (x.status === 401) logout();
    else {
      $('personalBest').textContent = 'Could not load your score.';
      $('publicLeaderboard').innerHTML = '<li class="small">Could not load scores. Try refreshing.</li>';
    }
  }
}
function renderFriends() {
  $('reqCard').classList.toggle('hidden', !friends.incoming.length);
  $('reqList').innerHTML = friends.incoming.map(r => `<div class="friend"><span class="n">${esc(r.username)}</span>
    <button data-acc="${r.id}">Accept</button><button class="sec" data-dec="${r.id}">Decline</button></div>`).join('');
  const out = friends.outgoing.map(r => `<div class="friend"><span class="dot"></span><span class="n">${esc(r.username)}</span><span class="lbl">Request sent</span></div>`).join('');
  const myTeam = room && room.mode === 'clash' && room.teams.find(t => t.players.some(p => p.id === me.id));
  const inRoomFull = room && (room.mode === 'clash' ? !myTeam || myTeam.players.length >= 4 : room.players.length >= 4);
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
$('saveVisibilityBtn').onclick = async () => {
  const button = $('saveVisibilityBtn');
  button.disabled = true;
  $('visibilityStatus').textContent = 'Saving…';
  try {
    await api('/api/me/high-score-visibility', 'PATCH', { visibility: $('highScoreVisibility').value });
    $('visibilityStatus').textContent = 'Visibility saved.';
    await loadHighScores();
  } catch (x) {
    $('visibilityStatus').textContent = x.message;
  } finally {
    button.disabled = false;
  }
};

/* ---------- Rooms ---------- */
$('createBtn').onclick = () => socket.emit('room:create');
$('joinBtn').onclick = () => socket.emit('room:join', { code: $('joinCode').value });
$('leaveBtn').onclick = () => socket.emit('room:leave');
$('startBtn').onclick = () => socket.emit('room:start');
$('createArenaBtn').onclick = () => socket.emit('arena:create', {
  duration: $('arenaDuration').value,
  crashRule: $('arenaCrashRule').value
});
$('joinArenaBtn').onclick = () => socket.emit('arena:join', { code: $('arenaCode').value });

function renderRoom() {
  $('homeView').classList.toggle('hidden', !!room); $('roomView').classList.toggle('hidden', !room);
  renderFriends();
  if (!room) return;
  $('roomCode').textContent = room.code;
  const isClash = room.mode === 'clash';
  $('roomCodeHint').textContent = isClash
    ? 'Clash invitation code — share with other team hosts'
    : 'Team invitation code — share with teammates or friends';
  $('clashRules').classList.toggle('hidden', !isClash);
  if (isClash) {
    const length = room.durationMs ? `${room.durationMs / 60000}-minute match` : 'match ends when all teams are eliminated';
    const crash = room.crashRule === 'respawn' ? '3 lives; each respawn costs 20 points'
      : room.crashRule === 'eliminate' ? 'a crash eliminates that team' : 'any crash ends the match';
    $('clashRules').textContent = `${length} · ${crash}`;
  }
  $('clashControls').classList.toggle('hidden', isClash || room.host !== me.id || room.phase !== 'lobby');
  $('clashScoreCard').classList.toggle('hidden', !isClash);
  if (isClash) {
    $('players').innerHTML = room.teams.map(team => `<div class="team ${team.players.some(p => p.id === me.id) ? 'me' : ''}">
      <b>${esc(team.name)}'s team</b>${team.captain === room.host ? ' 👑 Arena host' : ''}
      <ul>${team.players.map(p => {
        const player = room.players.find(member => member.id === p.id);
        return `<li>${esc(p.username)}${player && player.dirs.length ? ' · ' + player.dirs.map(d => ARROW[d]).join(' ') : ''}</li>`;
      }).join('')}</ul></div>`).join('')
      + Array.from({ length: 4 - room.teams.length }, () => '<div class="pl small">Open team slot</div>').join('');
    renderClashScores(room.teams);
    $('scoreTxt').textContent = room.phase === 'playing' ? 'Snake Clash' : room.phase === 'lobby' ? 'Final / team scores' : 'Team scores';
  } else {
    $('players').innerHTML = room.players.map(p => `<div class="pl ${p.id === me.id ? 'me' : ''}">
      <b>${esc(p.username)}</b>${p.id === room.host ? ' 👑' : ''}<div class="keys">${p.dirs.map(d => ARROW[d]).join(' ') || '–'}</div></div>`).join('')
      + Array.from({ length: 4 - room.players.length }, () => '<div class="pl small">Open slot</div>').join('');
    if (room.best) $('bestTxt').textContent = 'Best: ' + room.best;
  }
  const enoughPlayers = isClash ? room.teams.length >= 2 : room.players.length >= 2;
  $('startBtn').disabled = !(room.host === me.id && room.phase === 'lobby' && enoughPlayers);
  $('startBtn').textContent = room.phase === 'countdown' ? 'Get ready…' : room.phase === 'playing' ? 'Playing…'
    : room.host === me.id ? (isClash ? 'Start clash' : 'Start game') : 'Waiting for host';
  const mine = (room.players.find(p => p.id === me.id) || {}).dirs || [];
  document.querySelectorAll('#pad button').forEach(b => { b.disabled = !mine.includes(b.dataset.d); b.classList.toggle('mine', mine.includes(b.dataset.d)); });
  if (room.phase === 'countdown') {
    frame = null;
    $('scoreTxt').textContent = isClash ? 'Snake Clash' : 'Score: 0';
    if (isClash) $('bestTxt').textContent = room.durationMs ? Math.ceil(room.durationMs / 1000) + 's match' : 'Until all teams are eliminated';
  }
  draw();
}
function renderClashScores(teams) {
  $('clashScores').innerHTML = teams.map(team => `<div class="team-score ${team.alive === false ? 'out' : ''}">
    <span>${esc(team.name)}'s team${team.alive === false ? ' · Eliminated' : room.crashRule === 'respawn' && team.lives ? ' · ' + team.lives + ' lives' : ''}</span>
    <b>${team.score} pts</b></div>`).join('');
}

/* ---------- Input ---------- */
const send = dir => socket && room && socket.emit('input', { dir });
addEventListener('keydown', e => { if (KEYS[e.key] && room && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); send(KEYS[e.key]); } });
document.querySelectorAll('#pad button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); send(b.dataset.d); }));

/* ---------- Drawing ---------- */
function draw() {
  const c = $('board'), g = c.getContext('2d'), W = 30, H = 20, s = c.width / W;
  g.fillStyle = '#050805'; g.fillRect(0, 0, c.width, c.height);
  const roundRect = (x, y, width, height, radius) => {
    g.beginPath();
    g.roundRect(x, y, width, height, radius);
    g.fill();
  };
  const drawApple = food => {
    const x = (food.x + .5) * s, y = (food.y + .5) * s;
    g.save();
    g.shadowColor = '#ff5264'; g.shadowBlur = 9;
    g.fillStyle = '#f04758'; g.beginPath(); g.arc(x, y + 1, s * .34, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#ff9a9f'; g.beginPath(); g.ellipse(x - s * .1, y - s * .1, s * .08, s * .13, -.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#9a6335'; g.lineWidth = Math.max(1.5, s * .07);
    g.beginPath(); g.moveTo(x, y - s * .25); g.lineTo(x + s * .02, y - s * .44); g.stroke();
    g.fillStyle = '#66d17a'; g.beginPath(); g.ellipse(x + s * .13, y - s * .36, s * .12, s * .06, -.5, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  const drawBonus = bonus => {
    const x = (bonus.x + .5) * s, y = (bonus.y + .5) * s;
    const pulse = .88 + .12 * Math.sin(Date.now() / 110);
    const outer = s * .5 * pulse, inner = outer * .56;
    g.save();
    g.shadowColor = '#ffd34e'; g.shadowBlur = 18;
    g.fillStyle = '#ffbd24'; g.beginPath();
    for (let i = 0; i < 16; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 8;
      const radius = i % 2 ? inner : outer;
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#fff3ad'; g.beginPath(); g.arc(x, y, inner * .55, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a4a00'; g.font = `bold ${Math.max(8, s * .38)}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('+' + bonus.points, x, y);
    g.restore();
  };
  const drawSnake = (snake, color) => {
    if (!snake || !snake.length) return;
    g.save();
    g.shadowColor = color; g.shadowBlur = 5;
    snake.slice(1).forEach((p, i) => {
      const shade = i % 2 ? color : (color === '#19e34b' ? '#13bf3c' : color);
      const x = p.x * s + 1.5, y = p.y * s + 1.5, size = s - 3;
      g.fillStyle = shade;
      roundRect(x, y, size, size, size * .38);
      g.beginPath(); g.arc((p.x + .5) * s, (p.y + .5) * s, size * .32, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.16)';
      g.beginPath(); g.ellipse((p.x + .36) * s, (p.y + .34) * s, s * .08, s * .12, -.5, 0, Math.PI * 2); g.fill();
    });
    const head = snake[0], neck = snake[1] || head;
    const dx = Math.sign(head.x - neck.x), dy = Math.sign(head.y - neck.y);
    const hx = (head.x + .5) * s, hy = (head.y + .5) * s;
    g.shadowBlur = 8; g.fillStyle = color;
    g.beginPath(); g.arc(hx, hy, s * .46, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    const eyeFront = s * .17, eyeSide = s * .19, eyeRadius = Math.max(1.5, s * .1);
    for (const side of [-1, 1]) {
      const ex = hx + dx * eyeFront - dy * eyeSide * side;
      const ey = hy + dy * eyeFront + dx * eyeSide * side;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, ey, eyeRadius, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#050805'; g.beginPath(); g.arc(ex + dx * eyeRadius * .35, ey + dy * eyeRadius * .35, eyeRadius * .55, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  };
  if (frame) {
    if (frame.food) drawApple(frame.food);
    if (frame.bonusFood) drawBonus(frame.bonusFood);
    if (room && room.mode === 'clash') {
      const colors = ['#19e34b', '#66b8ff', '#ffb454', '#c596ff'];
      frame.teams.forEach((team, teamIndex) => drawSnake(team.snake, colors[teamIndex % colors.length]));
    } else if (frame.snake) {
      drawSnake(frame.snake, '#19e34b');
    }
  }
  const msg = !room ? '' : room.phase === 'countdown' ? 'Get ready…' : (room.phase === 'lobby' && !frame) ? 'Waiting to start' : '';
  if (msg) { g.fillStyle = '#f0f5ee'; g.font = 'bold 28px system-ui'; g.textAlign = 'center'; g.fillText(msg, c.width / 2, c.height / 2); }
}

/* ---------- Auto sign-in ---------- */
(async () => { if (token) { try { me = await api('/api/me'); await enter(); } catch { localStorage.removeItem('token'); token = null; } } })();
