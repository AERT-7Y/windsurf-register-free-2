const { execSync } = require('child_process');
const crypto = require('crypto');

const WINDSURF_BACKEND = 'https://web-backend.windsurf.com';

function log(msg) { console.log('[WindsurfAuth]', msg); }

function encodeVarint(n) {
  const bytes = [];
  let val = n;
  while (val > 127) {
    bytes.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  bytes.push(val);
  return Buffer.from(bytes);
}

function encodeProtobufString(value) {
  const strBuf = Buffer.from(value, 'utf8');
  const tag = Buffer.from([0x0a]);
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

function decodeProtobufString(data) {
  if (!data || data.length < 2) return null;
  let pos = 0;
  while (pos < data.length) {
    const tag = data[pos++];
    const wireType = tag & 0x07;
    const fieldNum = tag >> 3;
    if (wireType === 2) {
      let length = 0;
      let shift = 0;
      while (pos < data.length) {
        const b = data[pos++];
        length |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      if (pos + length <= data.length) {
        const val = data.slice(pos, pos + length).toString('utf8');
        if (fieldNum === 1 && val) return val;
        pos += length;
      }
    } else if (wireType === 0) {
      while (pos < data.length && (data[pos++] & 0x80) !== 0) {}
    } else {
      break;
    }
  }
  return null;
}

/**
 * 获取一次性 auth_token
 * @param {string} token - session_token (Devin) 或 Firebase idToken
 * @returns {Promise<string>}
 */
async function getOneTimeAuthToken(token) {
  log('获取一次性 auth_token...');
  const url = `${WINDSURF_BACKEND}/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken`;
  const body = encodeProtobufString(token);

  const isDevin = token && token.startsWith('devin-session-token$');
  log(`token 类型: ${isDevin ? 'Devin' : 'Firebase'}`);

  return new Promise((resolve, reject) => {
    const https = require('https');
    const urlObj = new URL(url);
    const headers = {
      'Content-Type': 'application/proto',
      'Accept': '*/*',
      'connect-protocol-version': '1',
      'Content-Length': body.length,
      'x-auth-token': token,
      'Referer': 'https://windsurf.com/',
    };

    if (isDevin) {
      headers['x-devin-session-token'] = token;
      log('已附加 x-auth-token 和 x-devin-session-token');
    } else {
      log('已附加 x-auth-token');
    }

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers,
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        log(`GetOneTimeAuthToken 响应: ${res.statusCode}, ${data.length} 字节`);
        if (res.statusCode !== 200) {
          reject(new Error(`GetOneTimeAuthToken 失败: HTTP ${res.statusCode} ${data.toString('utf8')}`));
          return;
        }
        const authToken = decodeProtobufString(data);
        if (!authToken) {
          reject(new Error('解析 auth_token 失败：响应中未找到 field 1 字符串'));
          return;
        }
        log(`auth_token 获取成功 (${authToken.length} 字符)`);
        resolve(authToken);
      });
    });

    req.on('error', (e) => reject(new Error(`GetOneTimeAuthToken 网络错误: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('GetOneTimeAuthToken 请求超时')); });
    req.write(body);
    req.end();
  });
}

function triggerWindsurfLogin(authToken) {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    access_token: authToken,
    state: state,
    token_type: 'Bearer',
  });
  const callbackUrl = `windsurf://codeium.windsurf#${params.toString()}`;
  log(`触发 Windsurf 登录: ${callbackUrl.substring(0, 80)}...`);

  try {
    execSync(`powershell -NoProfile -Command "Start-Process '${callbackUrl}'"`, {
      stdio: 'ignore',
      timeout: 10000,
    });
    log('Windsurf 登录已触发');
    return true;
  } catch (e) {
    log(`触发失败: ${e.message}`);
    return false;
  }
}

module.exports = { getOneTimeAuthToken, triggerWindsurfLogin, WINDSURF_BACKEND };
