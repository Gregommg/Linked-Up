require('dotenv').config();
const path = require('path'), http = require('http');
const { randomUUID } = require('crypto');
const express = require('express'), cors = require('cors');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./models');
const { Room, ClashArena, MAX_PLAYERS, MAX_TEAMS } = require('./game');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/* ---------- Auth ---------- */
const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '30d' });
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }));
const fail = (status, message) => Object.assign(new Error(message), { status });

async function auth(req, res, next) {
  try {
    const { id } = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET);
    req.user = await db.findUserById(id);
    if (!req.user) throw 0;
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
}

app.post('/api/register', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) throw fail(400, 'Username must be 3-20 letters, numbers or underscores.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
  if (password.length < 6) throw fail(400, 'Password must be at least 6 characters.');
  let user;
  try {
    user = await db.createUser({ id: randomUUID(), username, email, passHash: await bcrypt.hash(password, 10) });
  } catch (error) {
    if (error.code === '23505') throw fail(409, 'That username or email is already taken.');
    throw error;
  }
  res.json({ token: sign(user), user: { id: user.id, username } });
}));

// Players can sign in with EITHER their username OR their email.
app.post('/api/login', wrap(async (req, res) => {
  const ident = String(req.body.identifier || '').trim().toLowerCase();
  const user = await db.findUserByLogin(ident);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passHash))) throw fail(401, 'Wrong username/email or password.');
  res.json({ token: sign(user), user: { id: user.id, username: user.username } });
}));

app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username }));

app.get('/api/highscores', auth, wrap(async (req, res) => {
  const { user, leaders } = await db.getHighScores(req.user.id);
  if (!user) throw fail(404, 'Player not found.');
  res.json({
    visibility: user.highScoreVisibility || 'private',
    personalBest: user.highScoreVisibility === 'hidden' ? null : user.clashHighScore || 0,
    leaders: leaders.map((player, index) => ({
      rank: index + 1, username: player.username, score: player.score
    }))
  });
}));

app.patch('/api/me/high-score-visibility', auth, wrap(async (req, res) => {
  const { visibility } = req.body || {};
  if (!db.isHighScoreVisibility(visibility)) {
    throw fail(400, 'Choose public, private, or hidden visibility.');
  }
  await db.setHighScoreVisibility(req.user.id, visibility);
  res.json({ visibility });
}));

app.delete('/api/me', auth, wrap(async (req, res) => {
  const id = req.user.id;
  await db.deleteUser(id);
  leaveRoom(id);
  io.in('u:' + id).disconnectSockets(true);
  res.json({ ok: true });
}));

/* ---------- Presence ---------- */
const sockets = new Map();   // userId -> Set(socketId)
const userRoom = new Map();  // userId -> room code
const rooms = new Map();     // code -> Room
// offline = no connection, online = free to invite, in_game = inside a game room
const statusOf = id => !(sockets.get(id) && sockets.get(id).size) ? 'offline' : userRoom.has(id) ? 'in_game' : 'online';

async function announce(uid) {
  const s = statusOf(uid);
  (await db.getFriendIds(uid)).forEach(f => io.to('u:' + f).emit('presence', { userId: uid, status: s }));
}

/* ---------- Friends ---------- */
app.get('/api/friends', auth, wrap(async (req, res) => {
  const me = req.user.id;
  const rows = await db.getFriendshipsForUser(me);
  const out = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    const mine = r.requester === me;
    const otherId = mine ? r.recipient : r.requester;
    const otherUsername = mine ? r.recipient_username : r.requester_username;
    if (r.status === 'accepted') out.friends.push({ id: otherId, username: otherUsername, status: statusOf(otherId) });
    else (mine ? out.outgoing : out.incoming).push({ id: r.id, username: otherUsername });
  }
  out.friends.sort((a, b) => a.username.localeCompare(b.username));
  res.json(out);
}));
const ping = id => io.to('u:' + id).emit('friends:update');

