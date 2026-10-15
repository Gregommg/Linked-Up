require('dotenv').config();
const path = require('path'), http = require('http');
const express = require('express'), cors = require('cors'), mongoose = require('mongoose');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { User, Friendship } = require('./models');
const { Room } = require('./game');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/linkedup';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

/* ---------- Auth ---------- */
const sign = u => jwt.sign({ id: u._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }));
const fail = (status, message) => Object.assign(new Error(message), { status });

async function auth(req, res, next) {
  try {
    const { id } = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET);
    req.user = await User.findById(id);
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
  if (await User.findOne({ $or: [{ username }, { email }] })) throw fail(409, 'That username or email is already taken.');
  const user = await User.create({ username, email, passHash: await bcrypt.hash(password, 10) });
  res.json({ token: sign(user), user: { id: user.id, username } });
}));

// Players can sign in with EITHER their username OR their email.
app.post('/api/login', wrap(async (req, res) => {
  const ident = String(req.body.identifier || '').trim().toLowerCase();
  const user = await User.findOne({ $or: [{ username: ident }, { email: ident }] });
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passHash))) throw fail(401, 'Wrong username/email or password.');
  res.json({ token: sign(user), user: { id: user.id, username: user.username } });
}));

app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username }));

app.delete('/api/me', auth, wrap(async (req, res) => {
  const id = req.user.id;
  await Friendship.deleteMany({ $or: [{ requester: id }, { recipient: id }] });
  await User.deleteOne({ _id: id });
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

async function friendIds(uid) {
  const rows = await Friendship.find({ status: 'accepted', $or: [{ requester: uid }, { recipient: uid }] });
  return rows.map(r => (r.requester.toString() === uid ? r.recipient : r.requester).toString());
}
async function announce(uid) {
  const s = statusOf(uid);
  (await friendIds(uid)).forEach(f => io.to('u:' + f).emit('presence', { userId: uid, status: s }));
}

/* ---------- Friends ---------- */
app.get('/api/friends', auth, wrap(async (req, res) => {
  const me = req.user.id;
  const rows = await Friendship.find({ $or: [{ requester: me }, { recipient: me }] }).populate('requester recipient', 'username');
  const out = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    const mine = r.requester.id === me, other = mine ? r.recipient : r.requester;
    if (r.status === 'accepted') out.friends.push({ id: other.id, username: other.username, status: statusOf(other.id) });
    else (mine ? out.outgoing : out.incoming).push({ id: r.id, username: other.username });
  }
  out.friends.sort((a, b) => a.username.localeCompare(b.username));
  res.json(out);
}));
const ping = id => io.to('u:' + id).emit('friends:update');

app.post('/api/friends/request', auth, wrap(async (req, res) => {
  const target = await User.findOne({ username: String(req.body.username || '').trim().toLowerCase() });
  if (!target) throw fail(404, 'No player with that username.');
  if (target.id === req.user.id) throw fail(400, "You can't add yourself.");
  const existing = await Friendship.findOne({ $or: [{ requester: req.user.id, recipient: target.id }, { requester: target.id, recipient: req.user.id }] });
  if (existing) {
    if (existing.status === 'accepted') throw fail(409, 'You are already friends.');
    if (existing.recipient.toString() === req.user.id) { existing.status = 'accepted'; await existing.save(); ping(target.id); return res.json({ ok: true, accepted: true }); }
    throw fail(409, 'Request already sent.');
  }
  await Friendship.create({ requester: req.user.id, recipient: target.id });
  ping(target.id);
  res.json({ ok: true });
}));

app.post('/api/friends/respond', auth, wrap(async (req, res) => {
  const f = await Friendship.findById(req.body.id);
  if (!f || f.recipient.toString() !== req.user.id || f.status !== 'pending') throw fail(404, 'Request not found.');
  if (req.body.accept) { f.status = 'accepted'; await f.save(); } else await f.deleteOne();
  ping(f.requester.toString());
  res.json({ ok: true });
}));

app.delete('/api/friends/:userId', auth, wrap(async (req, res) => {
  const o = req.params.userId;
  await Friendship.deleteOne({ $or: [{ requester: req.user.id, recipient: o }, { requester: o, recipient: req.user.id }] });
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

io.use(async (socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    const u = await User.findById(id);
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

  // Invite a friend: only friends who are currently ONLINE (not offline, not already in a game).
  socket.on('invite:send', async ({ friendId } = {}) => {
    try {
      if (!(await friendIds(me.id)).includes(String(friendId))) return err('You can only invite friends.');
      const s = statusOf(String(friendId));
      if (s === 'offline') return err('That player is offline.');
      if (s === 'in_game') return err('That player is in another game right now.');
      let c = userRoom.get(me.id) || createRoom(me);
      const room = rooms.get(c);
      if (room.phase !== 'lobby') return err("You can't invite during a game.");
      if (room.players.length >= 4) return err('Your room is full (4 players).');
      io.to('u:' + friendId).emit('invite', { from: me.username, code: c });
      socket.emit('toast', 'Invite sent!');
    } catch { err('Could not send invite.'); }
  });

  socket.on('disconnect', () => {
    const set = sockets.get(me.id);
    set.delete(socket.id);
    if (!set.size) { sockets.delete(me.id); leaveRoom(me.id); announce(me.id); }
  });
});

mongoose.connect(MONGODB_URI).then(() => {
  server.listen(PORT, () => console.log('Linked Up running on port ' + PORT));
}).catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
