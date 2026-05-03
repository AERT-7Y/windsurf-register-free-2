const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

function log(msg) { console.log('[DirectSwitch]', msg); }

function maskKey(key) {
  if (!key || key.length < 16) return key || 'null';
  return key.substring(0, 8) + '***' + key.substring(key.length - 6);
}

function isAdmin() {
  try {
    execSync('net session >nul 2>&1', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getDBPath() {
  return path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
}

function getInstallationId() {
  const installIdPath = path.join(
    process.env.USERPROFILE, '.codeium', 'windsurf', 'installation_id'
  );
  try {
    if (fs.existsSync(installIdPath)) {
      const id = fs.readFileSync(installIdPath, 'utf8').trim();
      if (id) {
        log(`installation_id from file: ${id}`);
        return id;
      }
    }
  } catch (e) {
    log(`failed reading installation_id: ${e.message}`);
  }
  const newId = crypto.randomUUID();
  log(`generated installation_id: ${newId}`);
  return newId;
}

function generateAuthTag() {
  return crypto.randomBytes(8).toString('hex');
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const bodyText = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyText),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ${text}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error(`invalid JSON response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    req.write(bodyText);
    req.end();
  });
}

async function resolveCanonicalAuthProfile(sessionToken) {
  const windsurfAuth = require('./windsurf-auth');
  const oneTimeAuthToken = await windsurfAuth.getOneTimeAuthToken(sessionToken);
  const registerResponse = await postJson(
    'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser',
    { firebase_id_token: oneTimeAuthToken }
  );

  const apiKey = registerResponse.api_key || registerResponse.apiKey || sessionToken;
  const displayName = registerResponse.name || null;
  const apiServerUrl = registerResponse.api_server_url || registerResponse.apiServerUrl || null;

  log(`canonical auth profile resolved: name=${displayName || 'null'}, apiServerUrl=${apiServerUrl || 'null'}`);

  return {
    apiKey,
    displayName,
    apiServerUrl,
  };
}

function getElectronExePath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Local Electron runtime not found; cannot access Windows safeStorage');
}

function runElectronSafeStorage(action, payload) {
  const electronExe = getElectronExePath();
  const tempScriptPath = path.join(os.tmpdir(), `windsurf-safe-storage-${process.pid}-${Date.now()}.js`);
  const script = `
const { app, safeStorage } = require('electron');
const action = process.argv[2];
const payload = JSON.parse(process.argv[3] || '{}');

app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows safeStorage is not available');
    }

    let result;
    if (action === 'encrypt') {
      result = {};
      for (const [key, value] of Object.entries(payload)) {
        result[key] = safeStorage.encryptString(String(value)).toString('base64');
      }
    } else if (action === 'decrypt') {
      result = {};
      for (const [key, value] of Object.entries(payload)) {
        result[key] = safeStorage.decryptString(Buffer.from(String(value), 'base64'));
      }
    } else {
      throw new Error('Unknown safeStorage action: ' + action);
    }

    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: error && error.message ? error.message : String(error),
    }));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
`;

  fs.writeFileSync(tempScriptPath, script, 'utf8');

  try {
    const output = execFileSync(
      electronExe,
      [tempScriptPath, action, JSON.stringify(payload)],
      { encoding: 'utf8', windowsHide: true }
    ).trim();

    const parsed = JSON.parse(output || '{}');
    if (!parsed.ok) {
      throw new Error(parsed.error || 'safeStorage call failed');
    }

    return parsed.result || {};
  } finally {
    try { fs.unlinkSync(tempScriptPath); } catch {}
  }
}

async function openStateDb() {
  const initSqlJs = require('sql.js');
  const dbPath = getDBPath();
  const dbBuffer = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  return {
    dbPath,
    db: new SQL.Database(dbBuffer),
  };
}

function readSingleValue(db, key) {
  const result = db.exec(`SELECT value FROM ItemTable WHERE key = '${key.replace(/'/g, "''")}'`);
  if (!result.length || !result[0].values.length) return null;
  return result[0].values[0][0];
}

function writeToDBPlain(db, key, value) {
  try {
    const r = db.exec(`SELECT COUNT(*) FROM ItemTable WHERE key = '${key.replace(/'/g, "''")}'`);
    const existed = r.length ? r[0].values[0][0] : 0;
    db.run('DELETE FROM ItemTable WHERE key = ?', [key]);
    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [key, value]);
    log(`  wrote [${key}] (${String(value).length} bytes, existed=${existed > 0})`);
  } catch (e) {
    if (e.message.includes('no such table')) {
      db.run('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT, value TEXT)');
      db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', [key, value]);
      log(`  created ItemTable and wrote [${key}]`);
    } else {
      throw e;
    }
  }
}