app.post('/api/friends/request', auth, wrap(async (req, res) => {
  const target = await db.findUserByUsername(String(req.body.username || '').trim().toLowerCase());
  if (!target) throw fail(404, 'No player with that username.');
  if (target.id === req.user.id) throw fail(400, "You can't add yourself.");
  const existing = await db.findFriendshipBetween(req.user.id, target.id);
  if (existing) {
    if (existing.status === 'accepted') throw fail(409, 'You are already friends.');
    if (existing.recipient === req.user.id) { await db.updateFriendshipStatus(existing.id, 'accepted'); ping(target.id); return res.json({ ok: true, accepted: true }); }
    throw fail(409, 'Request already sent.');
  }
  try {
    await db.createFriendship({ id: randomUUID(), requester: req.user.id, recipient: target.id });
  } catch (error) {
    if (error.code === '23505') throw fail(409, 'Request already sent.');
    throw error;
  }
  ping(target.id);
  res.json({ ok: true });
}));

app.post('/api/friends/respond', auth, wrap(async (req, res) => {
  const f = await db.findFriendshipById(req.body.id);
  if (!f || f.recipient !== req.user.id || f.status !== 'pending') throw fail(404, 'Request not found.');
  if (req.body.accept) await db.updateFriendshipStatus(f.id, 'accepted');
  else await db.deleteFriendshipById(f.id);
  ping(f.requester);
  res.json({ ok: true });
}));

app.delete('/api/friends/:userId', auth, wrap(async (req, res) => {
  const o = req.params.userId;
  await db.deleteFriendshipBetween(req.user.id, o);
  ping(o);
  res.json({ ok: true });
}));

/* ---------- Rooms ---------- */
const genCode = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); } while (rooms.has(c)); return c; };

function leaveRoom(uid) {
  const code = userRoom.get(uid);
  if (!code) return;
  userRoom.delete(uid);
  io.in('u:' + uid).socketsLeave('r:' + code);
  io.to('u:' + uid).emit('room', null);
  const room = rooms.get(code);
  if (room && room.remove(uid)) rooms.delete(code);
  announce(uid);
}
function joinRoom(me, code) {
  const room = rooms.get(code);
  if (!room) return 'Room not found. Check the code.';
  if (userRoom.get(me.id) === code) return null;
  if (userRoom.has(me.id)) leaveRoom(me.id);
  const err = room.add(me.id, me.username);
  if (err) return err;
  userRoom.set(me.id, code);
  io.in('u:' + me.id).socketsJoin('r:' + code);
  room.push(); announce(me.id);
  return null;
}
function createRoom(me) {
  if (userRoom.has(me.id)) leaveRoom(me.id);
  const code = genCode();
  rooms.set(code, new Room(code, io, me.id));
  joinRoom(me, code);
  return code;
}
function teamRoomFor(uid) {
  const room = rooms.get(userRoom.get(uid));
  if (!(room instanceof Room) || room.mode !== 'coop') return { error: 'Create or join a team room first.' };
  if (room.host !== uid) return { error: 'Only your team-room host can create or join a clash.' };
  if (room.phase !== 'lobby') return { error: 'Your team must be in its lobby to enter a clash.' };
  return { room };
}
function transferTeamToArena(source, arena) {
  const members = source.players.map(p => ({ id: p.id, username: p.username, dirs: [] }));
  const error = arena.addTeam(members, source.host);
  if (error) return error;

  source.stop();
  rooms.delete(source.code);
  io.to(source.channel).emit('room', null);
  for (const player of members) {
    userRoom.set(player.id, arena.code);
    io.in('u:' + player.id).socketsLeave(source.channel);
    io.in('u:' + player.id).socketsJoin(arena.channel);
    announce(player.id);
  }
  arena.push();
  return null;
}
function createClashArena(uid, options = {}) {
  const { room: source, error } = teamRoomFor(uid);
  if (error) return error;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return 'Choose valid clash settings.';
  const durationMs = options.duration === 'none' ? null : Number(options.duration);
  if (durationMs !== null && ![120000, 180000, 300000].includes(durationMs)) return 'Choose a supported clash duration.';
  if (!['respawn', 'eliminate', 'end-match'].includes(options.crashRule)) return 'Choose a valid crash rule.';
  if (source.players.length > MAX_PLAYERS) return 'A team can have at most 4 players.';

  const code = genCode();
  const arena = new ClashArena(code, io, uid, {
    durationMs, crashRule: options.crashRule,
    onEnd: results => db.saveClashHighScores(results).catch(error => {
      console.error('Could not save clash high scores:', error.message);
    })
  });
  rooms.set(code, arena);
  const transferError = transferTeamToArena(source, arena);
  if (transferError) rooms.delete(code);
  return transferError;
}
function joinClashArena(uid, code) {
  const { room: source, error } = teamRoomFor(uid);
  if (error) return error;
  const arena = rooms.get(code);
  if (!(arena instanceof ClashArena)) return 'Clash arena not found. Check the code.';
  if (arena.teams.length >= MAX_TEAMS) return 'This clash already has 4 teams.';
  if (source.players.length > MAX_PLAYERS) return 'A team can have at most 4 players.';
  return transferTeamToArena(source, arena);
}
io.use(async (socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    const u = await db.findUserById(id);
    if (!u) throw 0;
    socket.user = { id: u.id, username: u.username };
    next();
  } catch { next(new Error('auth')); }
});

