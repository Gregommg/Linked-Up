const test = require('node:test');
const assert = require('node:assert/strict');
const { isHighScoreVisibility } = require('../server/models');

test('high-score visibility accepts public, private, and hidden only', () => {
  for (const visibility of ['public', 'private', 'hidden']) {
    assert.equal(isHighScoreVisibility(visibility), true);
  }
  for (const visibility of ['friends', '', null, undefined]) {
    assert.equal(isHighScoreVisibility(visibility), false);
  }
});
