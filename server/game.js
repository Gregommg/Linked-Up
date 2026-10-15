// Shared-snake game room. The server owns all game state; clients only send key presses.
const W = 30, H = 20, TICK_MS = 140, MAX_PLAYERS = 4;
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

class Room {
  constructor(code, io, hostId) {
    this.code = code; this.io = io; this.host = hostId;
    this.players = []; this.phase = 'lobby'; // lobby | countdown | playing
    this.best = 0; this.timer = null; this.countdown = null;
  }
  get channel() { return 'r:' + this.code; }
  state() {
    return { code: this.code, host: this.host, phase: this.phase, best: this.best, grid: { W, H },
      players: this.players.map(p => ({ id: p.id, username: p.username, dirs: p.dirs })) };
  }
  push() { this.io.to(this.channel).emit('room', this.state()); }

  add(id, username) {
    if (this.players.some(p => p.id === id)) return null;
    if (this.players.length >= MAX_PLAYERS) return 'Room is full (maximum 4 players).';
    if (this.phase !== 'lobby') return 'That game has already started.';
    this.players.push({ id, username, dirs: [] });
    this.push(); return null;
  }
  // Returns true when the room is now empty.
  remove(id) {
    this.players = this.players.filter(p => p.id !== id);
    if (!this.players.length) { this.stop(); return true; }
    if (this.host === id) this.host = this.players[0].id;
    if (this.phase !== 'lobby') {
      if (this.players.length < 2) this.end('Not enough players left.');
      else this.assign();
    }
    this.push(); return false;
  }
  // Spread the four directions across players (shuffled each round).
  assign() {
    this.players.forEach(p => p.dirs = []);
    shuffle(Object.keys(DIRS)).forEach((d, i) => this.players[i % this.players.length].dirs.push(d));
  }
  start(id) {
    if (id !== this.host) return 'Only the host can start the game.';
    if (this.phase !== 'lobby') return 'Game already running.';
    if (this.players.length < 2) return 'You need at least 2 players to start.';
    this.assign();
    this.snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    this.dir = 'right'; this.pending = null; this.score = 0; this.placeFood();
    this.phase = 'countdown'; this.push();
    this.countdown = setTimeout(() => {
      this.phase = 'playing'; this.push();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }, 3000);
    return null;
  }
  input(id, dir) {
    const p = this.players.find(x => x.id === id);
    if (this.phase === 'playing' && p && p.dirs.includes(dir)) this.pending = dir;
  }
  placeFood() {
    let f;
    do { f = { x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * H) }; }
    while (this.snake.some(c => c.x === f.x && c.y === f.y));
    this.food = f;
  }
  tick() {
    if (this.pending && this.pending !== OPP[this.dir]) this.dir = this.pending;
    this.pending = null;
    const h = this.snake[0], d = DIRS[this.dir], n = { x: h.x + d.x, y: h.y + d.y };
    const eat = n.x === this.food.x && n.y === this.food.y;
    const body = eat ? this.snake : this.snake.slice(0, -1);
    if (n.x < 0 || n.y < 0 || n.x >= W || n.y >= H || body.some(c => c.x === n.x && c.y === n.y)) return this.end();
    this.snake.unshift(n);
    if (eat) { this.score++; this.placeFood(); } else this.snake.pop();
    this.io.to(this.channel).emit('frame', { snake: this.snake, food: this.food, score: this.score });
  }
  stop() { clearInterval(this.timer); clearTimeout(this.countdown); this.timer = this.countdown = null; }
  end(reason) {
    this.stop();
    this.best = Math.max(this.best, this.score || 0);
    const score = this.score || 0;
    this.phase = 'lobby';
    this.players.forEach(p => p.dirs = []);
    this.io.to(this.channel).emit('over', { score, best: this.best, reason: reason || null });
    this.push();
  }
}
module.exports = { Room, MAX_PLAYERS };
