const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Room, ClashArena, BONUS_SPAWN_CHANCE, BONUS_LIFETIME_MS, BONUS_MIN_POINTS, BONUS_MAX_POINTS
} = require('../server/game');

function createIO() {
  const events = [];
  return { events, to: () => ({ emit: (event, payload) => events.push({ event, payload }) }) };
}

function startPlaying(arena) {
  assert.equal(arena.start(arena.host), null);
  arena.stop();
  arena.phase = 'playing';
}

test('cooperative rooms retain their existing room and player limits', () => {
  const room = new Room('TEAM', createIO(), 'one');
  assert.equal(room.add('one', 'one'), null);
  assert.equal(room.add('two', 'two'), null);
  assert.equal(room.state().mode, 'coop');
  assert.equal(room.add('three', 'three'), null);
  assert.equal(room.add('four', 'four'), null);
  assert.match(room.add('five', 'five'), /full/);
});

test('clash arenas require two teams and maintain separate team scores', () => {
  const io = createIO();
  const arena = new ClashArena('CLSH', io, 'captain-a', { crashRule: 'eliminate' });
  assert.equal(arena.addTeam([{ id: 'captain-a', username: 'alpha' }], 'captain-a'), null);
  assert.match(arena.start('captain-a'), /at least 2 teams/);
  assert.equal(arena.addTeam([{ id: 'captain-b', username: 'beta' }], 'captain-b'), null);

  startPlaying(arena);
  arena.teams[0].snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  arena.teams[0].dir = 'right';
  arena.teams[1].snake = [{ x: 20, y: 15 }, { x: 21, y: 15 }, { x: 22, y: 15 }];
  arena.teams[1].dir = 'left';
  arena.food = { x: 11, y: 10 };
  arena.tick();

  assert.equal(arena.teams[0].score, 1);
  assert.equal(arena.teams[1].score, 0);
  assert.equal(io.events.filter(event => event.event === 'frame').length, 1);
  arena.stop();
});

test('respawning crashes deduct 20 points and consume a life', () => {
  const arena = new ClashArena('CLSH', createIO(), 'captain-a', { crashRule: 'respawn' });
  arena.addTeam([{ id: 'captain-a', username: 'alpha' }], 'captain-a');
  arena.addTeam([{ id: 'captain-b', username: 'beta' }], 'captain-b');
  startPlaying(arena);
  const [a, b] = arena.teams;
  a.score = 30;
  a.snake = [{ x: 29, y: 5 }, { x: 28, y: 5 }, { x: 27, y: 5 }];
  a.dir = 'right';
  b.snake = [{ x: 15, y: 15 }, { x: 16, y: 15 }, { x: 17, y: 15 }];
  b.dir = 'left';
  arena.food = { x: 0, y: 0 };
  arena.tick();

  assert.equal(a.score, 10);
  assert.equal(a.lives, 2);
  assert.ok(a.respawnTimer);
  arena.stop();
});

test('the clash ends with the highest-scoring team after all teams are eliminated', () => {
  const io = createIO();
  const arena = new ClashArena('CLSH', io, 'captain-a', { crashRule: 'eliminate' });
  arena.addTeam([{ id: 'captain-a', username: 'alpha' }], 'captain-a');
  arena.addTeam([{ id: 'captain-b', username: 'beta' }], 'captain-b');
  startPlaying(arena);
  const [a, b] = arena.teams;
  a.score = 4; b.score = 3;
  a.snake = [{ x: 29, y: 5 }, { x: 28, y: 5 }, { x: 27, y: 5 }];
  a.dir = 'right';
  b.snake = [{ x: 15, y: 15 }, { x: 16, y: 15 }, { x: 17, y: 15 }];
  b.dir = 'left';
  arena.food = { x: 0, y: 0 };
  arena.tick();
  assert.equal(a.alive, false);

  b.snake = [{ x: 29, y: 10 }, { x: 28, y: 10 }, { x: 27, y: 10 }];
  b.dir = 'right';
  arena.tick();
  assert.equal(arena.phase, 'lobby');
  const result = io.events.find(event => event.event === 'over');
  assert.deepEqual(result.payload.winners, ['alpha']);
  assert.equal(result.payload.highScore, 4);
});

test('a timed clash ends at its deadline with the high-score winner', () => {
  const io = createIO();
  let savedResults;
  const arena = new ClashArena('CLSH', io, 'captain-a', {
    durationMs: 120000,
    onEnd: results => { savedResults = results; }
  });
  arena.addTeam([{ id: 'captain-a', username: 'alpha' }, { id: 'player-a', username: 'helper' }], 'captain-a');
  arena.addTeam([{ id: 'captain-b', username: 'beta' }], 'captain-b');
  startPlaying(arena);
  arena.teams[0].score = 2;
  arena.teams[1].score = 5;
  arena.endsAt = Date.now() - 1;
  arena.tick();

  assert.equal(arena.phase, 'lobby');
  const result = io.events.find(event => event.event === 'over');
  assert.deepEqual(result.payload.winners, ['beta']);
  assert.equal(result.payload.reason, 'Time is up.');
  assert.deepEqual(savedResults[0].participantIds, ['captain-a', 'player-a']);
  assert.equal(savedResults[0].score, 2);
});

