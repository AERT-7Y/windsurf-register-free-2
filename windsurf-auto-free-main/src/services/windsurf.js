﻿const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { net } = require('electron');
const { getOneTimeAuthToken } = require('./windsurf-auth');

const FIREBASE_API_KEY = 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY';
const WINDSURF_ORIGIN = 'https://windsurf.com';
const WINDSURF_REFERER = 'https://windsurf.com/account/login';
const DEVIN_APP_ORIGIN = 'https://app.devin.ai';
const DEVIN_APP_AUTH_BASE = 'https://app.devin.ai/api/auth1';
const FETCH_TIMEOUT_MS = 45000;

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

function isDevinSessionToken(token) {
  return Boolean(token && String(token).startsWith('devin-session-token$'));
}

function log(msg) {
  console.log('[Windsurf]', msg);
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return String(url).slice(0, 120);
  }
}

function parseHttpErrorBody(status, text) {
  if (!text) return `HTTP ${status}`;
  try {
    const j = JSON.parse(text);
    const msg = j.error?.message || j.error?.errors?.[0]?.message || j.message || j.error_description || text;
    return `HTTP ${status}: ${msg}`;
  } catch {
    return `HTTP ${status}: ${text.slice(0, 500)}`;
  }
}

function shouldFallbackToHttps(error) {
  const msg = String(error && error.message ? error.message : error).toLowerCase();
  return msg.includes('err_blocked_by_client')
    || msg.includes('invalid referrer')
    || msg.includes('failed to fetch')
    || msg.includes('network error');
}

function buildHeaders(overrides = {}) {
  return { ...COMMON_HEADERS, ...overrides };
}

function nodeRequest(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const method = init.method || 'GET';
  const body = init.body;
  const headers = { ...(init.headers || {}) };

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || undefined,
      path: `${urlObj.pathname}${urlObj.search}`,
      method,
      headers,
      timeout: timeoutMs,
    };

    if (body !== undefined && body !== null && headers['Content-Length'] === undefined && headers['content-length'] === undefined) {
      const length = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
      options.headers['Content-Length'] = String(length);
    }

    log(`=> HTTPS ${method} ${shortUrl(url)}`);
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        log(`<= HTTPS ${res.statusCode || 0} ${shortUrl(url)}`);
        resolve({
          status: res.statusCode || 0,
          ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${Math.round(timeoutMs / 1000)}s`));
    });

    if (body !== undefined && body !== null) {
      req.write(body);
    }
    req.end();
  });
}

async function fetchJson(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const headers = buildHeaders({
    Accept: 'application/json',
    Origin: WINDSURF_ORIGIN,
    Referer: `${WINDSURF_ORIGIN}/`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...(init.headers || {}),
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const method = init.method || 'GET';

  try {
    log(`-> ${method} ${shortUrl(url)}`);
    const res = await net.fetch(url, { ...init, headers, signal: ac.signal });
    log(`<- HTTP ${res.status} ${shortUrl(url)}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(parseHttpErrorBody(res.status, text));
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response (${shortUrl(url)})`);
    }
  } catch (error) {
    if (!ac.signal.aborted && shouldFallbackToHttps(error)) {
      log(`net.fetch blocked, fallback to https: ${shortUrl(url)}`);
      const res = await nodeRequest(url, { ...init, headers }, timeoutMs);
      const text = res.body.toString('utf8');
      if (!res.ok) {
        throw new Error(parseHttpErrorBody(res.status, text));
      }
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response (${shortUrl(url)})`);
      }
    }
    if (error.name === 'AbortError' || ac.signal.aborted) {
      throw new Error(`Request timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const headers = buildHeaders(init.headers || {});
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const method = init.method || 'GET';

  try {
    log(`-> ${method} ${shortUrl(url)}`);
    const res = await net.fetch(url, { ...init, headers, signal: ac.signal });
    log(`<- HTTP ${res.status} ${shortUrl(url)}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${bytes.toString('utf8').slice(0, 500)}`);
    }
    return bytes;
  } catch (error) {
    if (!ac.signal.aborted && shouldFallbackToHttps(error)) {
      log(`net.fetch blocked, fallback to https: ${shortUrl(url)}`);
      const res = await nodeRequest(url, { ...init, headers }, timeoutMs);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.body.toString('utf8').slice(0, 500)}`);
      }
      return res.body;
    }
    if (error.name === 'AbortError' || ac.signal.aborted) {
      throw new Error(`Request timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytesViaHttps(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const method = init.method || 'GET';
  log(`-> ${method} ${shortUrl(url)} [https-only]`);
  const res = await nodeRequest(url, init, timeoutMs);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.body.toString('utf8').slice(0, 500)}`);
  }
  return res.body;
}

async function postJson(url, body, extraHeaders = {}) {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function encodeVarint(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 127) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function encodeProtoStringField(fieldNo, value) {
  const payload = Buffer.from(String(value || ''), 'utf8');
  const tag = encodeVarint((fieldNo << 3) | 2);
  const len = encodeVarint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

function decodeVarint(buf, start) {
  let result = 0;
  let shift = 0;
  let pos = start;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, consumed: pos - start };
    }
    shift += 7;
  }
  return null;
}

