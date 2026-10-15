// Game rooms are server-authoritative. Cooperative rooms share one snake;
// clash arenas let each team control its own snake in the same grid.
const W = 30, H = 20, TICK_MS = 140, MAX_PLAYERS = 4, MAX_TEAMS = 4;
const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const RESPAWN_DELAY_MS = 1800, RESPAWN_PENALTY = 20, STARTING_LIVES = 3;
const BONUS_SPAWN_CHANCE = 0.2, BONUS_LIFETIME_MS = 6000;
const BONUS_MIN_POINTS = 3, BONUS_MAX_POINTS = 10;

const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const randomBonusPoints = () => randomInt(BONUS_MIN_POINTS, BONUS_MAX_POINTS);

class Room {
  constructor(code, io, hostId) {
    this.code = code; this.io = io; this.host = hostId; this.mode = 'coop';
    this.players = []; this.phase = 'lobby'; // lobby | countdown | playing
    this.best = 0; this.timer = null; this.countdown = null;
  }
  get channel() { return 'r:' + this.code; }
  state() {
    return { code: this.code, mode: this.mode, host: this.host, phase: this.phase, best: this.best, grid: { W, H },
      players: this.players.map(p => ({ id: p.id, username: p.username, dirs: p.dirs })) };
  }
  push() { this.io.to(this.channel).emit('room', this.state()); }

  add(id, username) {
    if (this.mode !== 'coop') return 'Join a clash arena with your team.';
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
    this.bonusFood = null; this.bonusExpiresAt = null;
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
  placeBonusFood() {
    const occupied = [...this.snake, this.food].filter(Boolean);
    const free = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!occupied.some(c => c.x === x && c.y === y)) free.push({ x, y });
    }
    if (!free.length) return;
    this.bonusFood = { ...free[Math.floor(Math.random() * free.length)], points: randomBonusPoints() };
    this.bonusExpiresAt = Date.now() + BONUS_LIFETIME_MS;
  }
  expireBonusFood() {
    if (this.bonusFood && Date.now() >= this.bonusExpiresAt) {
      this.bonusFood = null;
      this.bonusExpiresAt = null;
    }
  }
  maybeSpawnBonusFood(occupied) {
    if (!this.bonusFood && occupied.length < W * H && Math.random() < BONUS_SPAWN_CHANCE) this.placeBonusFood();
  }
  frameState() {
    return {
      snake: this.snake, food: this.food, bonusFood: this.bonusFood,
      score: this.score
    };
  }
  tick() {
    if (this.pending && this.pending !== OPP[this.dir]) this.dir = this.pending;
    this.pending = null;
    this.expireBonusFood();
    const h = this.snake[0], d = DIRS[this.dir], n = { x: h.x + d.x, y: h.y + d.y };
    const eat = n.x === this.food.x && n.y === this.food.y;
    const eatBonus = this.bonusFood && n.x === this.bonusFood.x && n.y === this.bonusFood.y;
    const body = eat || eatBonus ? this.snake : this.snake.slice(0, -1);
    if (n.x < 0 || n.y < 0 || n.x >= W || n.y >= H || body.some(c => c.x === n.x && c.y === n.y)) return this.end();
    this.snake.unshift(n);
    if (eat) {
      this.score++;
      this.placeFood();
      this.maybeSpawnBonusFood(this.snake);
    }
    if (eatBonus) {
      this.score += this.bonusFood.points;
      this.bonusFood = null; this.bonusExpiresAt = null;
    }
    if (!eat && !eatBonus) this.snake.pop();
    this.io.to(this.channel).emit('frame', this.frameState());
  }
  stop() { clearInterval(this.timer); clearTimeout(this.countdown); this.timer = this.countdown = null; }
  end(reason) {
    this.stop();
    this.best = Math.max(this.best, this.score || 0);
    const score = this.score || 0;
    this.bonusFood = null;
    this.bonusExpiresAt = null;
    this.phase = 'lobby';
    this.players.forEach(p => p.dirs = []);
    this.io.to(this.channel).emit('over', { score, best: this.best, reason: reason || null });
    this.push();
  }
}

