const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const isHighScoreVisibility = visibility => ['public', 'private', 'hidden'].includes(visibility);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && /neon\.tech/i.test(DATABASE_URL) ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 10000
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      clash_high_score INTEGER NOT NULL DEFAULT 0 CHECK (clash_high_score >= 0),
      high_score_visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (high_score_visibility IN ('public', 'private', 'hidden')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS users_high_score_leaderboard_idx
      ON users (clash_high_score DESC, username)
      WHERE high_score_visibility = 'public' AND clash_high_score > 0;
    CREATE TABLE IF NOT EXISTS friendships (
      id UUID PRIMARY KEY,
      requester UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (requester <> recipient)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS friendships_unique_pair_idx
      ON friendships (LEAST(requester, recipient), GREATEST(requester, recipient));
  `);
}

async function findUserById(id) {
  const { rows } = await pool.query(
    `SELECT id, username, email, pass_hash AS "passHash",
            clash_high_score AS "clashHighScore",
            high_score_visibility AS "highScoreVisibility"
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function findUserByLogin(identifier) {
  const { rows } = await pool.query(
    `SELECT id, username, email, pass_hash AS "passHash" FROM users
     WHERE username = $1 OR email = $1`,
    [identifier]
  );
  return rows[0] || null;
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT id, username FROM users WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

async function createUser({ id, username, email, passHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, username, email, pass_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, pass_hash AS "passHash",
               clash_high_score AS "clashHighScore",
               high_score_visibility AS "highScoreVisibility"`,
    [id, username, email, passHash]
  );
  return rows[0];
}

async function getHighScores(userId) {
  const [{ rows: ownRows }, { rows: leaders }] = await Promise.all([
    pool.query(
      `SELECT clash_high_score AS "clashHighScore",
              high_score_visibility AS "highScoreVisibility"
       FROM users WHERE id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT username, clash_high_score AS score FROM users
       WHERE high_score_visibility = 'public' AND clash_high_score > 0
       ORDER BY clash_high_score DESC, username ASC LIMIT 10`
    )
  ]);
  return { user: ownRows[0] || null, leaders };
}

async function setHighScoreVisibility(userId, visibility) {
  await pool.query(
    `UPDATE users SET high_score_visibility = $2, updated_at = NOW() WHERE id = $1`,
    [userId, visibility]
  );
}

async function deleteUser(id) {
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

async function getFriendIds(userId) {
  const { rows } = await pool.query(
    `SELECT CASE WHEN requester = $1 THEN recipient ELSE requester END AS id
     FROM friendships WHERE status = 'accepted' AND (requester = $1 OR recipient = $1)`,
    [userId]
  );
  return rows.map(row => row.id);
}

async function getFriendshipsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.requester, f.recipient, f.status,
            requester.username AS requester_username,
            recipient.username AS recipient_username
     FROM friendships f
     JOIN users requester ON requester.id = f.requester
     JOIN users recipient ON recipient.id = f.recipient
     WHERE f.requester = $1 OR f.recipient = $1`,
    [userId]
  );
  return rows;
}

async function findFriendshipBetween(userId, otherId) {
  const { rows } = await pool.query(
    `SELECT id, requester, recipient, status FROM friendships
     WHERE (requester = $1 AND recipient = $2)
        OR (requester = $2 AND recipient = $1)`,
    [userId, otherId]
  );
  return rows[0] || null;
}

async function findFriendshipById(id) {
  const { rows } = await pool.query(
    'SELECT id, requester, recipient, status FROM friendships WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function createFriendship({ id, requester, recipient }) {
  const { rows } = await pool.query(
    `INSERT INTO friendships (id, requester, recipient)
     VALUES ($1, $2, $3)
     RETURNING id, requester, recipient, status`,
    [id, requester, recipient]
  );
  return rows[0];
}

async function updateFriendshipStatus(id, status) {
  await pool.query(
    'UPDATE friendships SET status = $2, updated_at = NOW() WHERE id = $1',
    [id, status]
  );
}

async function deleteFriendshipById(id) {
  await pool.query('DELETE FROM friendships WHERE id = $1', [id]);
}

async function deleteFriendshipBetween(userId, otherId) {
  await pool.query(
    `DELETE FROM friendships WHERE (requester = $1 AND recipient = $2)
       OR (requester = $2 AND recipient = $1)`,
    [userId, otherId]
  );
}

async function saveClashHighScores(results) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const team of results) {
      if (!team.participantIds.length) continue;
      await client.query(
        `UPDATE users SET clash_high_score = GREATEST(clash_high_score, $1),
                          updated_at = NOW()
         WHERE id = ANY($2::uuid[])`,
        [team.score, team.participantIds]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initializeDatabase,
  findUserById,
  findUserByLogin,
  findUserByUsername,
  createUser,
  getHighScores,
  setHighScoreVisibility,
  deleteUser,
  getFriendIds,
  getFriendshipsForUser,
  findFriendshipBetween,
  findFriendshipById,
  createFriendship,
  updateFriendshipStatus,
  deleteFriendshipById,
  deleteFriendshipBetween,
  saveClashHighScores,
  isHighScoreVisibility
};
