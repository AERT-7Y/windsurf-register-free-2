const $ = s => document.querySelector(s);

const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const countInput = $('#count');
const statusText = $('#statusText');
const progressText = $('#progressText');
const currentText = $('#currentText');
const progressBar = $('#progressBar');
const resultsSection = $('#resultsSection');
const resultsList = $('#resultsList');
const emptyMsg = $('#emptyMsg');
const exportBtn = $('#exportBtn');

startBtn.addEventListener('click', async () => {
  const count = parseInt(countInput.value) || 1;
  startBtn.disabled = true;
  startBtn.textContent = 'Running...';
  stopBtn.style.display = 'inline-block';
  chrome.runtime.sendMessage({ type: 'START_BATCH', data: { count } });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_BATCH' });
  startBtn.disabled = false;
  startBtn.textContent = 'Start';
  stopBtn.style.display = 'none';
});

exportBtn.addEventListener('click', async () => {
  const resp = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve)
  );
  const results = resp?.state?.results || [];
  if (results.length === 0) return;

  const text = results.map(r => `${r.email} | ${r.password}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `windsurf_accounts_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

function renderResults(results) {
  if (!results || results.length === 0) {
    resultsSection.style.display = 'none';
    emptyMsg.style.display = 'block';
    return;
  }
  resultsSection.style.display = 'block';
  emptyMsg.style.display = 'none';
  resultsList.innerHTML = '';
  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.innerHTML = `
      <span class="email">${r.email}</span>
      <button class="copy-btn" data-copy="${r.email} | ${r.password}">Copy</button>
      <br><span class="password">PW: ${r.password}</span>
    `;
    resultsList.appendChild(div);
  }
  resultsList.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  });
}

function updateUI(st) {
  if (!st) return;
  if (st.running) {
    startBtn.disabled = true;
    startBtn.textContent = 'Running...';
    stopBtn.style.display = 'inline-block';
    statusText.textContent = st.phase === 'creating_mailbox' ? 'Creating mailbox...' :
                             st.phase === 'otp' ? 'Waiting for OTP...' :
                             st.phase === 'completed' ? 'Completed' : 'Processing...';
    progressText.textContent = `${st.count} / ${st.total}`;
    currentText.textContent = st.email || '-';
    progressBar.style.width = `${(st.count / Math.max(st.total, 1)) * 100}%`;
    if (st.error) {
      statusText.textContent = 'Error: ' + st.error;
    }
  } else {
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
    stopBtn.style.display = 'none';
    statusText.textContent = st.count > 0 ? `Done (${st.count} registered)` : 'Idle';
    progressText.textContent = `${st.count || 0} / ${st.total || 0}`;
    currentText.textContent = '-';
    progressBar.style.width = '0%';
  }
  if (st.results) renderResults(st.results);
}

async function pollState() {
  const resp = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve)
  );
  updateUI(resp?.state);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS') updateUI(msg.data);
  if (msg.type === 'DONE') {
    updateUI({ running: false, count: msg.data.results.length, total: msg.data.results.length, results: msg.data.results });
  }
});

pollState();
setInterval(pollState, 2000);
