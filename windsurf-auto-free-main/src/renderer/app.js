const $ = (selector) => document.querySelector(selector);

const accountList = $('#accountList');
const accountCount = $('#accountCount');
const addModal = $('#addModal');
const importModal = $('#importModal');
const currentAccountPanel = $('#currentAccountPanel');
const overviewStats = $('#overviewStats');
const searchInput = $('#searchInput');
const statusFilter = $('#statusFilter');
const typeFilter = $('#typeFilter');

let latestOverview = { accounts: [], current: null, liveState: null };
const visibilityState = new Map();

window.api.onLog((msg) => {
  console.log('[服务日志]', msg);
});

async function loadAccounts() {
  latestOverview = await window.api.getAccountsOverview();
  renderDashboard(latestOverview);
}

function renderDashboard(overview) {
  const allAccounts = overview.accounts || [];
  const filteredAccounts = filterAccounts(allAccounts);

  renderStats(allAccounts, overview.current);
  renderCurrentAccount(overview.current, overview.liveState);
  renderAccounts(filteredAccounts, allAccounts.length);
}

function filterAccounts(accounts) {
  const keyword = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  const type = typeFilter.value;

  return accounts.filter((account) => {
    const text = [
      account.email,
      account.name,
      account.plan_name,
      account.status,
      getSessionTypeLabel(account.tokenKind),
    ].join(' ').toLowerCase();

    if (keyword && !text.includes(keyword)) {
      return false;
    }

    if (status !== 'all' && (account.status || 'unknown') !== status) {
      return false;
    }

    if (type !== 'all' && (account.tokenKind || 'missing') !== type) {
      return false;
    }

    return true;
  });
}

function renderStats(accounts, current) {
  const activeCount = accounts.filter((item) => item.status === 'active').length;
  const failedCount = accounts.filter((item) => item.status === 'failed').length;
  const sessionCount = accounts.filter((item) => item.tokenKind === 'devin-session').length;
  const currentEmail = current?.email || '未识别';

  overviewStats.innerHTML = `
    ${createStatCard('账号总数', String(accounts.length), '已录入账号数量')}
    ${createStatCard('可用账号', String(activeCount), '状态为 active')}
    ${createStatCard('Session 会话', String(sessionCount), '使用 session token 的账号')}
    ${createStatCard('异常账号', String(failedCount), '登录或刷新失败')}
    ${createStatCard('当前使用', escapeHtml(currentEmail), current?.loggedIn ? 'Windsurf 已登录' : 'Windsurf 未登录')}
  `;
}

function renderCurrentAccount(current, liveState) {
  if (!current) {
    currentAccountPanel.innerHTML = `
      <div class="section-heading">
        <div>
          <h2>当前账号</h2>
          <p>展示 Windsurf 当前真实加载的账号状态</p>
        </div>
        <span class="state-badge state-offline">未登录</span>
      </div>
      <div class="current-empty">
        <div class="empty-title">尚未识别到登录账号</div>
        <div class="empty-desc">切换任意账号成功后，这里会显示当前邮箱、套餐、额度与会话信息。</div>
      </div>
    `;
    return;
  }

  const sessionType = getSessionTypeLabel(getCurrentTokenKind(current));
  const passwordValue = current.accountId
    ? getPasswordFromOverview(current.accountId)
    : '';
  const passwordMask = maskSecret(passwordValue);
  const tokenMask = maskSecret(current.tokenPreview || '');

  currentAccountPanel.innerHTML = `
    <div class="section-heading">
      <div>
        <h2>当前账号</h2>
        <p>这里的数据来自 Windsurf 当前真实会话，不只是本地账号库</p>
      </div>
      <span class="state-badge ${current.loggedIn ? 'state-online' : 'state-offline'}">
        ${current.loggedIn ? '已登录' : '未登录'}
      </span>
    </div>
    <div class="current-grid">
      <div class="current-main">
        <div class="current-title-row">
          <div>
            <div class="current-name">${escapeHtml(current.name || current.sessionLabel || current.email || '未命名账号')}</div>
            <div class="current-email">${escapeHtml(current.email || liveState?.lastLoginEmail || '未知邮箱')}</div>
          </div>
          <div class="chip-row">
            ${createChip(sessionType, 'primary')}
            ${createChip(current.planName || '未知套餐', 'neutral')}
            ${createChip(current.status || 'unknown', current.status === 'active' ? 'success' : 'warning')}
          </div>
        </div>
        <div class="quota-grid">
          ${createMetricBox('每日额度', String(current.dailyQuota ?? 0))}
          ${createMetricBox('每周额度', String(current.weeklyQuota ?? 0))}
          ${createMetricBox('会话方式', sessionType)}
          ${createMetricBox('最近更新时间', formatDateTime(current.updatedAt))}
        </div>
      </div>
      <div class="detail-panel">
        <div class="detail-panel-title">详细信息</div>
        <div class="detail-table">
          ${createDetailRow('会话名称', current.sessionLabel || '--')}
          ${createDetailRow('API 服务地址', current.apiServerUrl || '--')}
          ${createDetailRow('登录邮箱', current.email || '--')}
          ${createSecretRow('密码', `current-password-${current.accountId || 'live'}`, passwordValue, passwordMask)}
          ${createSecretRow('Token', `current-token-${current.accountId || 'live'}`, current.tokenPreview || '', tokenMask)}
        </div>
      </div>
    </div>
  `;
}

