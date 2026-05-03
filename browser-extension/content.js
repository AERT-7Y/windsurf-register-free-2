(() => {
  if (window.__wsr_injected) return;
  window.__wsr_injected = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    console.log('[WSR:content]', msg);
    chrome.runtime.sendMessage({ type: 'LOG', data: { message: `[Content] ${msg}`, level: 'info' } }).catch(() => {});
  }

  function waitForEl(sel, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(sel);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(sel);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + sel)); }, timeout);
    });
  }

  function setReactValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function clickButton(texts) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const t = btn.textContent.trim().toLowerCase();
      if (texts.some(txt => t.includes(txt.toLowerCase()))) {
        if (!btn.disabled) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  }

  function detectStep() {
    const url = window.location.href;
    if (url.includes('/profile')) return 'profile';

    const bodyText = document.body.innerText || '';

    if (bodyText.includes('Check your inbox') || bodyText.includes('verification code sent to')) {
      return 'otp';
    }

    if (bodyText.includes('Password confirmation') || bodyText.includes('Your password must contain')) {
      return 'password';
    }

    if (bodyText.includes("Let's create your account") || bodyText.includes('First name')) {
      return 'registration';
    }

    return 'unknown';
  }

  async function fillRegistration(firstName, lastName, email) {
    try {
      log('填写注册表单...');

      const firstNameInput = await waitForEl('input[name="firstName"], input[placeholder*="First"], input[autocomplete="given-name"]', 5000);
      setReactValue(firstNameInput, firstName);
      await sleep(300);

      const lastNameInput = await waitForEl('input[name="lastName"], input[placeholder*="Last"], input[autocomplete="family-name"]', 5000);
      setReactValue(lastNameInput, lastName);
      await sleep(300);

      const emailInput = await waitForEl('input[type="email"], input[name="email"], input[autocomplete="email"]', 5000);
      setReactValue(emailInput, email);
      await sleep(300);

      const checkbox = document.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.checked) {
        checkbox.click();
        await sleep(300);
      }

      await sleep(500);
      const clicked = clickButton(['continue', 'next']);
      log(`注册表单已提交: ${clicked}`);
      return true;
    } catch (e) {
      log(`填写注册表单失败: ${e.message}`);
      return false;
    }
  }

  async function fillPassword(password) {
    try {
      log('填写密码表单...');

      await sleep(500);
      const pwInputs = document.querySelectorAll('input[type="password"]');
      log(`找到 ${pwInputs.length} 个密码输入框`);

      if (pwInputs.length >= 2) {
        setReactValue(pwInputs[0], password);
        await sleep(300);
        setReactValue(pwInputs[1], password);
        await sleep(300);
      } else if (pwInputs.length === 1) {
        setReactValue(pwInputs[0], password);
        await sleep(300);
        const confirmPw = await waitForEl('input[type="password"]:nth-of-type(2)', 3000).catch(() => null);
        if (confirmPw && confirmPw !== pwInputs[0]) {
          setReactValue(confirmPw, password);
          await sleep(300);
        }
      }

      await sleep(500);
      const clicked = clickButton(['continue', 'next']);
      log(`密码表单已提交: ${clicked}`);
      return true;
    } catch (e) {
      log(`填写密码失败: ${e.message}`);
      return false;
    }
  }

  async function findOtpInputs() {
    // Strategy 1: maxlength=1
    let inputs = Array.from(document.querySelectorAll('input')).filter(i => {
      if (i.type === 'hidden' || i.type === 'checkbox' || i.type === 'password' || i.type === 'email') return false;
      return i.maxLength === 1;
    });
    if (inputs.length === 6) return inputs;

    // Strategy 2: inputmode=numeric
    inputs = Array.from(document.querySelectorAll('input[inputmode="numeric"]'));
    if (inputs.length === 6) return inputs;

    // Strategy 3: small visible inputs
    inputs = Array.from(document.querySelectorAll('input')).filter(i => {
      if (i.type === 'hidden' || i.type === 'checkbox' || i.type === 'password' || i.type === 'email') return false;
      const rect = i.getBoundingClientRect();
      return rect.width > 0 && rect.width < 80 && rect.height > 0 && rect.height < 80;
    });
    if (inputs.length >= 6) {
      inputs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      return inputs.slice(0, 6);
    }

    return [];
  }

  async function fillOtp(code) {
    try {
      log(`填写验证码: ${code}`);

      await sleep(1000);
      const otpInputs = await findOtpInputs();

      if (otpInputs.length === 6) {
        for (let i = 0; i < 6; i++) {
          const inp = otpInputs[i];
          inp.focus();
          setReactValue(inp, code[i]);
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: code[i], bubbles: true }));
          inp.dispatchEvent(new KeyboardEvent('keyup', { key: code[i], bubbles: true }));
          await sleep(100);
        }
        log('验证码已填入');
      } else {
        log(`未找到6个验证码输入框，找到: ${otpInputs.length}`);
        return false;
      }

      await sleep(1000);
      const clicked = clickButton(['create account', 'verify', 'submit', 'confirm']);
      log(`验证码已提交: ${clicked}`);
      return true;
    } catch (e) {
      log(`填写验证码失败: ${e.message}`);
      return false;
    }
  }

  let processing = false;
  let stopped = false;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, step: detectStep() });
    } else if (msg.type === 'FILL_REGISTRATION') {
      if (!stopped) {
        handleFillRegistration(msg.data);
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'OTP_RECEIVED') {
      if (!stopped) {
        handleOtpReceived(msg.data.code);
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'STOP') {
      stopped = true;
      processing = false;
      log('收到停止信号');
      sendResponse({ ok: true });
    } else if (msg.type === 'START') {
      stopped = false;
      processing = false;
      log('收到开始信号，重置状态');
      sendResponse({ ok: true });
    }
    return false;
  });

  async function handleFillRegistration(data) {
    if (processing || stopped) return;
    processing = true;

    try {
      // Wait for page to load
      await sleep(2000);
      
      if (stopped) return;
      
      // Try to detect step with retries
      let step = detectStep();
      let retries = 0;
      while (step === 'unknown' && retries < 5 && !stopped) {
        log(`页面未就绪，等待重试 (${retries + 1}/5)...`);
        await sleep(2000);
        step = detectStep();
        retries++;
      }
      
      if (stopped) return;
      
      log(`当前步骤: ${step}`);

      // If still unknown after retries, report failure
      if (step === 'unknown') {
        log('页面加载超时');
        chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '页面加载超时，无法检测步骤' } });
        return;
      }

      // If already on profile page, user is logged in - report failure
      if (step === 'profile') {
        log('检测到已登录，跳转到个人主页');
        chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '已登录，自动跳转到个人主页' } });
        return;
      }

      if (step === 'registration') {
        const ok = await fillRegistration(data.firstName, data.lastName, data.email);
        if (stopped) return;
        if (ok) {
          await sleep(3000);
          if (stopped) return;
          const newStep = detectStep();
          log(`注册后步骤: ${newStep}`);

          // Check if redirected to profile after form submission
          if (newStep === 'profile') {
            chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '表单提交后跳转到个人主页' } });
            return;
          }

          if (newStep === 'password') {
            const ok2 = await fillPassword(data.password);
            if (stopped) return;
            if (ok2) {
              await sleep(3000);
              if (stopped) return;
              const step3 = detectStep();
              log(`密码后步骤: ${step3}`);
              if (step3 === 'profile') {
                chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '密码填写后跳转到个人主页' } });
                return;
              }
              if (step3 === 'otp') {
                chrome.runtime.sendMessage({ type: 'NEED_OTP' });
              }
            }
          } else if (newStep === 'otp') {
            chrome.runtime.sendMessage({ type: 'NEED_OTP' });
          }
        }
      } else if (step === 'password') {
        const ok = await fillPassword(data.password);
        if (stopped) return;
        if (ok) {
          await sleep(3000);
          if (stopped) return;
          const step3 = detectStep();
          if (step3 === 'profile') {
            chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '密码填写后跳转到个人主页' } });
            return;
          }
          if (step3 === 'otp') {
            chrome.runtime.sendMessage({ type: 'NEED_OTP' });
          }
        }
      } else if (step === 'otp') {
        chrome.runtime.sendMessage({ type: 'NEED_OTP' });
      } else {
        // Unknown step - might be loading or error
        log(`未知步骤: ${step}`);
        chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: `未知页面状态: ${step}` } });
      }
    } finally {
      processing = false;
    }
  }

  async function handleOtpReceived(code) {
    if (stopped) return;
    
    const step = detectStep();
    if (step === 'otp') {
      await sleep(1000);
      if (stopped) return;
      const ok = await fillOtp(code);
      if (stopped) return;
      if (ok) {
        await sleep(8000);
        if (stopped) return;
        const finalStep = detectStep();
        log(`最终步骤: ${finalStep}, URL: ${window.location.href}`);

        if (finalStep === 'profile' || window.location.href.includes('/profile')) {
          chrome.runtime.sendMessage({ type: 'REG_COMPLETE' });
        } else {
          const bodyText = document.body.innerText || '';
          if (bodyText.includes('successfully') || bodyText.includes('Welcome') || bodyText.includes('Dashboard')) {
            chrome.runtime.sendMessage({ type: 'REG_COMPLETE' });
          } else {
            await sleep(5000);
            if (stopped) return;
            const s = detectStep();
            if (s === 'profile' || window.location.href.includes('/profile')) {
              chrome.runtime.sendMessage({ type: 'REG_COMPLETE' });
            } else {
              chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '注册后页面未知' } });
            }
          }
        }
      } else {
        chrome.runtime.sendMessage({ type: 'REG_FAILED', data: { reason: '验证码填写失败' } });
      }
    }
  }

  async function autoRun() {
    const result = await chrome.storage.local.get('wsr_state');
    const st = result.wsr_state;
    if (!st || !st.running) return;

    const step = detectStep();
    log(`自动运行检测步骤: ${step}`);

    if (step === 'profile') {
      chrome.runtime.sendMessage({ type: 'REG_COMPLETE' });
    } else if (step === 'otp') {
      chrome.runtime.sendMessage({ type: 'NEED_OTP' });
    }
  }

  if (document.readyState === 'complete') {
    autoRun();
  } else {
    window.addEventListener('load', autoRun);
  }
})();
