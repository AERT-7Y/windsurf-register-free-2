const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const windsurfService = require('../services/windsurf');
const db = require('../services/database');
const switchService = require('../services/switch');
const directSwitch = require('../services/direct-switch');

let mainWindow;

function isDevinSessionToken(token) {
  return Boolean(token && String(token).startsWith('devin-session-token$'));
}

function parseAuthStatus(rawAuthStatus) {
  if (!rawAuthStatus || rawAuthStatus === 'null') {
    return null;
  }

  try {
    return JSON.parse(rawAuthStatus);
  } catch {
    return null;
  }
}

function buildCurrentAccountSummary(accounts, liveState) {
  const authStatus = parseAuthStatus(liveState.authStatus);
  const matchedAccount = accounts.find((account) =>
    account.api_key &&
    (account.api_key === liveState.secretSessionToken || account.api_key === liveState.token)
  ) || accounts.find((account) =>
    account.email &&
    liveState.lastLoginEmail &&
    account.email.toLowerCase() === String(liveState.lastLoginEmail).toLowerCase()
  ) || null;

  if (!matchedAccount && !liveState.secretSessionToken && !liveState.token && !liveState.lastLoginEmail) {
    return null;
  }

  return {
    accountId: matchedAccount ? matchedAccount.id : null,
    email: matchedAccount ? matchedAccount.email : (liveState.lastLoginEmail || authStatus?.email || ''),
    name: matchedAccount ? matchedAccount.name : '',
    planName: matchedAccount ? matchedAccount.plan_name : '',
    dailyQuota: matchedAccount ? matchedAccount.daily_quota : 0,
    weeklyQuota: matchedAccount ? matchedAccount.weekly_quota : 0,
    status: matchedAccount ? matchedAccount.status : 'unknown',
    updatedAt: matchedAccount ? matchedAccount.updated_at : '',
    sessionLabel: liveState.secretSessionLabel || '',
    apiServerUrl: liveState.secretApiServerUrl || liveState.stateApiServerUrl || '',
    authStatusRaw: liveState.authStatus,
    loggedIn: liveState.authStatus && liveState.authStatus !== 'null',
    tokenPreview: liveState.secretSessionToken || liveState.token || '',
    userStatus: authStatus?.userStatusJson || authStatus?.userStatusProtoBinaryBase64 || null,
  };
}

// Forward logs to renderer, but never let broken stdout/stderr crash the app.
const origLog = console.log.bind(console);
const origError = console.error.bind(console);

function safeWriteLog(writer, args) {
  try {
    writer(...args);
  } catch (error) {
    if (!String(error && error.code || '').includes('EPIPE')) {
      try {
        origError('[main-log-fallback]', error && error.message ? error.message : String(error));
      } catch {}
    }
  }
}

function forwardLogToRenderer(args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('console-log', args.map((item) => {
        if (typeof item === 'string') return item;
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }).join(' '));
    }
  } catch {}
}

console.log = (...args) => {
  safeWriteLog(origLog, args);
  forwardLogToRenderer(args);
};

