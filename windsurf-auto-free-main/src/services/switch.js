const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const directSwitch = require('./direct-switch');
const windsurfAuth = require('./windsurf-auth');

function log(msg) { console.log('[Switch]', msg); }

function findWindsurfPath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Windsurf', 'Windsurf.exe'),
    path.join(process.env.ProgramFiles || '', 'Windsurf', 'Windsurf.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Windsurf', 'Windsurf.exe'),
    'D:\\Windsurf\\Windsurf.exe',
    'C:\\Windsurf\\Windsurf.exe',
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      log(`found Windsurf: ${p}`);
      return p;
    }
  }

  try {
    const result = execSync('where Windsurf.exe 2>nul', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (result && fs.existsSync(result.split('\n')[0].trim())) {
      const p = result.split('\n')[0].trim();
      log(`found Windsurf via where: ${p}`);
      return p;
    }
  } catch {}

  try {
    const script = `
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
foreach ($p in $paths) {
  $items = Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*Windsurf*' }
  foreach ($item in $items) {
    if ($item.InstallLocation) {
      $exe = Join-Path $item.InstallLocation 'Windsurf.exe'
      if (Test-Path $exe) { Write-Output $exe; exit }
    }
  }
}
`;
    const tempPs1 = path.join(__dirname, 'temp_findws.ps1');
    fs.writeFileSync(tempPs1, script, 'utf8');
    let result;
    try {
      result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}"`, {
        encoding: 'utf8',
      }).trim();
    } finally {
      try { fs.unlinkSync(tempPs1); } catch {}
    }
    if (result && fs.existsSync(result)) {
      log(`found Windsurf via registry: ${result}`);
      return result;
    }
  } catch {}

  log('Windsurf path not found');
  return null;
}

async function killWindsurf() {
  log('stopping Windsurf processes...');

  const procs = ['Windsurf.exe', 'Windsurf Helper.exe', 'Windsurf GPU.exe'];
  for (const proc of procs) {
    try {
      const r = execSync(`taskkill /F /T /IM "${proc}" 2>&1`, { encoding: 'utf8', timeout: 5000 });
      log(`  taskkill ${proc}: ${r.trim()}`);
    } catch (e) {
      const msg = (e.stdout || e.stderr || '').trim();
      if (msg) log(`  taskkill ${proc}: ${msg}`);
    }
  }

  if (await isWindsurfRunning()) {
    try {
      const psScript = `Get-Process -Name "Windsurf*","windsurf*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; $p = Get-Process -Name "Windsurf*" -ErrorAction SilentlyContinue; if($p){$p | Stop-Process -Force}`;
      execSync(`powershell -NoProfile -Command "${psScript}"`, { encoding: 'utf8', timeout: 10000 });
    } catch (e) {
      log(`  powershell stop-process failed: ${e.message}`);
    }
  }

  if (await isWindsurfRunning()) {
    try {
      execSync('wmic process where "name=\'Windsurf.exe\'" call terminate 2>nul', { timeout: 5000 });
    } catch {}
  }
}

async function isWindsurfRunning() {
  try {
    const r = execSync('tasklist /FI "IMAGENAME eq Windsurf.exe" /NH', { encoding: 'utf8' });
    return r.includes('Windsurf.exe');
  } catch {
    return false;
  }
}