test('cooperative bonus food is worth extra points and grows the snake', () => {
  const io = createIO();
  const room = new Room('TEAM', io, 'one');
  room.add('one', 'one');
  room.add('two', 'two');
  startPlaying(room);
  room.snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
  room.dir = 'right';
  room.pending = null;
  room.score = 2;
  room.food = { x: 25, y: 10 };
  room.bonusFood = { x: 9, y: 10, points: 7 };
  room.bonusExpiresAt = Date.now() + BONUS_LIFETIME_MS;
  room.tick();

  assert.equal(room.score, 9);
  assert.equal(room.snake.length, 4);
  assert.equal(room.bonusFood, null);
  assert.equal(io.events.filter(event => event.event === 'frame').at(-1).payload.bonusFood, null);
  room.stop();
});

test('bonus food spawns in a free cell, has a short lifetime and is worth more than regular food', () => {
  const room = new Room('TEAM', createIO(), 'one');
  room.snake = [{ x: 4, y: 4 }, { x: 3, y: 4 }];
  room.food = { x: 5, y: 4 };
  room.placeBonusFood();

  assert.ok(room.bonusFood);
  assert.ok(room.bonusFood.points >= BONUS_MIN_POINTS);
  assert.ok(room.bonusFood.points <= BONUS_MAX_POINTS);
  assert.ok(room.bonusFood.points > 1);
  assert.ok(![...room.snake, room.food].some(c => c.x === room.bonusFood.x && c.y === room.bonusFood.y));
  assert.ok(room.bonusExpiresAt - Date.now() <= BONUS_LIFETIME_MS);
  assert.ok(room.bonusExpiresAt - Date.now() > BONUS_LIFETIME_MS - 50);
  assert.ok(BONUS_LIFETIME_MS <= 10000);
});

test('bonus food is a random chance after normal food, not a timer', () => {
  const createEatingRoom = () => {
    const room = new Room('TEAM', createIO(), 'one');
    room.snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    room.dir = 'right';
    room.score = 0;
    room.food = { x: 9, y: 10 };
    room.bonusFood = null;
    room.phase = 'playing';
    return room;
  };
  const originalRandom = Math.random;
  try {
    const noBonusRoom = createEatingRoom();
    Math.random = () => BONUS_SPAWN_CHANCE;
    noBonusRoom.tick();
    assert.equal(noBonusRoom.score, 1);
    assert.equal(noBonusRoom.bonusFood, null);
    noBonusRoom.stop();

    const bonusRoom = createEatingRoom();
    Math.random = () => BONUS_SPAWN_CHANCE - 0.01;
    bonusRoom.tick();
    assert.equal(bonusRoom.score, 1);
    assert.ok(bonusRoom.bonusFood);
    assert.equal(bonusRoom.bonusFood.points >= BONUS_MIN_POINTS, true);
    assert.equal(bonusRoom.bonusFood.points <= BONUS_MAX_POINTS, true);
    bonusRoom.stop();
  } finally {
    Math.random = originalRandom;
  }
});

test('clash bonus food adds its random-value points to the team score', () => {
  const arena = new ClashArena('CLSH', createIO(), 'captain-a', { crashRule: 'eliminate' });
  arena.addTeam([{ id: 'captain-a', username: 'alpha' }], 'captain-a');
  arena.addTeam([{ id: 'captain-b', username: 'beta' }], 'captain-b');
  startPlaying(arena);
  const [a, b] = arena.teams;
  a.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  a.dir = 'right';
  b.snake = [{ x: 20, y: 15 }, { x: 21, y: 15 }, { x: 22, y: 15 }];
  b.dir = 'left';
  arena.food = { x: 0, y: 0 };
  arena.bonusFood = { x: 11, y: 10, points: 5 };
  arena.bonusExpiresAt = Date.now() + BONUS_LIFETIME_MS;
  arena.tick();

  assert.equal(a.score, 5);
  assert.equal(a.snake.length, 4);
  assert.equal(arena.bonusFood, null);
  arena.stop();
});

test('clash bonus food only gets a random spawn chance when normal food is eaten', () => {
  const arena = new ClashArena('CLSH', createIO(), 'captain-a', { crashRule: 'eliminate' });
  arena.addTeam([{ id: 'captain-a', username: 'alpha' }], 'captain-a');
  arena.addTeam([{ id: 'captain-b', username: 'beta' }], 'captain-b');
  startPlaying(arena);
  const [a, b] = arena.teams;
  a.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  a.dir = 'right';
  b.snake = [{ x: 20, y: 15 }, { x: 21, y: 15 }, { x: 22, y: 15 }];
  b.dir = 'left';
  arena.food = { x: 0, y: 0 };

  const originalRandom = Math.random;
  try {
    Math.random = () => BONUS_SPAWN_CHANCE - 0.01;
    arena.tick();
    assert.equal(arena.bonusFood, null);
    arena.stop();
  } finally {
    Math.random = originalRandom;
  }
});