console.error = (...args) => {
  safeWriteLog(origError, args);
  forwardLogToRenderer(args);
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Windsurf Manager',
    backgroundColor: '#0a0a0f',
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await db.init();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ========== IPC Handlers ==========

ipcMain.handle('accounts:list', async () => {
  return db.getAllAccounts();
});

ipcMain.handle('accounts:overview', async () => {
  const accounts = db.getAllAccounts();
  const liveState = await directSwitch.readLiveAuthStateFromFile();
  const current = buildCurrentAccountSummary(accounts, liveState);
  const enrichedAccounts = accounts.map((account) => ({
    ...account,
    isCurrent: Boolean(current && current.accountId === account.id),
    hasPassword: Boolean(account.password),
    hasRefreshToken: Boolean(account.refresh_token),
    hasIdToken: Boolean(account.id_token),
    tokenKind: account.api_key && String(account.api_key).startsWith('devin-session-token$')
      ? 'devin-session'
      : (account.api_key ? 'api-key' : 'missing'),
  }));

  return {
    accounts: enrichedAccounts,
    current,
    liveState: {
      loggedIn: liveState.authStatus && liveState.authStatus !== 'null',
      lastLoginEmail: liveState.lastLoginEmail || '',
      sessionLabel: liveState.secretSessionLabel || '',
      apiServerUrl: liveState.secretApiServerUrl || liveState.stateApiServerUrl || '',
    },
  };
});

ipcMain.handle('accounts:add', async (event, { email, password }) => {
  console.log(`[ADD] Starting login for: ${email}`);
  try {
    const result = await windsurfService.login(email, password, { reason: 'add' });
    console.log(`[ADD] Login success: ${email}, plan: ${result.plan_name}`);
    db.saveAccount(email, password, result);
    return { success: true, data: result };
  } catch (e) {
    console.log(`[ADD] Login failed: ${email}, error: ${e.message}`);
    db.saveAccount(email, password, { status: 'failed', api_key: '' });
    return { success: false, error: e.message };
  }
});

ipcMain.handle('accounts:delete', async (event, id) => {
  db.deleteAccount(id);
  return { success: true };
});

ipcMain.handle('accounts:refresh', async (event, id) => {
  const acc = db.getAccountById(id);
  if (!acc) return { success: false, error: 'Account not found' };

  /** try 里已用密码调过 login 时，catch 不应再 login，否则会同一账号打两次 Firebase、日志重复 */
  let passwordLoginAttemptedInTry = false;

  try {
    if (!acc.api_key) {
      console.log(`[REFRESH] No token for ${acc.email}, re-login...`);
      passwordLoginAttemptedInTry = true;
      const loginResult = await windsurfService.login(acc.email, acc.password, { reason: 'refresh' });
      db.updateAccount(id, loginResult);
      return { success: true, data: loginResult };
    }

    if (isDevinSessionToken(acc.api_key)) {
      console.log(`[REFRESH] Devin token detected for ${acc.email}, checking status only...`);
      const statusResult = await windsurfService.checkStatus(acc);
      db.updateAccount(id, statusResult);
      return { success: true, data: statusResult };
    }

    if (!acc.refresh_token && acc.password) {
      console.log(`[REFRESH] No refresh_token for ${acc.email}, re-login with password...`);
      passwordLoginAttemptedInTry = true;
      const loginResult = await windsurfService.login(acc.email, acc.password, { reason: 'refresh' });
      db.updateAccount(id, loginResult);
      return { success: true, data: loginResult };
    }

    const result = await windsurfService.refreshAccount(acc);
    db.updateAccount(id, result);
    return { success: true, data: result };
  } catch (e) {
    console.log(`[REFRESH] Failed: ${acc.email}, error: ${e.message}`);
    if (acc.password && !passwordLoginAttemptedInTry) {
      try {
        console.log(`[REFRESH] Re-login for ${acc.email}...`);
        const loginResult = await windsurfService.login(acc.email, acc.password, { reason: 'refresh' });
        db.updateAccount(id, loginResult);
        return { success: true, data: loginResult };
      } catch (loginErr) {
        db.updateAccount(id, { status: 'failed' });
        return { success: false, error: loginErr.message };
      }
    }
    db.updateAccount(id, { status: 'failed' });
    return { success: false, error: e.message };
  }
});

ipcMain.handle('accounts:refreshAll', async () => {
  const accounts = db.getAllAccounts();
  const results = [];
  for (const acc of accounts) {
    let passwordLoginAttemptedInTry = false;
    try {
      if (!acc.api_key && acc.password) {
        passwordLoginAttemptedInTry = true;
        const loginResult = await windsurfService.login(acc.email, acc.password, { reason: 'refresh' });
        db.updateAccount(acc.id, loginResult);
        results.push({ id: acc.id, email: acc.email, success: true, relogin: true });
      } else if (isDevinSessionToken(acc.api_key)) {
        const statusResult = await windsurfService.checkStatus(acc);
        db.updateAccount(acc.id, statusResult);
        results.push({ id: acc.id, email: acc.email, success: true, statusOnly: true });
      } else if (acc.api_key && !acc.refresh_token && acc.password) {
        passwordLoginAttemptedInTry = true;
        const loginResult = await windsurfService.login(acc.email, acc.password, { reason: 'refresh' });
        db.updateAccount(acc.id, loginResult);
        results.push({ id: acc.id, email: acc.email, success: true, relogin: true });
      } else if (acc.api_key) {
        const result = await windsurfService.refreshAccount(acc);
        db.updateAccount(acc.id, result);
        results.push({ id: acc.id, email: acc.email, success: true });
      } else {
        results.push({ id: acc.id, email: acc.email, success: false, error: 'No password saved' });
      }
    } catch (e) {
      if (acc.password && !passwordLoginAttemptedInTry) {
        try {
          const loginResult = await windsurfService.login(acc.email, acc.password, { reason: 'refresh' });
          db.updateAccount(acc.id, loginResult);
          results.push({ id: acc.id, email: acc.email, success: true, relogin: true });
          continue;
        } catch (loginErr) {
          db.updateAccount(acc.id, { status: 'failed' });
        }
      } else if (passwordLoginAttemptedInTry) {
        db.updateAccount(acc.id, { status: 'failed' });
      }
      results.push({ id: acc.id, email: acc.email, success: false, error: e.message });
    }
  }
  return results;
});

ipcMain.handle('accounts:import', async (event, text) => {
  let accounts = [];
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) {
      accounts = json.map(item => ({
        email: item.email || item.e || '',
        password: item.password || item.p || item.pwd || '',
      }));
    } else if (json.email && json.password) {
      accounts = [{ email: json.email, password: json.password }];
    }
  } catch (e) {
    const lines = text.split('\n').filter(l => l.trim());
    accounts = lines.map(line => {
      const parts = line.trim().split(':');
      return { email: parts[0]?.trim() || '', password: parts[1]?.trim() || '' };
    });
  }

  accounts = accounts.filter(a => a.email && a.email.includes('@') && a.password);

  let imported = 0;
  let success = 0;
  const failed = [];
  for (const acc of accounts) {
    try {
      const result = await windsurfService.login(acc.email, acc.password, { reason: 'import' });
      db.saveAccount(acc.email, acc.password, result);
      imported++;
      success++;
    } catch (error) {
      db.saveAccount(acc.email, acc.password, { status: 'failed', api_key: '' });
      imported++;
      failed.push({ email: acc.email, error: error.message });
      console.error(`Import failed for ${acc.email}:`, error.message);
    }
  }
  return { imported, success, failed, total: accounts.length };
});

