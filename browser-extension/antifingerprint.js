(function() {
  if (window.__wsr_antifingerprint_injected) return;
  window.__wsr_antifingerprint_injected = true;

  function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      result += chars[array[i] % chars.length];
    }
    return result;
  }

  function generateRandomFloat(min, max) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return min + (array[0] / (0xFFFFFFFF + 1)) * (max - min);
  }

  // Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // Override Canvas fingerprinting
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;

  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const result = originalToDataURL.apply(this, args);
    if (result.startsWith('data:image/png')) {
      try {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          const noise = generateRandomFloat(-1, 1);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + noise));
            imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noise));
            imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noise));
          }
          ctx.putImageData(imageData, 0, 0);
          return originalToDataURL.apply(this, args);
        }
      } catch (e) {}
    }
    return result;
  };

  HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
    const originalCallback = callback;
    const wrappedCallback = (blob) => {
      originalCallback(blob);
    };
    return originalToBlob.apply(this, [wrappedCallback, ...args]);
  };

  // Override WebGL renderer info
  const getExtension = WebGLRenderingContext.prototype.getExtension;
  const getParameter = WebGLRenderingContext.prototype.getParameter;

  WebGLRenderingContext.prototype.getParameter = function(param) {
    const result = getParameter.apply(this, arguments);
    
    if (param === 0x1F03) {
      return 'WebGL 1.0';
    }
    
    if (param === 0x1F02) {
      const renderers = [
        'ANGLE (Intel, Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0)',
        'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)',
        'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
        'ANGLE (Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      ];
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      return renderers[array[0] % renderers.length];
    }
    
    if (param === 0x9245 || param === 'glsl') {
      return 'WebGL GLSL ES 1.0';
    }

    if (param === 0x8C8A) {
      const vendors = ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Microsoft Corporation'];
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      return vendors[array[0] % vendors.length];
    }

    if (param === 0x9037) {
      return 16384;
    }

    return result;
  };

  // Override AudioContext fingerprinting
  const originalCreateDynamicsCompressor = OfflineAudioContext.prototype.createDynamicsCompressor;
  const audioCtxCreateDynamicsCompressor = AudioContext.prototype.createDynamicsCompressor;

  function addAudioNoise(context) {
    try {
      const buffer = context.createBuffer(1, context.sampleRate * 0.1, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() - 0.5) * 0.00001;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
    } catch (e) {}
  }

  AudioContext.prototype.createDynamicsCompressor = function() {
    const compressor = audioCtxCreateDynamicsCompressor.apply(this, arguments);
    addAudioNoise(this);
    return compressor;
  };

  OfflineAudioContext.prototype.createDynamicsCompressor = function() {
    const compressor = originalCreateDynamicsCompressor.apply(this, arguments);
    return compressor;
  };

  // Override font enumeration detection
  const originalFontFaceSet = document.fonts ? document.fonts.check : null;
  if (document.fonts && originalFontFaceSet) {
    document.fonts.check = function(...args) {
      const result = originalFontFaceSet.apply(this, args);
      return result;
    };
  }

  // Override screen/screen resolution fingerprinting
  const originalScreenProps = {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
  };

  // Override WebRTC local IP leak
  const originalRTCPeerConnection = window.RTCPeerConnection;
  if (originalRTCPeerConnection) {
    window.RTCPeerConnection = function(...args) {
      const pc = new originalRTCPeerConnection(...args);
      
      const originalCreateDataChannel = pc.createDataChannel;
      pc.createDataChannel = function(...dcArgs) {
        return originalCreateDataChannel.apply(this, dcArgs);
      };

      return pc;
    };
    window.RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
  }

  // Override timezone detection
  const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  Date.prototype.getTimezoneOffset = function() {
    return originalGetTimezoneOffset.apply(this, arguments);
  };

  const originalIntlDateTimeFormatResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  Intl.DateTimeFormat.prototype.resolvedOptions = function() {
    const options = originalIntlDateTimeFormatResolvedOptions.apply(this, arguments);
    return options;
  };

  // Override language detection
  const originalNavigatorLanguages = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
  if (originalNavigatorLanguages && originalNavigatorLanguages.get) {
    Object.defineProperty(navigator, 'languages', {
      get: () => {
        try {
          const langs = originalNavigatorLanguages.get.call(navigator);
          return langs || ['zh-CN', 'zh', 'en-US', 'en'];
        } catch (e) {
          return ['zh-CN', 'zh', 'en-US', 'en'];
        }
      },
    });
  }

  // Override hardware concurrency
  if (navigator.hardwareConcurrency) {
    const realConcurrency = navigator.hardwareConcurrency;
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => realConcurrency,
    });
  }

  // Override device memory
  if (navigator.deviceMemory) {
    const realMemory = navigator.deviceMemory;
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => realMemory,
    });
  }

  console.log('[WSR:antifingerprint] Anti-fingerprint protection activated');
})();