function renderAccounts(accounts, totalCount) {
  if (accounts.length === 0) {
    accountList.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">没有匹配的账号</div>
        <div class="empty-desc">当前筛选条件下没有可显示的账号，调整搜索或筛选即可。</div>
      </div>
    `;
    accountCount.textContent = `${totalCount} 个账号`;
    return;
  }

  accountCount.textContent = `${totalCount} 个账号`;
  accountList.innerHTML = accounts.map((account) => renderAccountRow(account)).join('');
}

function renderAccountRow(account) {
  const sessionType = getSessionTypeLabel(account.tokenKind);
  const passwordValue = account.password || '';
  const tokenValue = account.api_key || '';

  return `
    <section class="account-row ${account.isCurrent ? 'is-current' : ''}">
      <div class="account-row-head">
        <div class="account-primary">
          <div class="account-line">
            <span class="status-dot ${escapeHtml(account.status || 'unknown')}"></span>
            <span class="account-email">${escapeHtml(account.email || '--')}</span>
            ${account.isCurrent ? '<span class="inline-current">当前使用中</span>' : ''}
          </div>
          <div class="account-subline">
            <span>${escapeHtml(account.name || '未命名账号')}</span>
            <span>更新时间：${escapeHtml(formatDateTime(account.updated_at))}</span>
          </div>
        </div>
        <div class="account-head-side">
          <div class="chip-row">
            ${createChip(sessionType, 'primary')}
            ${createChip(account.plan_name || '未知套餐', 'neutral')}
            ${createChip(account.status || 'unknown', account.status === 'active' ? 'success' : 'warning')}
          </div>
          <div class="action-row">
            <button class="btn btn-primary btn-sm" onclick="switchAccount(${account.id})">切换账号</button>
            <button class="btn btn-secondary btn-sm" onclick="refreshAccount(${account.id})">刷新数据</button>
            <button class="btn btn-danger btn-sm" onclick="deleteAccount(${account.id})">删除</button>
          </div>
        </div>
      </div>
      <div class="info-grid">
        ${createInfoBlock('额度', [
          ['每日额度', String(account.daily_quota ?? 0)],
          ['每周额度', String(account.weekly_quota ?? 0)],
          ['使用概览', `日 ${account.daily_quota ?? 0} / 周 ${account.weekly_quota ?? 0}`],
        ])}
        ${createInfoBlock('账号属性', [
          ['会话方式', sessionType],
          ['套餐', account.plan_name || '--'],
          ['状态', account.status || '--'],
        ])}
        ${createInfoBlock('详细信息', [
          ['Refresh Token', account.hasRefreshToken ? '已保存' : '未保存'],
          ['ID Token', account.hasIdToken ? '已保存' : '未保存'],
          ['Token 类型', sessionType],
          ['过期时间', formatDateTime(account.expires_at)],
        ])}
      </div>
      <div class="secret-grid">
        ${createSecretRow('邮箱', `email-${account.id}`, account.email || '', account.email || '--', true)}
        ${createSecretRow('密码', `password-${account.id}`, passwordValue, maskSecret(passwordValue))}
        ${createSecretRow('Token', `token-${account.id}`, tokenValue, maskSecret(tokenValue))}
      </div>
    </section>
  `;
}

function createStatCard(label, value, desc) {
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      <div class="stat-desc">${escapeHtml(desc)}</div>
    </div>
  `;
}

function createMetricBox(label, value) {
  return `
    <div class="metric-box">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value || '--')}</div>
    </div>
  `;
}

function createChip(text, tone) {
  return `<span class="chip chip-${tone}">${escapeHtml(text)}</span>`;
}

function createInfoBlock(title, rows) {
  return `
    <div class="info-block">
      <div class="info-block-title">${escapeHtml(title)}</div>
      <div class="info-block-body">
        ${rows.map(([label, value]) => createCompactRow(label, value)).join('')}
      </div>
    </div>
  `;
}

function createCompactRow(label, value) {
  return `
    <div class="compact-row">
      <span class="compact-label">${escapeHtml(label)}</span>
      <span class="compact-value">${escapeHtml(value || '--')}</span>
    </div>
  `;
}

function createDetailRow(label, value) {
  return `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(value || '--')}</div>
    </div>
  `;
}

function createSecretRow(label, key, rawValue, maskedValue, plainMode = false) {
  const visible = plainMode || isVisible(key);
  const displayValue = plainMode ? (rawValue || '--') : (visible ? (rawValue || '--') : maskedValue);
  const hasValue = Boolean(rawValue);

  return `
    <div class="secret-row">
      <div class="secret-label">${escapeHtml(label)}</div>
      <div class="secret-content">
        <div class="secret-value ${plainMode ? 'is-plain' : ''}" id="secret-value-${escapeHtml(key)}">${escapeHtml(displayValue)}</div>
        <div class="secret-actions">
          ${plainMode ? '' : `<button class="btn btn-ghost btn-xs" onclick="toggleSecret('${escapeJs(key)}')">${visible ? '隐藏' : '查看'}</button>`}
          <button class="btn btn-ghost btn-xs" ${hasValue ? `onclick="copyValue('${escapeJs(rawValue)}', '${escapeJs(label)}')"` : 'disabled'}>复制</button>
        </div>
      </div>
    </div>
  `;
}

function isVisible(key) {
  return visibilityState.get(key) === true;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function maskSecret(value) {
  if (!value) return '--';
  const text = String(value);
  if (text.length <= 10) {
    return '•'.repeat(text.length);
  }
  return `${text.slice(0, 4)}${'•'.repeat(Math.min(12, text.length - 8))}${text.slice(-4)}`;
}

function formatDateTime(dateStr) {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return String(dateStr);
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSessionTypeLabel(tokenKind) {
  if (tokenKind === 'devin-session') return 'Session Token';
  if (tokenKind === 'api-key') return 'API Token';
  if (tokenKind === 'missing') return '缺少 Token';
  return '未知类型';
}

function getCurrentTokenKind(current) {
  if (current.tokenPreview && String(current.tokenPreview).startsWith('devin-session-token$')) {
    return 'devin-session';
  }
  if (current.tokenPreview) {
    return 'api-key';
  }
  return 'missing';
}

function getPasswordFromOverview(accountId) {
  const account = (latestOverview.accounts || []).find((item) => item.id === accountId);
  return account?.password || '';
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement('textarea');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
}

window.copyValue = async function copyValue(value, label) {
  try {
    await copyText(value);
    alert(`${label} 已复制`);
  } catch (error) {
    alert(`复制失败：${error.message}`);
  }
};

window.toggleSecret = function toggleSecret(key) {
  visibilityState.set(key, !isVisible(key));
  renderDashboard(latestOverview);
};

$('#btnAdd').addEventListener('click', () => {
  addModal.style.display = 'flex';
  $('#inputEmail').value = '';
  $('#inputPassword').value = '';
  $('#addStatus').textContent = '';
  $('#inputEmail').focus();
});

$('#closeAddModal').addEventListener('click', () => { addModal.style.display = 'none'; });
$('#cancelAdd').addEventListener('click', () => { addModal.style.display = 'none'; });

$('#confirmAdd').addEventListener('click', async () => {
  const email = $('#inputEmail').value.trim();
  const password = $('#inputPassword').value.trim();

  if (!email || !password) {
    $('#addStatus').className = 'modal-status error';
    $('#addStatus').textContent = '请填写邮箱和密码';
    return;
  }

  $('#addStatus').className = 'modal-status loading';
  $('#addStatus').innerHTML = '<span class="spinner"></span>登录中...';
  $('#confirmAdd').disabled = true;

  try {
    const result = await window.api.addAccount({ email, password });
    if (result.success) {
      $('#addStatus').className = 'modal-status success';
      $('#addStatus').textContent = '添加成功';
      setTimeout(() => {
        addModal.style.display = 'none';
        loadAccounts();
      }, 800);
    } else {
      $('#addStatus').className = 'modal-status error';
      $('#addStatus').textContent = result.error || '添加失败';
    }
  } catch (e) {
    $('#addStatus').className = 'modal-status error';
    $('#addStatus').textContent = e.message || '\u8bf7\u6c42\u5f02\u5e38\uff0c\u8bf7\u67e5\u770b\u4e3b\u8fdb\u7a0b\u63a7\u5236\u53f0\u65e5\u5fd7';
  } finally {
    $('#confirmAdd').disabled = false;
  }
});

$('#btnImport').addEventListener('click', () => {
  importModal.style.display = 'flex';
  $('#importText').value = '';
  $('#importStatus').textContent = '';
});

$('#closeImportModal').addEventListener('click', () => { importModal.style.display = 'none'; });
$('#cancelImport').addEventListener('click', () => { importModal.style.display = 'none'; });

$('#confirmImport').addEventListener('click', async () => {
  const text = $('#importText').value.trim();
  if (!text) {
    $('#importStatus').className = 'modal-status error';
    $('#importStatus').textContent = '\u8bf7\u8f93\u5165\u8d26\u53f7\u6570\u636e';
    return;
  }

  $('#importStatus').className = 'modal-status loading';
  $('#importStatus').innerHTML = '<span class="spinner"></span>\u5bfc\u5165\u4e2d...';
  $('#confirmImport').disabled = true;

  try {
    const result = await window.api.importAccounts(text);
    const failedCount = Array.isArray(result.failed) ? result.failed.length : 0;
    $('#importStatus').className = failedCount > 0 ? 'modal-status error' : 'modal-status success';
    $('#importStatus').textContent = failedCount > 0
      ? `\u5bfc\u5165\u5b8c\u6210\uff0c\u6210\u529f ${result.success || 0} \u4e2a\uff0c\u5931\u8d25 ${failedCount} \u4e2a`
      : `\u5bfc\u5165\u5b8c\u6210\uff0c\u5171 ${result.imported} \u4e2a\u8d26\u53f7`;
    setTimeout(() => {
      importModal.style.display = 'none';
      loadAccounts();
    }, 800);
  } catch (e) {
    $('#importStatus').className = 'modal-status error';
    $('#importStatus').textContent = e.message || '\u5bfc\u5165\u5f02\u5e38';
  } finally {
    $('#confirmImport').disabled = false;
  }
});

$('#btnImportFile')?.addEventListener('click', async () => {
  const result = await window.api.importFile();
  if (result.canceled) return;

  if (result.success) {
    alert(`\u5bfc\u5165\u5b8c\u6210\n\u6210\u529f\uff1a${result.successCount || result.imported} \u4e2a\n\u5931\u8d25\uff1a${(result.failed || []).length} \u4e2a\n\u603b\u8ba1\uff1a${result.total} \u4e2a`);
    loadAccounts();
  } else {
    if (result.error) {
      alert(`\u5bfc\u5165\u5931\u8d25\uff1a${result.error}`);
    } else {
      alert(`\u5bfc\u5165\u5b8c\u6210\n\u6210\u529f\uff1a${result.successCount || 0} \u4e2a\n\u5931\u8d25\uff1a${(result.failed || []).length} \u4e2a\n\u603b\u8ba1\uff1a${result.total || 0} \u4e2a`);
      loadAccounts();
    }
  }
});

$('#btnExport').addEventListener('click', async () => {
  const text = await window.api.exportAccounts();
  if (!text) {
    alert('\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u8d26\u53f7');
    return;
  }

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `windsurf账号_${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
});

window.switchAccount = async function switchAccount(id) {
  const btns = document.querySelectorAll(`[onclick="switchAccount(${id})"]`);
  btns.forEach((btn) => {
    btn.textContent = '\u5207\u6362\u4e2d...';
    btn.disabled = true;
  });

  try {
    const result = await window.api.switchAccount(id);
    if (result.success) {
      alert(`\u5df2\u5207\u6362\u5230\uff1a${result.email}\nWindsurf \u4f1a\u81ea\u52a8\u91cd\u542f\u5e76\u5237\u65b0\u767b\u5f55\u6001`);
    } else {
      alert(`\u5207\u6362\u5931\u8d25\uff1a${result.error}`);
    }
  } catch (e) {
    alert(`\u5207\u6362\u5f02\u5e38\uff1a${e.message || e}`);
  } finally {
    loadAccounts();
  }
};

window.refreshAccount = async function refreshAccount(id) {
  const btns = document.querySelectorAll(`[onclick="refreshAccount(${id})"]`);
  btns.forEach((btn) => {
    btn.textContent = '\u5237\u65b0\u4e2d...';
    btn.disabled = true;
  });

  try {
    await window.api.refreshAccount(id);
  } catch (e) {
    alert(`\u5237\u65b0\u5931\u8d25\uff1a${e.message || e}`);
  } finally {
    loadAccounts();
  }
};

window.deleteAccount = async function deleteAccount(id) {
  if (!confirm('\u786e\u5b9a\u5220\u9664\u6b64\u8d26\u53f7\uff1f')) return;
  await window.api.deleteAccount(id);
  loadAccounts();
};

$('#btnRefreshAll').addEventListener('click', async () => {
  const btn = $('#btnRefreshAll');
  btn.textContent = '\u5237\u65b0\u4e2d...';
  btn.disabled = true;

  try {
    const results = await window.api.refreshAllAccounts();
    await loadAccounts();
    const success = results.filter((item) => item.success).length;
    const failed = results.filter((item) => !item.success).length;
    btn.textContent = `\u5b8c\u6210\uff08\u6210\u529f ${success} / \u5931\u8d25 ${failed}\uff09`;
  } catch (e) {
    btn.textContent = '\u5237\u65b0\u5931\u8d25';
    alert(`\u5237\u65b0\u5168\u90e8\u5f02\u5e38\uff1a${e.message || e}`);
    await loadAccounts();
  } finally {
    setTimeout(() => {
      btn.textContent = '\u5237\u65b0\u5168\u90e8';
      btn.disabled = false;
    }, 2000);
  }
});

$('#btnDeleteAll').addEventListener('click', async () => {
  if (!confirm('\u786e\u5b9a\u6e05\u7a7a\u6240\u6709\u8d26\u53f7\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002')) return;
  await window.api.deleteAllAccounts();
  loadAccounts();
});

searchInput.addEventListener('input', () => renderDashboard(latestOverview));
statusFilter.addEventListener('change', () => renderDashboard(latestOverview));
typeFilter.addEventListener('change', () => renderDashboard(latestOverview));

async function init() {
  try {
    const proxyResult = await window.api.getProxyStatus();
    const proxyEl = $('#proxyStatus');
    if (proxyResult.proxy && proxyResult.proxy !== 'Direct (no proxy)') {
      proxyEl.textContent = `\u4ee3\u7406\uff1a${proxyResult.proxy}`;
    } else {
      proxyEl.textContent = '\u7f51\u7edc\uff1a\u76f4\u8fde';
      proxyEl.style.color = 'var(--text-secondary)';
      proxyEl.style.borderColor = 'var(--border)';
      proxyEl.style.background = '#fff';
    }
  } catch (error) {
    $('#proxyStatus').textContent = '\u4ee3\u7406\u68c0\u6d4b\u5931\u8d25';
  }

  try {
    const admin = await window.api.isAdmin();
    const adminEl = document.createElement('span');
    adminEl.className = `proxy-status ${admin ? '' : 'proxy-status-danger'}`;
    adminEl.textContent = admin ? '\u6743\u9650\uff1a\u7ba1\u7406\u5458' : '\u6743\u9650\uff1a\u975e\u7ba1\u7406\u5458';
    adminEl.title = admin ? '\u5df2\u83b7\u53d6\u7ba1\u7406\u5458\u6743\u9650' : '\u672a\u83b7\u53d6\u7ba1\u7406\u5458\u6743\u9650\uff0c\u5207\u6362\u8d26\u53f7\u4f1a\u5931\u8d25';
    document.querySelector('.header-actions').prepend(adminEl);
  } catch {}

  loadAccounts();
}

init();