ipcMain.handle('accounts:export', async () => {
  const accounts = db.getAllAccounts();
  return accounts.map(a => `${a.email}:${a.password}`).join('\n');
});

ipcMain.handle('accounts:checkStatus', async (event, id) => {
  const acc = db.getAccountById(id);
  if (!acc) return { success: false, error: 'Account not found' };
  try {
    const status = await windsurfService.checkStatus(acc);
    return { success: true, data: status };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('proxy:getStatus', async () => {
  try {
    const proxy = windsurfService.getProxy();
    return { proxy: proxy || 'Direct (no proxy)' };
  } catch (e) {
    return { proxy: 'Detection failed' };
  }
});

ipcMain.handle('accounts:deleteAll', async () => {
  db.deleteAllAccounts();
  return { success: true };
});

ipcMain.handle('accounts:importFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择账号文件',
    filters: [
      { name: 'JSON', extensions: ['json'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const content = require('fs').readFileSync(filePath, 'utf-8');

  let accounts = [];
  try {
    const json = JSON.parse(content);
    if (Array.isArray(json)) {
      accounts = json.map(item => ({
        email: item.email || item.e || '',
        password: item.password || item.p || item.pwd || '',
      }));
    } else if (json.email && json.password) {
      accounts = [{ email: json.email, password: json.password }];
    }
  } catch (e) {
    const lines = content.split('\n').filter(l => l.trim());
    accounts = lines.map(line => {
      const parts = line.trim().split(':');
      return { email: parts[0]?.trim() || '', password: parts[1]?.trim() || '' };
    });
  }

  accounts = accounts.filter(a => a.email && a.email.includes('@') && a.password);

  if (accounts.length === 0) {
    return { success: false, error: 'No valid accounts found', imported: 0 };
  }

  let imported = 0;
  let success = 0;
  const failed = [];
  for (const acc of accounts) {
    try {
      const result = await windsurfService.login(acc.email, acc.password, { reason: 'import' });
      db.saveAccount(acc.email, acc.password, result);
      imported++;
      success++;
    } catch (error) {
      db.saveAccount(acc.email, acc.password, { status: 'failed', api_key: '' });
      imported++;
      failed.push({ email: acc.email, error: error.message });
      console.error(`Import failed for ${acc.email}:`, error.message);
    }
  }

  return { success: failed.length === 0, imported, successCount: success, failed, total: accounts.length };
});

ipcMain.handle('app:isAdmin', async () => {
  return directSwitch.isAdmin();
});

ipcMain.handle('accounts:switch', async (event, id) => {
  const acc = db.getAccountById(id);
  if (!acc) return { success: false, error: 'Account not found' };

  if (!acc.api_key) {
    return { success: false, error: '该账号没有有效的 api_key，请先刷新账号' };
  }

  // Check admin privilege
  if (!directSwitch.isAdmin()) {
    return { success: false, error: '需要管理员权限，请以管理员身份运行程序' };
  }

  try {
    const result = await switchService.switchToAccount(acc);
    return { success: true, email: result.email };
  } catch (e) {
    console.log(`[SWITCH] Error: ${e.message}`);
    return { success: false, error: e.message };
  }
});
