const test = require('node:test');
const assert = require('node:assert/strict');
const { User } = require('../server/models');

test('new users default to a private clash high score', () => {
  const user = new User({ username: 'player1', email: 'player@example.com', passHash: 'hash' });
  assert.equal(user.clashHighScore, 0);
  assert.equal(user.highScoreVisibility, 'private');
});

test('high-score visibility accepts only public, private, and hidden', () => {
  for (const visibility of ['public', 'private', 'hidden']) {
    const user = new User({
      username: 'player1',
      email: 'player@example.com',
      passHash: 'hash',
      highScoreVisibility: visibility
    });
    assert.equal(user.validateSync(), undefined);
  }
  const invalid = new User({
    username: 'player1',
    email: 'player@example.com',
    passHash: 'hash',
    highScoreVisibility: 'friends'
  });
  assert.match(invalid.validateSync().errors.highScoreVisibility.message, /`friends` is not a valid enum value/);
});
