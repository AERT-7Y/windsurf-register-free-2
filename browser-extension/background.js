const M2U_API = 'https://api.m2u.io/v1';
const REG_URL = 'https://windsurf.com/account/register';
const EXCLUDE_PREFIXES = ['cpu'];

// Anti-detection: domains to clear cookies for
const CLEAR_COOKIE_DOMAINS = [
  'windsurf.com',
  '.windsurf.com',
  'www.windsurf.com',
];
const CLEAR_COOKIE_ORIGINS = [
  'https://windsurf.com',
  'https://www.windsurf.com',
];

let state = {
  running: false,
  count: 0,
  total: 0,
  results: [],
  currentEmail: null,
  currentPassword: null,
  currentMailbox: null,
  currentTabId: null,
  phase: 'idle',
  abortController: null, // For stopping ongoing operations
};

function log(msg, level = 'info') {
  console.log('[WSR]', msg);
  // Broadcast log to sidepanel
  chrome.runtime.sendMessage({ type: 'LOG', data: { message: msg, level } }).catch(() => {});
}

function generatePassword() {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  let pw = '';
  pw += lower[Math.floor(Math.random() * lower.length)];
  pw += upper[Math.floor(Math.random() * upper.length)];
  pw += digits[Math.floor(Math.random() * digits.length)];
  const all = lower + upper + digits;
  for (let i = 3; i < 14; i++) {
    pw += all[Math.floor(Math.random() * all.length)];
  }
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

function generateName() {
  const first = ['James','Robert','John','Michael','David','William','Richard','Joseph','Thomas','Charles','Daniel','Matthew','Anthony','Mark','Steven','Andrew','Kevin','Brian','George','Timothy','Ronald','Edward','Jason','Jeffrey','Ryan','Jacob','Gary','Nicholas','Eric','Jonathan','Stephen','Larry','Justin','Scott','Brandon','Benjamin','Samuel','Raymond','Gregory','Frank'];
  const last = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Anderson','Taylor','Thomas','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'];
  return {
    first: first[Math.floor(Math.random() * first.length)],
    last: last[Math.floor(Math.random() * last.length)],
  };
}

function shouldExcludeDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return EXCLUDE_PREFIXES.some(p => domain.startsWith(p));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      throw new Error('标签页已关闭');
    }

    if (tab.status === 'complete') {
      return tab;
    }

    await sleep(300);
  }

  throw new Error('页面加载超时');
}

async function waitForContentScriptReady(tabId, timeoutMs = 15000) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (response?.ok) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw lastError || new Error('内容脚本未就绪');
}