function parseCheckUserLoginMethodResponse(buf) {
  const result = {
    redirect_url: '',
    disallow_enterprise_user_login: false,
    user_exists: false,
    is_migrated: false,
    has_password: false,
  };

  let i = 0;
  while (i < buf.length) {
    const tagInfo = decodeVarint(buf, i);
    if (!tagInfo) break;
    i += tagInfo.consumed;
    const fieldNo = tagInfo.value >> 3;
    const wireType = tagInfo.value & 0x7;

    if (fieldNo === 1 && wireType === 2) {
      const lenInfo = decodeVarint(buf, i);
      if (!lenInfo) break;
      i += lenInfo.consumed;
      const end = i + lenInfo.value;
      result.redirect_url = Buffer.from(buf.slice(i, end)).toString('utf8');
      i = end;
      continue;
    }

    if ([2, 3, 4, 5].includes(fieldNo) && wireType === 0) {
      const valInfo = decodeVarint(buf, i);
      if (!valInfo) break;
      i += valInfo.consumed;
      const boolVal = valInfo.value !== 0;
      if (fieldNo === 2) result.disallow_enterprise_user_login = boolVal;
      if (fieldNo === 3) result.user_exists = boolVal;
      if (fieldNo === 4) result.is_migrated = boolVal;
      if (fieldNo === 5) result.has_password = boolVal;
      continue;
    }

    if (wireType === 0) {
      const skip = decodeVarint(buf, i);
      if (!skip) break;
      i += skip.consumed;
    } else if (wireType === 2) {
      const lenInfo = decodeVarint(buf, i);
      if (!lenInfo) break;
      i += lenInfo.consumed + lenInfo.value;
    } else if (wireType === 1) {
      i += 8;
    } else if (wireType === 5) {
      i += 4;
    } else {
      break;
    }
  }

  return result;
}

function parseWindsurfPostAuthResponse(buf) {
  const result = {
    session_token: '',
    auth1_token: '',
    account_id: '',
    primary_org_id: '',
  };

  let i = 0;
  while (i < buf.length) {
    const tagInfo = decodeVarint(buf, i);
    if (!tagInfo) break;
    i += tagInfo.consumed;
    const fieldNo = tagInfo.value >> 3;
    const wireType = tagInfo.value & 0x7;

    if (wireType === 2) {
      const lenInfo = decodeVarint(buf, i);
      if (!lenInfo) break;
      i += lenInfo.consumed;
      const end = i + lenInfo.value;
      const value = Buffer.from(buf.slice(i, end)).toString('utf8');
      if (fieldNo === 1) result.session_token = value;
      if (fieldNo === 3) result.auth1_token = value;
      if (fieldNo === 4) result.account_id = value;
      if (fieldNo === 5) result.primary_org_id = value;
      i = end;
      continue;
    }

    if (wireType === 0) {
      const skip = decodeVarint(buf, i);
      if (!skip) break;
      i += skip.consumed;
    } else if (wireType === 1) {
      i += 8;
    } else if (wireType === 5) {
      i += 4;
    } else {
      break;
    }
  }

  if (!result.session_token) {
    throw new Error('WindsurfPostAuth response missing session_token');
  }

  return result;
}

async function fetchUserInfoByApiKey(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (isDevinSessionToken(apiKey)) {
    headers['x-devin-session-token'] = apiKey;
  }

  return postJson(
    'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetCurrentUser',
    {},
    headers,
  );
}

async function checkUserLoginMethod(email) {
  const body = encodeProtoStringField(1, email);
  const bytes = await fetchBytesViaHttps(
    'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/CheckUserLoginMethod',
    {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/proto',
        'connect-protocol-version': '1',
      },
      body,
    },
  );
  return parseCheckUserLoginMethodResponse(bytes);
}

async function devinPasswordLogin(email, password) {
  return postJson('https://windsurf.com/_devin-auth/password/login', {
    email,
    password,
  }, {
    Accept: '*/*',
    Origin: WINDSURF_ORIGIN,
    Referer: WINDSURF_REFERER,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  });
}

async function devinAppPasswordLogin(email, password) {
  return postJson(`${DEVIN_APP_AUTH_BASE}/password/login`, {
    email,
    password,
  }, {
    Accept: '*/*',
    Origin: DEVIN_APP_ORIGIN,
    Referer: `${DEVIN_APP_ORIGIN}/`,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  });
}

async function windsurfPostAuth(auth1Token, orgId = '') {
  const fields = [encodeProtoStringField(1, auth1Token)];
  if (orgId) {
    fields.push(encodeProtoStringField(2, orgId));
  }
  const body = Buffer.concat(fields);
  const bytes = await fetchBytesViaHttps(
    'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth',
    {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/proto',
        'connect-protocol-version': '1',
      },
      body,
    },
  );
  return parseWindsurfPostAuthResponse(bytes);
}

