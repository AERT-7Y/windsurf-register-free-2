const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(process.cwd(), 'data', 'accounts.db');
const WASM_PATH = path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

let db;

async function init() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: () => WASM_PATH,
  });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create table with new fields if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      name TEXT,
      plan_name TEXT DEFAULT '',
      daily_quota INTEGER DEFAULT 0,
      weekly_quota INTEGER DEFAULT 0,
      api_key TEXT DEFAULT '',
      refresh_token TEXT DEFAULT '',
      id_token TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      status TEXT DEFAULT 'unknown',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migrate existing table to add new fields if needed
  // Check if columns exist
  try {
    db.exec('ALTER TABLE accounts ADD COLUMN refresh_token TEXT DEFAULT ""');
  } catch {}
  try {
    db.exec('ALTER TABLE accounts ADD COLUMN id_token TEXT DEFAULT ""');
  } catch {}
  try {
    db.exec('ALTER TABLE accounts ADD COLUMN expires_at TEXT DEFAULT ""');
  } catch {}

  save();
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getAllAccounts() {
  const results = db.exec('SELECT * FROM accounts ORDER BY created_at DESC');
  if (results.length === 0) return [];
  const cols = results[0].columns;
  return results[0].values.map(row => {
    const obj = {};
    cols.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function getAccountById(id) {
  const results = db.exec('SELECT * FROM accounts WHERE id = ?', [id]);
  if (results.length === 0 || results[0].values.length === 0) return null;
  const cols = results[0].columns;
  const row = results[0].values[0];
  const obj = {};
  cols.forEach((col, i) => obj[col] = row[i]);
  return obj;
}

function getAccountByEmail(email) {
  const results = db.exec('SELECT * FROM accounts WHERE email = ?', [email]);
  if (results.length === 0 || results[0].values.length === 0) return null;
  const cols = results[0].columns;
  const row = results[0].values[0];
  const obj = {};
  cols.forEach((col, i) => obj[col] = row[i]);
  return obj;
}

function saveAccount(email, password, data = {}) {
  db.run(`
    INSERT OR REPLACE INTO accounts (email, password, name, plan_name, daily_quota, weekly_quota, api_key, refresh_token, id_token, expires_at, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    email,
    password,
    data.name || '',
    data.plan_name || '',
    data.daily_quota || 0,
    data.weekly_quota || 0,
    data.api_key || '',
    data.refresh_token || '',
    data.id_token || '',
    data.expires_at || '',
    data.status || 'active'
  ]);
  save();
}

function updateAccount(id, data) {
  const sets = [];
  const vals = [];

  if (data.plan_name !== undefined) { sets.push('plan_name = ?'); vals.push(data.plan_name); }
  if (data.daily_quota !== undefined) { sets.push('daily_quota = ?'); vals.push(data.daily_quota); }
  if (data.weekly_quota !== undefined) { sets.push('weekly_quota = ?'); vals.push(data.weekly_quota); }
  if (data.api_key !== undefined) { sets.push('api_key = ?'); vals.push(data.api_key); }
  if (data.refresh_token !== undefined) { sets.push('refresh_token = ?'); vals.push(data.refresh_token); }
  if (data.id_token !== undefined) { sets.push('id_token = ?'); vals.push(data.id_token); }
  if (data.expires_at !== undefined) { sets.push('expires_at = ?'); vals.push(data.expires_at); }
  if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, vals);
  save();
}

function deleteAccount(id) {
  db.run('DELETE FROM accounts WHERE id = ?', [id]);
  save();
}

function deleteAllAccounts() {
  db.run('DELETE FROM accounts');
  save();
}

module.exports = {
  init,
  getAllAccounts,
  getAccountById,
  getAccountByEmail,
  saveAccount,
  updateAccount,
  deleteAccount,
  deleteAllAccounts,
};