function verifyDB(db, keys) {
  log('--- verify written keys ---');
  let allOk = true;
  for (const k of keys) {
    try {
      const r = db.exec(`SELECT value FROM ItemTable WHERE key = '${k.replace(/'/g, "''")}'`);
      if (r.length && r[0].values.length) {
        const v = r[0].values[0][0];
        if (v === null) {
          log(`  ok [${k}] = null`);
        } else if (String(v).length > 120) {
          const s = String(v);
          log(`  ok [${k}] = ${s.substring(0, 60)}...${s.substring(s.length - 40)}`);
        } else {
          log(`  ok [${k}] = ${v}`);
        }
      } else {
        log(`  missing [${k}]`);
        allOk = false;
      }
    } catch (e) {
      log(`  query failed [${k}]: ${e.message}`);
      allOk = false;
    }
  }
  log(`--- verify ${allOk ? 'passed' : 'failed'} ---`);
  return allOk;
}

function readCurrentAuthState(db) {
  const rawConfig = readSingleValue(db, 'codeium.windsurf');
  let config = {};
  if (typeof rawConfig === 'string' && rawConfig.trim()) {
    try {
      config = JSON.parse(rawConfig);
    } catch (e) {
      log(`failed parsing codeium.windsurf, using empty object: ${e.message}`);
    }
  }

  return {
    config,
    authStatus: readSingleValue(db, 'windsurfAuthStatus'),
    authTag: readSingleValue(db, 'windsurf_auth'),
    lastLoginEmail: readSingleValue(db, 'lastLoginEmail'),
    lastLoginEmailStaging: readSingleValue(db, 'lastLoginEmail.staging'),
    apiServerUrl: readSingleValue(db, 'apiServerUrl'),
    apiServerUrlStaging: readSingleValue(db, 'apiServerUrl.staging'),
    encryptedSessions: readSingleValue(db, 'secret://windsurf_auth.sessions'),
    encryptedApiServerUrl: readSingleValue(db, 'secret://windsurf_auth.apiServerUrl'),
  };
}

function decodePersistedSecrets(currentState) {
  const encryptedPayload = {};

  if (currentState.encryptedSessions) {
    encryptedPayload.sessions = currentState.encryptedSessions;
  }
  if (currentState.encryptedApiServerUrl) {
    encryptedPayload.apiServerUrl = currentState.encryptedApiServerUrl;
  }

  if (Object.keys(encryptedPayload).length === 0) {
    return {
      sessions: [],
      apiServerUrl: null,
    };
  }

  try {
    const decrypted = runElectronSafeStorage('decrypt', encryptedPayload);
    return {
      sessions: decrypted.sessions ? JSON.parse(decrypted.sessions) : [],
      apiServerUrl: decrypted.apiServerUrl || null,
    };
  } catch (e) {
    log(`failed decrypting persisted secrets: ${e.message}`);
    return {
      sessions: [],
      apiServerUrl: null,
    };
  }
}

function readLiveAuthStateFromFile() {
  const dbPath = getDBPath();
  if (!fs.existsSync(dbPath)) {
    return {
      token: null,
      authStatus: null,
      authTag: null,
      secretSessionToken: null,
      secretSessionLabel: null,
      secretApiServerUrl: null,
    };
  }
  const initSqlJs = require('sql.js');
  return initSqlJs().then(SQL => {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    try {
      const state = readCurrentAuthState(db);
      const secrets = decodePersistedSecrets(state);
      const firstSession = Array.isArray(secrets.sessions) && secrets.sessions.length > 0
        ? secrets.sessions[0]
        : null;
      return {
        token: state.config['codeium.apiKey'] || null,
        authStatus: state.authStatus,
        authTag: state.authTag,
        lastLoginEmail: state.lastLoginEmail || state.lastLoginEmailStaging || null,
        stateApiServerUrl: state.apiServerUrl || state.apiServerUrlStaging || null,
        secretSessionToken: firstSession ? firstSession.accessToken || null : null,
        secretSessionLabel: firstSession && firstSession.account ? firstSession.account.label || null : null,
        secretApiServerUrl: secrets.apiServerUrl,
      };
    } finally {
      try { db.close(); } catch {}
    }
  });
}