async function loginViaAuth1(email, password, reason, variant = 'windsurf-bridge') {
  const label = variant === 'devin-native' ? 'Devin Native/Auth1' : 'Devin/Auth1';
  log(`${reason === 'refresh' ? 'refresh account' : reason === 'import' ? 'import account' : 'add account'} via ${label}: ${email}`);

  const login = variant === 'devin-native'
    ? await devinAppPasswordLogin(email, password)
    : await devinPasswordLogin(email, password);

  const auth1Token = login.auth1_token || login.auth1Token || login.auth_token || login.token;
  if (!auth1Token) {
    throw new Error('Auth1 login succeeded but auth1 token is missing');
  }

  const postAuth = await windsurfPostAuth(auth1Token);
  return {
    api_key: postAuth.session_token,
    id_token: '',
    refresh_token: '',
    expires_at: '',
    name: login.email || email.split('@')[0],
    plan_name: 'free',
    status: 'active',
  };
}

async function login(email, password, meta = {}) {
  const reason = meta.reason || 'add';
  log(`${reason}: ${email}`);

  const url1 = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  let data1;

  try {
    data1 = await postJson(url1, {
      returnSecureToken: true,
      email,
      password,
      clientType: 'CLIENT_TYPE_WEB',
    });
  } catch (error) {
    if (String(error.message || '').includes('HTTP 401')) {
      const method = await checkUserLoginMethod(email).catch(() => null);
      if (method) {
        log(`CheckUserLoginMethod: exists=${method.user_exists}, migrated=${method.is_migrated}, has_password=${method.has_password}, redirect=${method.redirect_url || '-'}`);
      }

      let bridgeError = null;
      try {
        return await loginViaAuth1(email, password, reason, 'windsurf-bridge');
      } catch (err) {
        bridgeError = err;
        log(`Devin/Auth1 fallback failed: ${err.message}`);
      }

      try {
        return await loginViaAuth1(email, password, reason, 'devin-native');
      } catch (nativeErr) {
        log(`Devin Native/Auth1 fallback failed: ${nativeErr.message}`);
        if (method?.disallow_enterprise_user_login) {
          throw new Error('This account requires enterprise/SSO login and cannot use normal password import');
        }
        throw new Error(`Auth1 login failed. bridge=${bridgeError ? bridgeError.message : 'n/a'}; native=${nativeErr.message}`);
      }
    }
    throw error;
  }

  const idToken = data1.idToken;
  const refreshToken = data1.refreshToken;
  const expiresIn = parseInt(data1.expiresIn, 10);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const url2 = 'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser';
  const data2 = await postJson(url2, { firebase_id_token: idToken });
  const apiKey = data2.api_key || data2.apiKey;
  const name = data2.name || data2.username || email.split('@')[0];

  return {
    api_key: apiKey,
    id_token: idToken,
    refresh_token: refreshToken,
    expires_at: expiresAt.toISOString(),
    name,
    plan_name: 'free',
    status: 'active',
  };
}

async function refreshAccount(acc) {
  log(`refresh account: ${acc.email}`);

  if (!acc.refresh_token) {
    throw new Error('No refresh token available');
  }

  const url = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: acc.refresh_token,
  }).toString();

  const data = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const expiresIn = parseInt(data.expires_in, 10);
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return {
    api_key: acc.api_key,
    id_token: data.id_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt.toISOString(),
    name: acc.name,
    plan_name: acc.plan_name || 'free',
    status: 'active',
  };
}

async function checkStatus(acc) {
  log(`check status: ${acc.email}`);

  if (!acc.api_key) {
    return { status: 'no_key', plan_name: '', daily_quota: 0, weekly_quota: 0 };
  }

  try {
    if (isDevinSessionToken(acc.api_key)) {
      await getOneTimeAuthToken(acc.api_key);
      return {
        status: 'active',
        plan_name: acc.plan_name || 'free',
        daily_quota: acc.daily_quota || 0,
        weekly_quota: acc.weekly_quota || 0,
      };
    }

    const data = await fetchUserInfoByApiKey(acc.api_key);
    return {
      status: 'active',
      plan_name: data.plan_name || acc.plan_name || 'free',
      daily_quota: data.daily_quota || 0,
      weekly_quota: data.weekly_quota || 0,
    };
  } catch (error) {
    log(`status check failed: ${error.message}`);
    return { status: 'error', plan_name: acc.plan_name || '', daily_quota: 0, weekly_quota: 0 };
  }
}

function getProxy() {
  try {
    const tempPs1 = path.join(__dirname, 'temp_proxy.ps1');
    const psScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ieProxy = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue).ProxyServer\nif ($ieProxy) { Write-Output $ieProxy; exit }\n$envProxy = $env:HTTPS_PROXY\nif ($envProxy) { Write-Output ('env: ' + $envProxy); exit }\n$envHttp = $env:HTTP_PROXY\nif ($envHttp) { Write-Output ('env: ' + $envHttp); exit }\nWrite-Output ''`;
    fs.writeFileSync(tempPs1, psScript, 'utf8');
    try {
      const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}"`, { encoding: 'utf8' }).trim();
      return result || 'Direct (no proxy)';
    } finally {
      try { fs.unlinkSync(tempPs1); } catch {}
    }
  } catch {
    return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'Direct (no proxy)';
  }
}

module.exports = { login, refreshAccount, checkStatus, getProxy };