class ClashArena {
  constructor(code, io, hostId, { durationMs = null, crashRule = 'respawn', onEnd = null } = {}) {
    this.code = code; this.io = io; this.host = hostId; this.mode = 'clash';
    this.players = []; this.teams = []; this.phase = 'lobby';
    this.durationMs = durationMs; this.crashRule = crashRule;
    this.onEnd = onEnd;
    this.timer = null; this.countdown = null; this.matchTimer = null; this.endsAt = null;
    this.food = null; this.bonusFood = null; this.bonusExpiresAt = null;
  }
  get channel() { return 'r:' + this.code; }
  state() {
    return {
      code: this.code, mode: this.mode, host: this.host, phase: this.phase, grid: { W, H },
      durationMs: this.durationMs, crashRule: this.crashRule, remainingMs: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      players: this.players.map(p => ({ id: p.id, username: p.username, dirs: p.dirs, teamId: p.teamId })),
      teams: this.teams.map(t => ({
        id: t.id, name: t.name, captain: t.captain, score: t.score, alive: t.alive,
        lives: t.lives, players: t.playerIds.map(id => {
          const player = this.players.find(p => p.id === id);
          return player ? { id: player.id, username: player.username } : null;
        }).filter(Boolean)
      }))
    };
  }
  push() { this.io.to(this.channel).emit('room', this.state()); }
  addTeam(players, captainId) {
    if (this.phase !== 'lobby') return 'That clash has already started.';
    if (this.teams.length >= MAX_TEAMS) return 'This clash already has 4 teams.';
    if (!players.length || players.length > MAX_PLAYERS) return 'A team must have 1 to 4 players.';
    if (!players.some(p => p.id === captainId)) return 'The team host is not in the team.';
    if (players.some(p => this.players.some(existing => existing.id === p.id))) return 'A player is already in this clash.';
    const captain = players.find(p => p.id === captainId);
    const team = {
      id: captainId, name: captain.username, captain: captainId,
      playerIds: players.map(p => p.id), participantIds: players.map(p => p.id),
      score: 0, alive: true, lives: STARTING_LIVES,
      snake: null, dir: 'right', pending: null, respawnTimer: null
    };
    this.teams.push(team);
    players.forEach(p => this.players.push({ id: p.id, username: p.username, dirs: [], teamId: team.id }));
    if (this.teams.length === 1) this.host = captainId;
    this.push();
    return null;
  }
  addPlayerToTeam(id, username, teamId) {
    if (this.phase !== 'lobby') return 'That clash has already started.';
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return 'Team not found in that clash.';
    if (team.playerIds.length >= MAX_PLAYERS) return 'That team already has 4 players.';
    if (this.players.some(p => p.id === id)) return 'That player is already in this clash.';
    team.playerIds.push(id);
    team.participantIds.push(id);
    this.players.push({ id, username, dirs: [], teamId: team.id });
    this.push();
    return null;
  }
  remove(id) {
    const player = this.players.find(p => p.id === id);
    if (!player) return this.players.length === 0;
    this.players = this.players.filter(p => p.id !== id);
    const team = this.teams.find(t => t.id === player.teamId);
    if (team) {
      team.playerIds = team.playerIds.filter(playerId => playerId !== id);
      if (!team.playerIds.length) {
        clearTimeout(team.respawnTimer);
        this.teams = this.teams.filter(t => t.id !== team.id);
      } else if (team.captain === id) {
        team.captain = team.playerIds[0];
        team.name = this.players.find(p => p.id === team.captain).username;
      }
    }
    if (!this.players.length) { this.stop(); return true; }
    if (this.host === id) this.host = this.teams.length ? this.teams[0].captain : this.players[0].id;
    if (this.phase !== 'lobby') {
      if (this.teams.length < 2) this.end('Not enough teams left.');
      else if (team && team.playerIds.length) this.assign(team);
    }
    this.push();
    return false;
  }
  assign(team) {
    const players = this.players.filter(p => p.teamId === team.id);
    players.forEach(p => p.dirs = []);
    shuffle(Object.keys(DIRS)).forEach((d, i) => players[i % players.length].dirs.push(d));
  }
  spawn(team, index) {
    const positions = [
      { x: 3, y: 3, dir: 'right' },
      { x: W - 4, y: 3, dir: 'left' },
      { x: 3, y: H - 4, dir: 'right' },
      { x: W - 4, y: H - 4, dir: 'left' }
    ];
    const tailStep = { right: { x: -1, y: 0 }, left: { x: 1, y: 0 }, up: { x: 0, y: 1 }, down: { x: 0, y: -1 } };
    const occupied = this.teams.filter(t => t !== team && t.alive && t.snake).flatMap(t => t.snake);
    const makeSnake = start => [0, 1, 2].map(offset => ({
      x: start.x + tailStep[start.dir].x * offset,
      y: start.y + tailStep[start.dir].y * offset
    }));
    const safe = start => {
      const snake = makeSnake(start);
      return snake.every(c => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H
        && !occupied.some(other => other.x === c.x && other.y === c.y)
        && (!this.food || this.food.x !== c.x || this.food.y !== c.y));
    };
    let start = positions[index % positions.length];
    if (!safe(start)) {
      const alternatives = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        for (const dir of Object.keys(DIRS)) alternatives.push({ x, y, dir });
      }
      const offset = Math.floor(Math.random() * alternatives.length);
      start = null;
      for (let i = 0; i < alternatives.length; i++) {
        const candidate = alternatives[(i + offset) % alternatives.length];
        if (safe(candidate)) { start = candidate; break; }
      }
      if (!start) { team.snake = null; team.alive = false; team.lives = 0; return false; }
    }
    team.snake = makeSnake(start);
    team.dir = start.dir;
    team.pending = null;
    team.alive = true;
    return true;
  }
  start(id) {
    if (id !== this.host) return 'Only the arena host can start the clash.';
    if (this.phase !== 'lobby') return 'Clash already running.';
    if (this.teams.length < 2) return 'You need at least 2 teams to start a clash.';
    this.teams.forEach((team, i) => {
      this.assign(team);
      team.participantIds = [...team.playerIds];
      team.score = 0; team.lives = STARTING_LIVES;
      clearTimeout(team.respawnTimer); team.respawnTimer = null;
      this.spawn(team, i);
    });
    this.placeFood();
    this.bonusFood = null; this.bonusExpiresAt = null;
    if (this.phase === 'lobby') {
      this.phase = 'countdown'; this.push();
      this.countdown = setTimeout(() => {
        this.phase = 'playing';
        if (this.durationMs) {
          this.endsAt = Date.now() + this.durationMs;
          this.matchTimer = setTimeout(() => this.end('Time is up.'), this.durationMs);
        }
        this.push();
        this.timer = setInterval(() => this.tick(), TICK_MS);
      }, 3000);
    }
    return null;
  }
  input(id, dir) {
    const player = this.players.find(p => p.id === id);
    const team = player && this.teams.find(t => t.id === player.teamId);
    if (this.phase === 'playing' && team && team.alive && team.snake && player.dirs.includes(dir)) team.pending = dir;
  }
  placeFood() {
    const occupied = this.teams.filter(t => t.alive && t.snake).flatMap(t => t.snake);
    const free = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!occupied.some(c => c.x === x && c.y === y)) free.push({ x, y });
    }
    if (!free.length) { this.food = null; this.end('No food space left.'); return; }
    this.food = free[Math.floor(Math.random() * free.length)];
  }
  placeBonusFood() {
    const occupied = this.teams.filter(t => t.alive && t.snake).flatMap(t => t.snake);
    if (this.food) occupied.push(this.food);
    const free = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!occupied.some(c => c.x === x && c.y === y)) free.push({ x, y });
    }
    if (!free.length) return;
    this.bonusFood = { ...free[Math.floor(Math.random() * free.length)], points: randomBonusPoints() };
    this.bonusExpiresAt = Date.now() + BONUS_LIFETIME_MS;
  }
  expireBonusFood() {
    if (this.bonusFood && Date.now() >= this.bonusExpiresAt) {
      this.bonusFood = null;
      this.bonusExpiresAt = null;
    }
  }
  maybeSpawnBonusFood(occupied) {
    if (!this.bonusFood && occupied.length < W * H && Math.random() < BONUS_SPAWN_CHANCE) this.placeBonusFood();
  }
  frameState() {
    return {
      food: this.food, bonusFood: this.bonusFood,
      remainingMs: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : null,
      teams: this.teams.map(t => ({
        id: t.id, name: t.name, score: t.score, alive: t.alive, lives: t.lives,
        snake: t.snake || []
      }))
    };
  }
  crash(team) {
    team.snake = null;
    if (this.crashRule === 'respawn' && team.lives > 1) {
      team.lives--;
      team.score = Math.max(0, team.score - RESPAWN_PENALTY);
      team.respawnTimer = setTimeout(() => {
        team.respawnTimer = null;
        if (this.phase !== 'playing' || !team.playerIds.length || !team.lives) return;
        this.spawn(team, this.teams.indexOf(team));
        if (!this.teams.some(other => other.alive)) { this.end('All teams were eliminated.'); return; }
        this.push();
        this.io.to(this.channel).emit('frame', this.frameState());
      }, RESPAWN_DELAY_MS);
      return;
    }
    team.lives = 0;
    team.alive = false;
  }
  tick() {
    if (this.phase !== 'playing') return;
    if (this.endsAt && Date.now() >= this.endsAt) { this.end('Time is up.'); return; }
    this.expireBonusFood();
    const candidates = new Map();
    const crashed = new Set();
    for (const team of this.teams) {
      if (!team.alive || !team.snake) continue;
      if (team.pending && team.pending !== OPP[team.dir]) team.dir = team.pending;
      team.pending = null;
      const head = team.snake[0], delta = DIRS[team.dir];
      const next = { x: head.x + delta.x, y: head.y + delta.y };
      candidates.set(team, {
        next,
        eat: this.food && next.x === this.food.x && next.y === this.food.y,
        eatBonus: this.bonusFood && next.x === this.bonusFood.x && next.y === this.bonusFood.y
      });
      if (next.x < 0 || next.y < 0 || next.x >= W || next.y >= H) crashed.add(team);
      const candidate = candidates.get(team);
      const body = candidate.eat || candidate.eatBonus ? team.snake : team.snake.slice(0, -1);
      if (body.some(c => c.x === next.x && c.y === next.y)) crashed.add(team);
    }
    const moving = [...candidates.keys()];
    for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) {
      const a = moving[i], b = moving[j], an = candidates.get(a).next, bn = candidates.get(b).next;
      const sameCell = an.x === bn.x && an.y === bn.y;
      const headSwap = an.x === b.snake[0].x && an.y === b.snake[0].y && bn.x === a.snake[0].x && bn.y === a.snake[0].y;
      if (sameCell || headSwap) { crashed.add(a); crashed.add(b); }
      if (b.snake.some(c => c.x === an.x && c.y === an.y)) crashed.add(a);
      if (a.snake.some(c => c.x === bn.x && c.y === bn.y)) crashed.add(b);
    }
    if (crashed.size && this.crashRule === 'end-match') {
      this.end('A team snake crashed.');
      return;
    }
    crashed.forEach(team => this.crash(team));
    let ate = false, ateBonus = false;
    for (const [team, candidate] of candidates) {
      if (crashed.has(team) || !team.alive || !team.snake) continue;
      team.snake.unshift(candidate.next);
      if (candidate.eat) { team.score++; ate = true; }
      if (candidate.eatBonus) { team.score += this.bonusFood.points; ateBonus = true; }
      if (!candidate.eat && !candidate.eatBonus) team.snake.pop();
    }
    if (ate) {
      this.placeFood();
      this.maybeSpawnBonusFood(this.teams.filter(t => t.alive && t.snake).flatMap(t => t.snake));
    }
    if (ateBonus) {
      this.bonusFood = null; this.bonusExpiresAt = null;
    }
    if (!this.teams.some(team => team.alive)) {
      this.end('All teams were eliminated.');
      return;
    }
    this.io.to(this.channel).emit('frame', this.frameState());
  }
  stop() {
    clearInterval(this.timer); clearTimeout(this.countdown); clearTimeout(this.matchTimer);
    this.timer = this.countdown = this.matchTimer = null;
    this.endsAt = null;
    this.teams.forEach(team => { clearTimeout(team.respawnTimer); team.respawnTimer = null; });
  }
  end(reason) {
    if (this.phase === 'lobby') return;
    this.stop();
    const teams = this.teams.map(t => ({ id: t.id, name: t.name, score: t.score, alive: t.alive }));
    const results = this.teams.map(t => ({
      id: t.id, name: t.name, score: t.score, alive: t.alive, participantIds: [...t.participantIds]
    }));
    const high = teams.length ? Math.max(...teams.map(t => t.score)) : 0;
    const winners = teams.filter(t => t.score === high);
    this.phase = 'lobby';
    this.players.forEach(p => p.dirs = []);
    this.teams.forEach(t => { t.snake = null; t.alive = false; t.lives = 0; });
    this.bonusFood = null; this.bonusExpiresAt = null;
    this.io.to(this.channel).emit('over', {
      teams, winners: winners.map(t => t.name), highScore: high, reason: reason || null
    });
    this.push();
    if (this.onEnd) this.onEnd(results);
  }
}

module.exports = {
  Room, ClashArena, MAX_PLAYERS, MAX_TEAMS, RESPAWN_DELAY_MS, RESPAWN_PENALTY, STARTING_LIVES,
  BONUS_SPAWN_CHANCE, BONUS_LIFETIME_MS, BONUS_MIN_POINTS, BONUS_MAX_POINTS
};