function startWindsurf(exePath) {
  if (!exePath) exePath = findWindsurfPath();
  if (!exePath) {
    throw new Error('Windsurf is not installed or its path is unknown');
  }
  log(`starting Windsurf: ${exePath}`);
  execSync(`start "" "${exePath}"`, { shell: true, stdio: 'ignore' });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getWindsurfLogsRoot() {
  return path.join(process.env.APPDATA, 'Windsurf', 'logs');
}

function getNewestWindsurfLogDir() {
  const logsRoot = getWindsurfLogsRoot();
  if (!fs.existsSync(logsRoot)) {
    return null;
  }

  const dirs = fs.readdirSync(logsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(logsRoot, entry.name),
      mtimeMs: fs.statSync(path.join(logsRoot, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return dirs.length ? dirs[0].fullPath : null;
}

function isWindsurfLanguageServerReady() {
  try {
    const latestLogDir = getNewestWindsurfLogDir();
    if (!latestLogDir) {
      return false;
    }

    const logPaths = [
      path.join(latestLogDir, 'window1', 'exthost', 'codeium.windsurf', 'Windsurf.log'),
      path.join(latestLogDir, 'window1', 'renderer.log'),
    ];

    for (const logPath of logPaths) {
      if (!fs.existsSync(logPath)) {
        continue;
      }

      const text = fs.readFileSync(logPath, 'utf8');
      if (
        text.includes('LS lspClient started successfully') ||
        text.includes('Language server started')
      ) {
        return true;
      }
    }
  } catch (e) {
    log(`failed checking Windsurf log readiness: ${e.message}`);
  }

  return false;
}

async function waitForWindsurfLanguageServerReady(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isWindsurfRunning() && isWindsurfLanguageServerReady()) {
      return true;
    }
    await sleep(1500);
  }

  return false;
}

function triggerWindsurfAuthRefresh() {
  const refreshUrl = 'windsurf://codeium.windsurf/refresh-authentication-session';
  log(`triggering Windsurf auth refresh: ${refreshUrl}`);

  try {
    execSync(`powershell -NoProfile -Command "Start-Process '${refreshUrl}'"`, {
      stdio: 'ignore',
      timeout: 10000,
    });
    return true;
  } catch (e) {
    log(`failed to trigger auth refresh: ${e.message}`);
    return false;
  }
}

async function waitForLoggedInState(expectedToken, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await directSwitch.readLiveAuthStateFromFile();
    const hasExpectedToken =
      state.token === expectedToken || state.secretSessionToken === expectedToken;
    const hasAuthStatus = typeof state.authStatus === 'string' && state.authStatus !== 'null';

    log(
      `login-state check: hasExpectedToken=${hasExpectedToken}, hasAuthStatus=${hasAuthStatus}, authStatus=${state.authStatus}`
    );

    if (hasExpectedToken && hasAuthStatus) {
      return true;
    }

    await sleep(1500);
  }

  return false;
}

async function protocolSwitchActuallyApplied(expectedToken) {
  const state = await directSwitch.readLiveAuthStateFromFile();
  const applied =
    (state.token === expectedToken || state.secretSessionToken === expectedToken) &&
    typeof state.authStatus === 'string' &&
    state.authStatus !== 'null';
  log(
    `protocol verification: applied=${applied}, liveToken=${state.token ? state.token.slice(0, 24) : 'null'}, secretToken=${state.secretSessionToken ? state.secretSessionToken.slice(0, 24) : 'null'}, authStatus=${state.authStatus}`
  );
  return applied;
}

async function fallbackToDirectSwitch(account, email, reason) {
  log(`falling back to direct switch: ${reason}`);

  const isRunning = await isWindsurfRunning();
  if (isRunning) {
    await killWindsurf();
    await sleep(3000);

    let stillRunning = await isWindsurfRunning();
    if (stillRunning) {
      await killWindsurf();
      await sleep(3000);
      stillRunning = await isWindsurfRunning();
      if (stillRunning) {
        throw new Error('Unable to close Windsurf. Please close it manually and try again.');
      }
    }
  }

  await directSwitch.switchAccountToDB(account);
  const windsurfPath = findWindsurfPath();
  startWindsurf(windsurfPath);

  const ready = await waitForWindsurfLanguageServerReady();
  log(`language server ready after launch: ${ready}`);

  const refreshTriggered = triggerWindsurfAuthRefresh();
  if (refreshTriggered) {
    const refreshed = await waitForLoggedInState(account.api_key, 30000);
    log(`auth refresh produced logged-in state: ${refreshed}`);

    if (!refreshed) {
      let authToken = null;
      try {
        authToken = await windsurfAuth.getOneTimeAuthToken(account.api_key);
      } catch (e) {
        log(`failed to get one-time auth token during post-launch retry: ${e.message}`);
      }

      if (authToken) {
        windsurfAuth.triggerWindsurfLogin(authToken);
        const protocolApplied = await waitForLoggedInState(account.api_key, 30000);
        log(`post-launch protocol retry produced logged-in state: ${protocolApplied}`);
      }
    }
  }

  log('========================================');
  log(`switch complete: ${email} (method: direct)`);
  log('========================================');
  return { success: true, email, windsurfPath: windsurfPath || 'unknown', method: 'direct' };
}

async function switchToAccount(account) {
  const email = account.email;
  log('========================================');
  log(`switching account: ${email}`);
  log('========================================');

  if (!account.api_key) {
    throw new Error(`Account ${email} has no valid session token`);
  }

  try {
    log('--- method 1: windsurf:// callback ---');

    let authToken = null;
    try {
      authToken = await windsurfAuth.getOneTimeAuthToken(account.api_key);
    } catch (e) {
      log(`failed to get one-time auth token: ${e.message}`);
    }

    if (authToken) {
      const triggered = windsurfAuth.triggerWindsurfLogin(authToken);
      if (triggered) {
        await sleep(5000);
        if (await protocolSwitchActuallyApplied(account.api_key)) {
          log('========================================');
          log(`switch complete: ${email} (method: windsurf://)`);
          log('========================================');
          return { success: true, email, method: 'windsurf_protocol' };
        }
      }
    }

    return fallbackToDirectSwitch(account, email, 'callback did not update local auth state');
  } catch (e) {
    log(`switch failed: ${e.message}`);
    throw e;
  }
}

module.exports = { switchToAccount, findWindsurfPath, isWindsurfRunning, killWindsurf };
