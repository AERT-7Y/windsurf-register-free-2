const $ = (selector) => document.querySelector(selector);

const inputCount = $('#inputCount');
const btnStart = $('#btnStart');
const btnStop = $('#btnStop');
const btnTheme = $('#btnTheme');
const btnExport = $('#btnExport');
const btnClearLog = $('#btnClearLog');
const btnClearRecords = $('#btnClearRecords');
const logArea = $('#logArea');
const recordsList = $('#recordsList');
const recordCount = $('#recordCount');
const statDone = $('#statDone');
const statTotal = $('#statTotal');
const statCurrent = $('#statCurrent');
const progressFill = $('#progressFill');

let theme = localStorage.getItem('wsr-theme') || 'light';
document.documentElement.setAttribute('data-theme', theme);

btnTheme.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('wsr-theme', theme);
});

function addLog(msg, type = 'info') {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour12: false });
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg log-${type}">${escapeHtml(msg)}</span>`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;

  while (logArea.children.length > 200) {
    logArea.removeChild(logArea.firstChild);
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || '插件后台未响应',
        });
        return;
      }

      resolve(response || { ok: false, error: '未收到后台响应' });
    });
  });
}

btnClearLog.addEventListener('click', () => {
  logArea.innerHTML = '';
  addLog('日志已清空');
});

btnStart.addEventListener('click', () => {
  const count = parseInt(inputCount.value, 10) || 1;
  if (count < 1) return;

  btnStart.style.display = 'none';
  btnStop.style.display = 'inline-flex';
  inputCount.disabled = true;

  addLog(`开始批量注册，共 ${count} 个账号`);
  chrome.runtime.sendMessage({ type: 'START_BATCH', data: { count } });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_BATCH' });
  addLog('已停止批量注册', 'warn');
  btnStart.style.display = 'inline-flex';
  btnStop.style.display = 'none';
  inputCount.disabled = false;
});

btnExport.addEventListener('click', async () => {
  const resp = await sendRuntimeMessage({ type: 'GET_STATE' });
  const results = resp?.state?.results || [];

  if (results.length === 0) {
    addLog('没有可导出的记录', 'warn');
    return;
  }

  const json = JSON.stringify(results, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `windsurf_accounts_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  addLog(`已导出 ${results.length} 个账号为 JSON`, 'success');
});

btnClearRecords.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_RECORDS' });
  addLog('已清空所有注册记录');
});

function bindCopyButtons() {
  recordsList.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await copyText(btn.dataset.copy || '');
      btn.classList.add('copied');
      const original = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = original;
      }, 1200);
    });
  });
}

function renderRecords(results) {
  if (!results || results.length === 0) {
    recordsList.innerHTML = '<div class="records-empty">暂无注册记录</div>';
    recordCount.textContent = '0';
    return;
  }

  recordCount.textContent = String(results.length);
  recordsList.innerHTML = results.map((record) => `
    <article class="record-item">
      <div class="record-top">
        <div class="record-email">${escapeHtml(record.email || '--')}</div>
      </div>
      <div class="record-field">
        <span class="record-label">密码</span>
        <span class="record-value">${escapeHtml(record.password || '--')}</span>
      </div>
      <div class="record-actions">
        <button class="btn-copy" data-copy="${escapeHtml(record.email || '')}" title="复制邮箱">复制邮箱</button>
        <button class="btn-copy" data-copy="${escapeHtml(record.password || '')}" title="复制密码">复制密码</button>
      </div>
    </article>
  `).join('');

  bindCopyButtons();
}

function updateUI(state) {
  if (!state) return;

  statDone.textContent = String(state.count || 0);
  statTotal.textContent = String(state.total || 0);
  statCurrent.textContent = state.email || '-';

  const percent = state.total > 0 ? (state.count / state.total) * 100 : 0;
  progressFill.style.width = `${percent}%`;

  if (state.running) {
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
    inputCount.disabled = true;
  } else {
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
    inputCount.disabled = false;
  }

  renderRecords(state.results || []);
}

async function pollState() {
  const resp = await sendRuntimeMessage({ type: 'GET_STATE' });
  updateUI(resp?.state);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS') {
    updateUI(msg.data);
  }

  if (msg.type === 'DONE') {
    updateUI({
      running: false,
      count: msg.data.results.length,
      total: msg.data.results.length,
      results: msg.data.results,
    });
    addLog(`批量注册完成，共 ${msg.data.results.length} 个账号`, 'success');
  }

  if (msg.type === 'LOG') {
    addLog(msg.data.message, msg.data.level || 'info');
  }
});

pollState();
setInterval(pollState, 1000);
addLog('插件已就绪');