io.on('connection', socket => {
  const me = socket.user;
  const err = m => socket.emit('err', m);
  socket.join('u:' + me.id);
  if (!sockets.has(me.id)) sockets.set(me.id, new Set());
  sockets.get(me.id).add(socket.id);
  const code = userRoom.get(me.id);
  if (code && rooms.has(code)) { socket.join('r:' + code); socket.emit('room', rooms.get(code).state()); }
  announce(me.id);

  socket.on('room:create', () => createRoom(me));
  socket.on('room:join', ({ code } = {}) => { const e = joinRoom(me, String(code || '').trim().toUpperCase()); if (e) err(e); });
  socket.on('room:leave', () => leaveRoom(me.id));
  socket.on('room:start', () => { const r = rooms.get(userRoom.get(me.id)); const e = r && r.start(me.id); if (e) err(e); });
  socket.on('input', ({ dir } = {}) => { const r = rooms.get(userRoom.get(me.id)); if (r) r.input(me.id, dir); });
  socket.on('arena:create', (options = {}) => {
    const e = createClashArena(me.id, options);
    if (e) err(e);
  });
  socket.on('arena:join', ({ code } = {}) => {
    const e = joinClashArena(me.id, String(code || '').trim().toUpperCase());
    if (e) err(e);
  });
  socket.on('arena:teamJoin', ({ code, teamId } = {}) => {
    const arena = rooms.get(String(code || '').trim().toUpperCase());
    if (!(arena instanceof ClashArena)) return err('Clash arena not found. Check the code.');
    if (userRoom.has(me.id)) return err('Leave your current room before joining a team.');
    const e = arena.addPlayerToTeam(me.id, me.username, String(teamId || ''));
    if (e) return err(e);
    userRoom.set(me.id, arena.code);
    io.in('u:' + me.id).socketsJoin(arena.channel);
    arena.push();
    announce(me.id);
  });

  // Invite a friend: to a regular room or to the inviter's team in a clash lobby.
  socket.on('invite:send', async ({ friendId } = {}) => {
    try {
      if (!(await db.getFriendIds(me.id)).includes(String(friendId))) return err('You can only invite friends.');
      const s = statusOf(String(friendId));
      if (s === 'offline') return err('That player is offline.');
      if (s === 'in_game') return err('That player is in another game right now.');
      let c = userRoom.get(me.id) || createRoom(me);
      const room = rooms.get(c);
      if (room.phase !== 'lobby') return err("You can't invite during a game.");
      let invite = { from: me.username, code: c };
      if (room instanceof ClashArena) {
        const team = room.teams.find(t => t.playerIds.includes(me.id));
        if (!team) return err('Your team was not found in this clash.');
        if (team.playerIds.length >= MAX_PLAYERS) return err('Your team is full (4 players).');
        invite = { ...invite, teamId: team.id };
      } else if (room.players.length >= MAX_PLAYERS) return err('Your room is full (4 players).');
      io.to('u:' + friendId).emit('invite', invite);
      socket.emit('toast', 'Invite sent!');
    } catch { err('Could not send invite.'); }
  });

  socket.on('disconnect', () => {
    const set = sockets.get(me.id);
    set.delete(socket.id);
    if (!set.size) { sockets.delete(me.id); leaveRoom(me.id); announce(me.id); }
  });
});

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it to your Neon PostgreSQL connection string.');
  process.exit(1);
}

db.initializeDatabase().then(() => {
  server.listen(PORT, () => console.log('Linked Up running on port ' + PORT));
}).catch(e => { console.error('PostgreSQL connection failed:', e.message); process.exit(1); });