async function broadcast(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch (e) {}
  
  try {
    const tabs = await chrome.tabs.query({ url: 'https://windsurf.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  } catch (e) {}
}

async function createMailbox() {
  const resp = await fetch(`${M2U_API}/mailboxes/auto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!resp.ok) throw new Error(`Create mailbox failed: ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(`API error: ${data.error}`);
  return {
    email: `${data.mailbox.local_part}@${data.mailbox.domain}`,
    token: data.mailbox.token,
    viewToken: data.mailbox.view_token,
  };
}

async function waitForOtp(token, viewToken, maxWaitSec = 180) {
  const start = Date.now();
  let lastMessageCount = 0;
  log('等待验证码...');
  
  while (Date.now() - start < maxWaitSec * 1000) {
    // Check if stopped
    if (!state.running || state.abortController?.signal?.aborted) {
      throw new Error('操作已中止');
    }
    
    try {
      const resp = await fetch(`${M2U_API}/mailboxes/${token}/messages?view=${viewToken}`);
      if (!resp.ok) { await sleep(3000); continue; }
      const data = await resp.json();
      if (data.error) {
        log(`轮询错误: ${data.error}`, 'warn');
        await sleep(3000);
        continue;
      }
      if (data.messages && data.messages.length > lastMessageCount) {
        lastMessageCount = data.messages.length;
        log(`收到新邮件，正在提取验证码...`);
        const msgId = data.messages[0].id;
        const msgResp = await fetch(`${M2U_API}/mailboxes/${token}/messages/${msgId}?view=${viewToken}`);
        if (!msgResp.ok) { await sleep(3000); continue; }
        const msgData = await msgResp.json();
        if (msgData.error) {
          log(`读取邮件错误: ${msgData.error}`, 'warn');
          await sleep(3000);
          continue;
        }
        const body = msgData.message?.text_body || '';
        const html = msgData.message?.html_body || '';
        const subject = msgData.message?.subject || '';
        const match = subject.match(/(\d{6})/) || body.match(/(\d{6})/) || html.match(/(\d{6})/);
        if (match) {
          log(`验证码已获取: ${match[1]}`, 'success');
          return match[1];
        }
      }
    } catch (e) {
      // If aborted, rethrow
      if (e.message.includes('已中止')) throw e;
      log(`轮询异常: ${e.message}`, 'error');
    }
    await sleep(3000);
  }
  throw new Error('验证码等待超时');
}

async function closeTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
    log(`已关闭标签页 ${tabId}`);
  } catch (e) {
    // Tab already closed
  }
}

// Anti-detection: Clear ALL cookies for windsurf.com
async function clearWindsurfCookies() {
  if (!chrome.cookies?.getAll || !chrome.cookies?.remove) {
    log('浏览器不支持 cookies API', 'warn');
    return;
  }

  let removedCount = 0;
  
  try {
    // Get all cookie stores
    const stores = chrome.cookies.getAllCookieStores
      ? await chrome.cookies.getAllCookieStores()
      : [{ id: undefined }];

    for (const store of stores) {
      const storeId = store?.id;
      // Get ALL cookies (not filtered by domain)
      const cookies = await chrome.cookies.getAll(storeId ? { storeId } : {});
      
      for (const cookie of cookies || []) {
        const domain = (cookie.domain || '').replace(/^\.+/, '').toLowerCase();
        // Match windsurf.com and all subdomains
        if (domain === 'windsurf.com' || domain.endsWith('.windsurf.com')) {
          const host = cookie.domain || '';
          const path = cookie.path || '/';
          const url = `https://${host.startsWith('.') ? host.slice(1) : host}${path}`;
          
          try {
            await chrome.cookies.remove({
              url: url,
              name: cookie.name,
              ...(storeId ? { storeId } : {}),
            });
            removedCount++;
          } catch (e) {
            // Ignore removal errors
          }
        }
      }
    }
  } catch (e) {
    log(`清除 cookies 异常: ${e.message}`, 'warn');
  }

  log(`已清除 ${removedCount} 个 windsurf.com cookies`);
}

// Anti-detection: Clear ALL browsing data for windsurf.com
async function clearWindsurfBrowsingData() {
  if (!chrome.browsingData?.remove) {
    log('浏览器不支持 browsingData API', 'warn');
    return;
  }

  try {
    // Clear by origins
    await chrome.browsingData.remove({
      origins: CLEAR_COOKIE_ORIGINS,
    }, {
      cookies: true,
      localStorage: true,
      indexedDB: true,
      cache: true,
    });
    
    // Also clear by hostnames for more thorough cleanup
    await chrome.browsingData.remove({
      hostnames: ['windsurf.com', 'www.windsurf.com'],
    }, {
      cookies: true,
      localStorage: true,
      indexedDB: true,
      cache: true,
    });
    
    log('已清除 windsurf.com 浏览数据');
  } catch (e) {
    log(`清除浏览数据异常: ${e.message}`, 'warn');
  }
}

// Combined anti-detection cleanup
async function antiDetectionCleanup() {
  log('执行防风控清理...');
  await clearWindsurfCookies();
  await clearWindsurfBrowsingData();
  await sleep(1000); // Wait for cleanup to complete
  log('防风控清理完成');
}

async function startBatch(count) {
  if (state.running) return;
  
  // Create new abort controller for this batch
  state.abortController = new AbortController();
  state.running = true;
  state.total = count;
  state.count = 0;
  state.results = [];
  state.phase = 'idle';
  await saveState();
  
  log(`批量注册启动: ${count} 个账号`, 'info');
  broadcast({ type: 'START' }); // Reset content scripts
  broadcast({ type: 'STATUS', data: getStateForUI() });
  
  registerNext();
}

async function stopBatch() {
  log('正在停止...', 'warn');
  
  // Signal abort to all ongoing operations
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  
  state.running = false;
  state.phase = 'idle';
  
  // Close tab immediately
  await closeTab(state.currentTabId);
  state.currentTabId = null;
  
  // Broadcast stop signal to all content scripts
  broadcast({ type: 'STOP' });
  
  await saveState();
  broadcast({ type: 'STATUS', data: getStateForUI() });
  
  log('批量注册已停止', 'warn');
}

function getStateForUI() {
  return {
    running: state.running,
    count: state.count,
    total: state.total,
    results: state.results,
    email: state.currentEmail,
    phase: state.phase,
  };
}

async function registerNext() {
  if (!state.running || state.count >= state.total) {
    state.running = false;
    state.phase = 'idle';
    state.abortController = null;
    await saveState();
    
    log(`批量注册完成，共 ${state.results.length} 个账号`, 'success');
    broadcast({ type: 'STATUS', data: getStateForUI() });
    broadcast({ type: 'DONE', data: { results: state.results } });
    return;
  }

  // Check if aborted
  if (state.abortController?.signal?.aborted) {
    log('操作已中止', 'warn');
    return;
  }

  const index = state.count + 1;
  log(`\n===== 注册 ${index}/${state.total} =====`);

  try {
    // Anti-detection: Clear cookies and browsing data before each registration
    await antiDetectionCleanup();
    
    // Check again after cleanup
    if (!state.running || state.abortController?.signal?.aborted) {
      log('操作已中止', 'warn');
      return;
    }

    // Step 1: Generate credentials
    const password = generatePassword();
    const name = generateName();
    log(`生成账号: ${name.first} ${name.last}`);

    // Step 2: Create mailbox
    state.phase = 'creating_mailbox';
    broadcast({ type: 'STATUS', data: getStateForUI() });
    
    let mailbox;
    let attempts = 0;
    do {
      mailbox = await createMailbox();
      attempts++;
      if (shouldExcludeDomain(mailbox.email)) {
        log(`排除域名: ${mailbox.email}，重试...`, 'warn');
        mailbox = null;
      }
    } while (!mailbox && attempts < 10);

    if (!mailbox) {
      throw new Error('创建邮箱失败，已重试10次');
    }

    state.currentEmail = mailbox.email;
    state.currentPassword = password;
    state.currentMailbox = mailbox;
    await saveState();
    
    log(`邮箱已创建: ${mailbox.email}`, 'success');
    broadcast({ type: 'STATUS', data: getStateForUI() });

    // Step 3: Close previous tab if exists
    await closeTab(state.currentTabId);
    state.currentTabId = null;
    await sleep(500);

    // Step 4: Open registration page
    log('打开注册页面...');
    state.phase = 'filling_form';
    broadcast({ type: 'STATUS', data: getStateForUI() });
    
    const tab = await chrome.tabs.create({ url: REG_URL, active: true });
    state.currentTabId = tab.id;
    await saveState();

    // Step 5: Wait for the page and content script to be ready
    await waitForTabComplete(tab.id);
    await waitForContentScriptReady(tab.id);

    // Check if stopped during wait
    if (!state.running || state.abortController?.signal?.aborted) {
      log('操作已中止', 'warn');
      return;
    }

    // Step 6: Check tab still exists
    try {
      await chrome.tabs.get(tab.id);
    } catch (e) {
      throw new Error('标签页已关闭');
    }

    log('发送表单填写命令...');
    await chrome.tabs.sendMessage(tab.id, {
      type: 'FILL_REGISTRATION',
      data: {
        firstName: name.first,
        lastName: name.last,
        email: mailbox.email,
        password: password,
      }
    });
    log('表单填写命令已发送');
    return;

    // Step 7: Send fill command to content script
    log('发送表单填写命令...');
    chrome.tabs.sendMessage(tab.id, {
      type: 'FILL_REGISTRATION',
      data: {
        firstName: name.first,
        lastName: name.last,
        email: mailbox.email,
        password: password,
      }
    }).catch(e => {
      log(`发送消息失败: ${e.message}`, 'error');
    });

  } catch (e) {
    // If aborted, don't retry
    if (!state.running || state.abortController?.signal?.aborted) {
      log('操作已中止', 'warn');
      return;
    }
    
    log(`注册失败: ${e.message}`, 'error');
    state.count++;
    state.currentEmail = null;
    state.currentPassword = null;
    state.currentMailbox = null;
    await closeTab(state.currentTabId);
    state.currentTabId = null;
    await saveState();
    broadcast({ type: 'STATUS', data: getStateForUI() });
    setTimeout(() => registerNext(), 2000);
  }
}

async function handleOtpRequest() {
  if (!state.currentMailbox) throw new Error('没有当前邮箱');
  state.phase = 'waiting_otp';
  broadcast({ type: 'STATUS', data: getStateForUI() });
  const code = await waitForOtp(state.currentMailbox.token, state.currentMailbox.viewToken);
  return code;
}

async function handleRegistrationComplete() {
  log(`注册成功: ${state.currentEmail}`, 'success');
  
  if (state.currentEmail && state.currentPassword) {
    state.results.push({
      email: state.currentEmail,
      password: state.currentPassword,
    });
  }
  
  state.count++;
  state.currentEmail = null;
  state.currentPassword = null;
  state.currentMailbox = null;
  
  // Close the registration tab
  await closeTab(state.currentTabId);
  state.currentTabId = null;
  
  state.phase = 'completed';
  await saveState();

  broadcast({ type: 'STATUS', data: getStateForUI() });

  // Continue to next after delay (anti-detection: wait between registrations)
  setTimeout(() => registerNext(), 3000);
}

async function handleRegistrationFailed(reason) {
  log(`注册失败: ${reason}`, 'error');
  
  // Close the registration tab
  await closeTab(state.currentTabId);
  state.currentTabId = null;
  
  // If failure is due to being already logged in, retry without incrementing count
  if (reason.includes('已登录') || reason.includes('个人主页')) {
    log('检测到已登录状态，清除cookies后重试...');
    await antiDetectionCleanup();
    // Retry the same account
    setTimeout(() => registerNext(), 2000);
    return;
  }
  
  // For other failures, increment count and move to next
  state.count++;
  state.currentEmail = null;
  state.currentPassword = null;
  state.currentMailbox = null;
  
  await saveState();
  broadcast({ type: 'STATUS', data: getStateForUI() });

  // Continue to next after delay
  setTimeout(() => registerNext(), 3000);
}

async function saveState() {
  const toSave = {
    running: state.running,
    count: state.count,
    total: state.total,
    results: state.results,
  };
  await chrome.storage.local.set({ wsr_state: toSave });
}

async function loadState() {
  const data = await chrome.storage.local.get('wsr_state');
  if (data.wsr_state) {
    state.running = data.wsr_state.running || false;
    state.count = data.wsr_state.count || 0;
    state.total = data.wsr_state.total || 0;
    state.results = data.wsr_state.results || [];
  }
}

async function clearRecords() {
  state.results = [];
  await saveState();
  broadcast({ type: 'STATUS', data: getStateForUI() });
}

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_BATCH') {
    startBatch(msg.data.count);
    sendResponse({ ok: true });
  } else if (msg.type === 'STOP_BATCH') {
    stopBatch();
    sendResponse({ ok: true });
  } else if (msg.type === 'GET_STATE') {
    sendResponse({ state: getStateForUI() });
  } else if (msg.type === 'NEED_OTP') {
    handleOtpRequest().then(code => {
      sendResponse({ code });
      broadcast({ type: 'OTP_RECEIVED', data: { code } });
    }).catch(e => {
      log(`验证码获取失败: ${e.message}`, 'error');
      sendResponse({ error: e.message });
    });
    return true;
  } else if (msg.type === 'REG_COMPLETE') {
    handleRegistrationComplete();
    sendResponse({ ok: true });
  } else if (msg.type === 'REG_FAILED') {
    handleRegistrationFailed(msg.data?.reason);
    sendResponse({ ok: true });
  } else if (msg.type === 'CLEAR_RECORDS') {
    clearRecords();
    sendResponse({ ok: true });
  }
  return false;
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Keep side panel open across all tabs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Init
chrome.runtime.onInstalled.addListener(() => loadState());
loadState();