async function switchAccountToDB(account) {
  log('========================================');
  log(`switching account: ${account.email}`);
  log(`session token: ${maskKey(account.api_key)}`);
  log('========================================');

  if (!isAdmin()) {
    throw new Error('Administrator privileges are required');
  }

  const dbPath = getDBPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Windsurf database not found: ${dbPath}`);
  }

  const dbStat = fs.statSync(dbPath);
  log(`database: ${dbPath} (${dbStat.size} bytes)`);

  const resolvedAuth = await resolveCanonicalAuthProfile(account.api_key);
  const sessionToken = resolvedAuth.apiKey || account.api_key;
  const apiServerUrl = resolvedAuth.apiServerUrl || 'https://server.self-serve.windsurf.com';
  const sessionLabel = resolvedAuth.displayName || account.name || account.email;
  const { db } = await openStateDb();

  try {
    try {
      const countR = db.exec('SELECT COUNT(*) FROM ItemTable');
      log(`existing row count: ${countR[0].values[0][0]}`);
    } catch {
      log('ItemTable missing, will create on write');
    }

    const currentState = readCurrentAuthState(db);
    log(`current codeium.apiKey: ${maskKey(currentState.config['codeium.apiKey'])}`);
    log(`current windsurfAuthStatus: ${currentState.authStatus}`);
    const currentSecrets = decodePersistedSecrets(currentState);
    const currentSecretToken = currentSecrets.sessions[0]?.accessToken || null;
    log(`current secret accessToken: ${maskKey(currentSecretToken)}`);

    const cleanSql = [
      "DELETE FROM ItemTable WHERE key LIKE 'windsurf_auth-%'",
      "DELETE FROM ItemTable WHERE key = 'windsurfAuthStatus'",
      "DELETE FROM ItemTable WHERE key = 'codeium.windsurf'",
      "DELETE FROM ItemTable WHERE key = 'codeium.windsurf-windsurf_auth'",
      "DELETE FROM ItemTable WHERE key = 'windsurf_auth'",
      "DELETE FROM ItemTable WHERE key = 'apiServerUrl'",
      "DELETE FROM ItemTable WHERE key = 'apiServerUrl.staging'",
      "DELETE FROM ItemTable WHERE key = 'lastLoginEmail'",
      "DELETE FROM ItemTable WHERE key = 'lastLoginEmail.staging'",
      "DELETE FROM ItemTable WHERE key = 'secret://windsurf_auth.sessions'",
      "DELETE FROM ItemTable WHERE key = 'secret://windsurf_auth.apiServerUrl'",
    ];

    for (const sql of cleanSql) {
      try {
        db.run(sql);
      } catch (e) {
        if (e.message.includes('no such table')) {
          db.run('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT, value TEXT)');
        } else {
          throw e;
        }
      }
    }

    const installationId = getInstallationId();
    const codeiumConfig = {
      ...currentState.config,
      'codeium.installationId': currentState.config['codeium.installationId'] || installationId,
      'codeium.apiKey': sessionToken,
      apiServerUrl: apiServerUrl,
      'codeium.hasOneTimeUpdatedUnspecifiedMode': true,
    };

    writeToDBPlain(db, 'windsurfAuthStatus', 'null');
    writeToDBPlain(db, 'codeium.windsurf', JSON.stringify(codeiumConfig));
    writeToDBPlain(db, 'apiServerUrl', apiServerUrl);
    writeToDBPlain(db, 'lastLoginEmail', account.email);

    const authTag = generateAuthTag();
    writeToDBPlain(db, 'codeium.windsurf-windsurf_auth', authTag);
    writeToDBPlain(db, 'windsurf_auth', authTag);
    const persistedSessions = [
      {
        id: crypto.randomUUID(),
        accessToken: sessionToken,
        account: {
          label: sessionLabel,
          id: sessionLabel,
        },
        scopes: [],
      },
    ];

    const encryptedSecrets = runElectronSafeStorage('encrypt', {
      sessions: JSON.stringify(persistedSessions),
      apiServerUrl,
    });

    writeToDBPlain(db, 'secret://windsurf_auth.sessions', encryptedSecrets.sessions);
    writeToDBPlain(db, 'secret://windsurf_auth.apiServerUrl', encryptedSecrets.apiServerUrl);

    const writtenKeys = [
      'windsurfAuthStatus',
      'codeium.windsurf',
      'apiServerUrl',
      'lastLoginEmail',
      'codeium.windsurf-windsurf_auth',
      'windsurf_auth',
      'secret://windsurf_auth.sessions',
      'secret://windsurf_auth.apiServerUrl',
    ];
    const verified = verifyDB(db, writtenKeys);

    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    db.close();

    if (!verified) {
      throw new Error('database verification failed after switch');
    }

    log('========================================');
    log(`switch finished: ${account.email}`);
    log('========================================');
    return { success: true, email: account.email };
  } catch (e) {
    try { db.close(); } catch {}
    log(`switch failed: ${e.message}`);
    throw e;
  }
}

module.exports = { switchAccountToDB, isAdmin, readLiveAuthStateFromFile };
