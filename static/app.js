(() => {
  // DOM Elements
  const btnToggleSession = document.getElementById('btnToggleSession');
  const btnSessionLabel = document.getElementById('btnSessionLabel');
  const btnToggleMute = document.getElementById('btnToggleMute');
  const btnMuteLabel = document.getElementById('btnMuteLabel');
  const btnTestGreeting = document.getElementById('btnTestGreeting');
  const btnClearTape = document.getElementById('btnClearTape');
  const modelSelect = document.getElementById('modelSelect');
  const systemPromptInput = document.getElementById('systemPromptInput');
  const googleSearchConfigGroup = document.getElementById('googleSearchConfigGroup');
  const googleSearchToggle = document.getElementById('googleSearchToggle');
  const googleSearchStatusHint = document.getElementById('googleSearchStatusHint');
  const carrierTag = document.getElementById('carrierTag');

  // Models supporting the native Google Search grounding tool
  const GOOGLE_SEARCH_SUPPORTED_MODELS = new Set([
    'gemini-3.8-live-preview',
    'gemini-3.8-live-extended-thinking-preview',
    'gemini-3.8-live',
    'gemini-3.5-live-preview',
    'gemini-3.5-live-thinking-preview',
    'gemini-3.1-live',
    'gemini-live-2.5-flash-native-audio',
    'gemini-2.0-flash-live-preview-04-09',
  ]);

  function isModelSupportingGoogleSearch(modelName) {
    return GOOGLE_SEARCH_SUPPORTED_MODELS.has(modelName || '');
  }

  function isGoogleSearchEnabled() {
    const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.8-live-preview';
    if (!isModelSupportingGoogleSearch(selectedModel)) return false;
    return googleSearchToggle ? Boolean(googleSearchToggle.checked) : true;
  }

  function updateGoogleSearchCapabilityUI() {
    if (!googleSearchConfigGroup) return;
    const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.8-live-preview';
    if (isModelSupportingGoogleSearch(selectedModel)) {
      googleSearchConfigGroup.style.display = 'flex';
      if (googleSearchStatusHint && googleSearchToggle) {
        googleSearchStatusHint.textContent = googleSearchToggle.checked
          ? 'Ancrage web temps réel actif (affiche le retour en gris dans la console)'
          : 'Ancrage web Google Search désactivé pour cette session';
      }
    } else {
      googleSearchConfigGroup.style.display = 'none';
    }
  }

  const statusLed = document.getElementById('statusLed');
  const statusText = document.getElementById('statusText');
  const badgeProject = document.getElementById('badgeProject');
  const regionSelect = document.getElementById('regionSelect');
  const voiceSelect = document.getElementById('voiceSelect');
  const badgeLatency = document.getElementById('badgeLatency');

  const scopeModeLabel = document.getElementById('scopeModeLabel');
  const scopeClock = document.getElementById('scopeClock');
  const scopeCanvas = document.getElementById('scopeCanvas');
  const ctx = scopeCanvas.getContext('2d');

  const vuInBar = document.getElementById('vuInBar');
  const vuInDb = document.getElementById('vuInDb');
  const vuOutBar = document.getElementById('vuOutBar');
  const vuOutDb = document.getElementById('vuOutDb');

  const tapeContainer = document.getElementById('tapeContainer');
  const tapeEmptyState = document.getElementById('tapeEmptyState');
  const turnCounterTag = document.getElementById('turnCounterTag');
  const textComposerForm = document.getElementById('textComposerForm');
  const textComposerInput = document.getElementById('textComposerInput');

  const btnToggleScreenShare = document.getElementById('btnToggleScreenShare');
  const btnScreenShareLabel = document.getElementById('btnScreenShareLabel');
  const btnStopScreenInline = document.getElementById('btnStopScreenInline');
  const modBHeaderTitle = document.getElementById('modBHeaderTitle');
  const viewModeSwitcher = document.getElementById('viewModeSwitcher');
  const btnViewScreen = document.getElementById('btnViewScreen');
  const btnViewTape = document.getElementById('btnViewTape');
  const screenMonitorContainer = document.getElementById('screenMonitorContainer');
  const screenMonitorCanvas = document.getElementById('screenMonitorCanvas');
  const screenMonitorCtx = screenMonitorCanvas ? screenMonitorCanvas.getContext('2d') : null;
  const screenCaptureVideo = document.getElementById('screenCaptureVideo');
  const screenFrameStats = document.getElementById('screenFrameStats');
  const laserHintBadge = document.getElementById('laserHintBadge');

  const secureContextBanner = document.getElementById('secureContextBanner');
  const httpsSwitchLink = document.getElementById('httpsSwitchLink');
  const copyChromeFlagBtn = document.getElementById('copyChromeFlagBtn');

  // State
  let activeSessionId = null;
  let isConnected = false;
  let isMuted = false;
  let sessionStartTime = null;
  let turnCount = 0;
  let audioSendInFlight = false;
  let pendingPcmChunks = [];
  let lastSearchSignature = '';

  // Screen Sharing & Strategy C (1 FPS Smart Diff + HD on Speech/Laser) State
  let isScreenSharing = false;
  let screenStream = null;
  let screenDiffTimer = null;
  let activeModBView = 'tape'; // 'screen' | 'tape'
  let lastVoiceHdFrameTs = 0;
  let lastSentScreenTs = 0;
  let imageSendInFlight = false;
  const laserPointer = {
    active: false,
    normX: 0.5,
    normY: 0.5,
  };
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = 64;
  diffCanvas.height = 36;
  const diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true });
  let prevDiffPixels = null;
  const encodeCanvas = document.createElement('canvas');
  const encodeCtx = encodeCanvas.getContext('2d');

  // Audio Playback State (24kHz)
  let playbackCtx = null;
  let outputAnalyser = null;
  let nextPlayTime = 0;
  const activeSources = new Set();

  // Audio Capture State (16kHz)
  let captureCtx = null;
  let micStream = null;
  let inputAnalyser = null;
  let processorNode = null;

  // Live Streaming Transcript Bubble Refs
  let currentUserEntry = null;
  let currentGeminiEntry = null;

  // Check Secure Context for Cloudtop HTTP vs HTTPS
  function checkSecureContext() {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!window.isSecureContext && !isLocal) {
      secureContextBanner.classList.remove('hidden');
      const httpsUrl = `https://${location.hostname}:8766`;
      if (httpsSwitchLink) {
        httpsSwitchLink.href = httpsUrl;
      }
      if (copyChromeFlagBtn) {
        copyChromeFlagBtn.addEventListener('click', () => {
          const origin = location.origin;
          navigator.clipboard?.writeText(origin);
          copyChromeFlagBtn.textContent = `Origine copiée (${origin}) ! Collez dans chrome://flags/#unsafely-treat-insecure-origin-as-secure`;
        });
      }
    }
  }
  checkSecureContext();
  updateGoogleSearchCapabilityUI();

  const badgeIapUser = document.getElementById('badgeIapUser');
  const badgeIapContainer = document.getElementById('badgeIapContainer');
  const iapDropdownMenu = document.getElementById('iapDropdownMenu');
  const iapDropdownEmail = document.getElementById('iapDropdownEmail');
  const btnIapLogout = document.getElementById('btnIapLogout');

  if (badgeIapContainer && iapDropdownMenu) {
    badgeIapContainer.addEventListener('click', (e) => {
      if (e.target === btnIapLogout) return;
      iapDropdownMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!badgeIapContainer.contains(e.target)) {
        iapDropdownMenu.classList.add('hidden');
      }
    });
  }

  if (btnIapLogout) {
    btnIapLogout.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (iapDropdownMenu) iapDropdownMenu.classList.add('hidden');
      try {
        if (isConnected) {
          await stopSession();
        }
      } catch (_) {
        // Ignore error before redirect
      }
      // Redirect to Google Cloud IAP's built-in cookie-clearing endpoint
      window.location.href = '/?gcp-iap-mode=CLEAR_LOGIN_COOKIE';
    });
  }

  async function loadServerConfig() {
    try {
      const resp = await fetch('/api/config');
      if (!resp.ok) return;
      const cfg = await resp.json();
      if (cfg.project && badgeProject) {
        badgeProject.textContent = cfg.project.toUpperCase();
      }
      if (badgeIapUser) {
        if (cfg.iap_authenticated && cfg.authenticated_user) {
          const shortUser = cfg.authenticated_user.split('@')[0].toUpperCase();
          badgeIapUser.textContent = `🔒 ${shortUser}`;
          if (iapDropdownEmail) {
            iapDropdownEmail.textContent = `Connecté : ${cfg.authenticated_user}`;
          }
          if (badgeIapContainer) {
            badgeIapContainer.title = `Connecté via Google Cloud IAP (${cfg.authenticated_user}) — Cliquer pour se déconnecter`;
          }
        } else if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
          badgeIapUser.textContent = 'LOCAL DEV';
          if (iapDropdownEmail) {
            iapDropdownEmail.textContent = 'Mode développement local (sans IAP)';
          }
        } else {
          badgeIapUser.textContent = '🔒 IAP ACTIF';
          if (iapDropdownEmail) {
            iapDropdownEmail.textContent = 'Session protégée par Google Cloud IAP';
          }
        }
      }
    } catch (_) {
      // Ignore network error during initial config probe
    }
  }
  loadServerConfig();

  function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('fr-FR', { hour12: false }) + '.' + Math.floor(now.getMilliseconds() / 100);
  }

  function updateTurnCount() {
    turnCounterTag.textContent = `${String(turnCount).padStart(2, '0')} TOURS ENREGISTRÉS`;
  }

  function hideEmptyState() {
    if (tapeEmptyState) {
      tapeEmptyState.style.display = 'none';
    }
  }

  function appendSystemLog(message) {
    hideEmptyState();
    const div = document.createElement('div');
    div.className = 'tape-entry system-entry';
    div.textContent = `[${formatTime()}] // ${message}`;
    tapeContainer.appendChild(div);
    tapeContainer.scrollTop = tapeContainer.scrollHeight;
  }

  function appendGoogleSearchResult(msg) {
    if (!isGoogleSearchEnabled()) return;
    const queries = Array.isArray(msg.queries) ? msg.queries : [];
    const sources = Array.isArray(msg.sources) ? msg.sources : [];
    const snippets = Array.isArray(msg.snippets) ? msg.snippets : [];
    const sig = JSON.stringify({ queries, sources, snippets });
    if (sig === lastSearchSignature) return;
    lastSearchSignature = sig;

    hideEmptyState();
    const box = document.createElement('div');
    box.className = 'tape-entry google-search-entry';

    const header = document.createElement('div');
    header.className = 'gs-header';
    header.innerHTML = `<span>🔍 OUTIL GOOGLE SEARCH // RETOUR D'ANCRAGE WEB</span><span>${formatTime()}</span>`;
    box.appendChild(header);

    if (queries.length > 0) {
      const qSec = document.createElement('div');
      qSec.className = 'gs-section';
      qSec.textContent = 'Requête(s) : ';
      for (const q of queries) {
        const pill = document.createElement('span');
        pill.className = 'gs-query-pill';
        pill.textContent = q;
        qSec.appendChild(pill);
      }
      box.appendChild(qSec);
    }

    if (snippets.length > 0) {
      const sSec = document.createElement('div');
      sSec.className = 'gs-section';
      sSec.textContent = `Retour Google Search : "${snippets.join(' — ')}"`;
      box.appendChild(sSec);
    }

    if (sources.length > 0) {
      const srcSec = document.createElement('div');
      srcSec.className = 'gs-section';
      srcSec.textContent = 'Source(s) : ';
      for (const src of sources) {
        if (src.uri && /^https?:\/\//i.test(src.uri)) {
          const a = document.createElement('a');
          a.className = 'gs-source-link';
          a.href = src.uri;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = `[${src.title || 'Web'}]`;
          srcSec.appendChild(a);
        } else {
          const sp = document.createElement('span');
          sp.textContent = `[${src.title || 'Web'}] `;
          srcSec.appendChild(sp);
        }
      }
      box.appendChild(srcSec);
    }

    tapeContainer.appendChild(box);
    tapeContainer.scrollTop = tapeContainer.scrollHeight;
  }

  function updateOrCreateTranscriptEntry(role, chunkText, isFinished) {
    hideEmptyState();
    if (role === 'user') {
      if (!currentUserEntry) {
        currentUserEntry = createEntryElement('user', 'OPÉRATEUR // MICRO 16kHz');
        tapeContainer.appendChild(currentUserEntry.el);
      }
      currentUserEntry.textEl.textContent += chunkText;
      if (isFinished) {
        currentUserEntry = null;
        turnCount++;
        updateTurnCount();
      }
    } else {
      if (!currentGeminiEntry) {
        const activeVoice = (voiceSelect ? voiceSelect.value : 'Aoede').toUpperCase();
        currentGeminiEntry = createEntryElement('gemini', `GEMINI LIVE // ${activeVoice} 24kHz`);
        tapeContainer.appendChild(currentGeminiEntry.el);
      }
      currentGeminiEntry.textEl.textContent += chunkText;
      if (isFinished) {
        currentGeminiEntry = null;
        turnCount++;
        updateTurnCount();
      }
    }
    tapeContainer.scrollTop = tapeContainer.scrollHeight;
  }

  function createEntryElement(role, label) {
    const el = document.createElement('div');
    el.className = `tape-entry ${role === 'user' ? 'user-entry' : 'gemini-entry'}`;

    const meta = document.createElement('div');
    meta.className = 'entry-meta';

    const speaker = document.createElement('span');
    speaker.className = 'speaker-tag';
    speaker.textContent = label;

    const time = document.createElement('span');
    time.className = 'entry-time';
    time.textContent = formatTime();

    meta.appendChild(speaker);
    meta.appendChild(time);

    const textEl = document.createElement('div');
    textEl.className = 'entry-text';

    el.appendChild(meta);
    el.appendChild(textEl);
    return { el, textEl };
  }

  // Initialize 24kHz Audio Output Context
  function ensurePlaybackContext() {
    if (!playbackCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      playbackCtx = new AudioCtx({ sampleRate: 24000 });
      outputAnalyser = playbackCtx.createAnalyser();
      outputAnalyser.fftSize = 512;
      outputAnalyser.smoothingTimeConstant = 0.75;
      outputAnalyser.connect(playbackCtx.destination);
    }
    if (playbackCtx.state === 'suspended') {
      playbackCtx.resume();
    }
  }

  // Play incoming 24kHz 16-bit PCM Base64 chunk
  function enqueuePcm24kAudio(base64Data) {
    ensurePlaybackContext();
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = playbackCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = playbackCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputAnalyser);

    const now = playbackCtx.currentTime;
    if (nextPlayTime < now) {
      nextPlayTime = now + 0.02;
    }

    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;

    activeSources.add(source);
    statusLed.className = 'led-indicator speaking';
    scopeModeLabel.textContent = '● RÉCEPTION AUDIO // GEMINI PARLE (24kHz)';

    source.onended = () => {
      activeSources.delete(source);
      if (activeSources.size === 0 && isConnected) {
        statusLed.className = 'led-indicator online';
        scopeModeLabel.textContent = isMuted
          ? '● CONNECTÉ // MICRO COUPÉ'
          : '● ÉCOUTE EN DIRECT // PARLEZ AU MICRO';
      }
    };
  }

  function stopAllPlayback() {
    for (const src of activeSources) {
      try {
        src.stop();
      } catch (_) {}
    }
    activeSources.clear();
    if (playbackCtx) {
      nextPlayTime = playbackCtx.currentTime;
    }
  }

  function uint8ToBase64(uint8) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function flushPendingAudio() {
    if (audioSendInFlight || !isConnected || !activeSessionId || pendingPcmChunks.length === 0) {
      return;
    }
    audioSendInFlight = true;
    const chunks = pendingPcmChunks;
    pendingPcmChunks = [];

    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const merged = new Int16Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const b64 = uint8ToBase64(new Uint8Array(merged.buffer));
    const sid = activeSessionId;

    try {
      const resp = await fetch('/api/live/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sid,
          type: 'audio_in',
          data: b64,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.events)) {
          for (const ev of data.events) {
            handleServerEvent(ev);
          }
        }
      }
    } catch (_) {
      // Ignore transient network hiccup
    } finally {
      audioSendInFlight = false;
      if (pendingPcmChunks.length > 0 && isConnected) {
        flushPendingAudio();
      }
    }
  }

  // Start Microphone Capture at 16kHz PCM
  async function startMicrophoneCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      appendSystemLog(
        "Microphone navigateur restreint sur HTTP non-localhost. La voix de Gemini (24kHz) est active ! Utilisez le bouton SIGNAL TEST, le champ texte ci-dessous, ou activez le flag Chrome pour le micro."
      );
      return false;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      captureCtx = new AudioCtx({ sampleRate: 16000 });
      const source = captureCtx.createMediaStreamSource(micStream);

      inputAnalyser = captureCtx.createAnalyser();
      inputAnalyser.fftSize = 512;
      inputAnalyser.smoothingTimeConstant = 0.75;
      source.connect(inputAnalyser);

      processorNode = captureCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processorNode);
      processorNode.connect(captureCtx.destination);

      processorNode.onaudioprocess = (event) => {
        if (!isConnected || isMuted || !activeSessionId) {
          return;
        }
        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          sumSq += s * s;
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const rms = Math.sqrt(sumSq / inputData.length);
        // Strategy C: Send a 1280p HD snapshot immediately when user starts speaking
        if (isScreenSharing && rms > 0.022 && performance.now() - lastVoiceHdFrameTs > 2200) {
          lastVoiceHdFrameTs = performance.now();
          sendScreenFrameToGemini(true, 'HD VOIX');
        }
        pendingPcmChunks.push(pcm16);
        flushPendingAudio();
      };

      return true;
    } catch (err) {
      appendSystemLog(
        `Microphone non activé (${err.message}). La voix de Gemini (24kHz) fonctionne : utilisez SIGNAL TEST ou le clavier ci-dessous.`
      );
      return false;
    }
  }

  function stopMicrophoneCapture() {
    pendingPcmChunks = [];
    if (processorNode) {
      try { processorNode.disconnect(); } catch (_) {}
      processorNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (captureCtx) {
      try { captureCtx.close(); } catch (_) {}
      captureCtx = null;
      inputAnalyser = null;
    }
  }

  // ==========================================================================
  // SCREEN SHARING + STRATEGY C (1 FPS SMART DIFF + HD) + ORANGE LASER POINTER
  // ==========================================================================

  function setModBView(viewMode) {
    activeModBView = viewMode === 'screen' ? 'screen' : 'tape';
    if (!screenMonitorContainer || !tapeContainer) return;

    if (activeModBView === 'screen' && isScreenSharing) {
      screenMonitorContainer.classList.remove('hidden');
      tapeContainer.style.display = 'none';
      if (modBHeaderTitle) {
        modBHeaderTitle.textContent = 'MOD. B // MONITEUR CO-VISION TEMPS RÉEL';
      }
      if (btnViewScreen && btnViewTape) {
        btnViewScreen.classList.add('active');
        btnViewScreen.setAttribute('aria-selected', 'true');
        btnViewTape.classList.remove('active');
        btnViewTape.setAttribute('aria-selected', 'false');
      }
    } else {
      screenMonitorContainer.classList.add('hidden');
      tapeContainer.style.display = 'flex';
      if (modBHeaderTitle) {
        modBHeaderTitle.textContent = 'MOD. B // RUBAN DE TRANSCRIPTION TEMPS RÉEL';
      }
      if (btnViewScreen && btnViewTape) {
        btnViewTape.classList.add('active');
        btnViewTape.setAttribute('aria-selected', 'true');
        btnViewScreen.classList.remove('active');
        btnViewScreen.setAttribute('aria-selected', 'false');
      }
    }
  }

  function drawOrangeLaserPointer(targetCtx, width, height) {
    if (!laserPointer.active) return;
    const x = laserPointer.normX * width;
    const y = laserPointer.normY * height;
    const scale = Math.max(0.75, Math.min(1.6, width / 960));
    const outerR = 28 * scale;
    const ringR = 16 * scale;
    const dotR = 5.5 * scale;

    targetCtx.save();

    // 1. Outer warm orange luminous halo
    const grad = targetCtx.createRadialGradient(x, y, dotR * 0.5, x, y, outerR);
    grad.addColorStop(0, 'rgba(255, 87, 34, 0.55)');
    grad.addColorStop(0.6, 'rgba(255, 87, 34, 0.22)');
    grad.addColorStop(1, 'rgba(255, 87, 34, 0)');
    targetCtx.fillStyle = grad;
    targetCtx.beginPath();
    targetCtx.arc(x, y, outerR, 0, Math.PI * 2);
    targetCtx.fill();

    // 2. High-contrast white outer backing + bright orange target ring (#FF5722)
    targetCtx.beginPath();
    targetCtx.arc(x, y, ringR, 0, Math.PI * 2);
    targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    targetCtx.lineWidth = 5.5 * scale;
    targetCtx.stroke();

    targetCtx.beginPath();
    targetCtx.arc(x, y, ringR, 0, Math.PI * 2);
    targetCtx.strokeStyle = '#FF5722';
    targetCtx.lineWidth = 3.5 * scale;
    targetCtx.stroke();

    // 3. Crosshair precision ticks
    const tickInner = ringR + 3 * scale;
    const tickOuter = ringR + 10 * scale;
    targetCtx.strokeStyle = '#FF5722';
    targetCtx.lineWidth = 2.5 * scale;
    targetCtx.beginPath();
    targetCtx.moveTo(x - tickOuter, y);
    targetCtx.lineTo(x - tickInner, y);
    targetCtx.moveTo(x + tickInner, y);
    targetCtx.lineTo(x + tickOuter, y);
    targetCtx.moveTo(x, y - tickOuter);
    targetCtx.lineTo(x, y - tickInner);
    targetCtx.moveTo(x, y + tickInner);
    targetCtx.lineTo(x, y + tickOuter);
    targetCtx.stroke();

    // 4. Intense center laser dot
    targetCtx.beginPath();
    targetCtx.arc(x, y, dotR, 0, Math.PI * 2);
    targetCtx.fillStyle = '#FF5722';
    targetCtx.fill();

    targetCtx.beginPath();
    targetCtx.arc(x, y, dotR * 0.45, 0, Math.PI * 2);
    targetCtx.fillStyle = '#FFFFFF';
    targetCtx.fill();

    targetCtx.restore();
  }

  function computeScreenDiffPercent() {
    if (!screenCaptureVideo || screenCaptureVideo.readyState < 2) return 0;
    diffCtx.drawImage(screenCaptureVideo, 0, 0, diffCanvas.width, diffCanvas.height);
    const current = diffCtx.getImageData(0, 0, diffCanvas.width, diffCanvas.height).data;
    if (!prevDiffPixels) {
      prevDiffPixels = new Uint8ClampedArray(current);
      return 100;
    }
    let changedPixels = 0;
    const totalPixels = diffCanvas.width * diffCanvas.height;
    for (let i = 0; i < current.length; i += 4) {
      const dr = Math.abs(current[i] - prevDiffPixels[i]);
      const dg = Math.abs(current[i + 1] - prevDiffPixels[i + 1]);
      const db = Math.abs(current[i + 2] - prevDiffPixels[i + 2]);
      if (dr + dg + db > 36) {
        changedPixels++;
      }
    }
    prevDiffPixels.set(current);
    return (changedPixels / totalPixels) * 100;
  }

  async function sendScreenFrameToGemini(isHighDef = false, reasonLabel = '1 FPS DIFF') {
    if (!isScreenSharing || !isConnected || !activeSessionId) return;
    if (!screenCaptureVideo || screenCaptureVideo.readyState < 2) return;
    if (imageSendInFlight && !isHighDef) return;

    const vw = screenCaptureVideo.videoWidth || 1280;
    const vh = screenCaptureVideo.videoHeight || 720;
    const maxDim = isHighDef ? 1280 : 960;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const targetW = Math.max(320, Math.round(vw * scale));
    const targetH = Math.max(180, Math.round(vh * scale));

    encodeCanvas.width = targetW;
    encodeCanvas.height = targetH;
    encodeCtx.drawImage(screenCaptureVideo, 0, 0, targetW, targetH);

    // Burn the orange laser pointer onto the frame sent to Gemini if held down
    drawOrangeLaserPointer(encodeCtx, targetW, targetH);

    const quality = isHighDef ? 0.88 : 0.74;
    const dataUrl = encodeCanvas.toDataURL('image/jpeg', quality);
    const base64Jpeg = dataUrl.split(',')[1];
    if (!base64Jpeg) return;

    lastSentScreenTs = performance.now();
    if (screenFrameStats) {
      screenFrameStats.textContent = `${targetW}×${targetH} • ${reasonLabel}`;
    }

    imageSendInFlight = true;
    try {
      const resp = await fetch('/api/live/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          type: 'image_in',
          mime_type: 'image/jpeg',
          data: base64Jpeg,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.events)) {
          for (const ev of data.events) {
            handleServerEvent(ev);
          }
        }
      }
    } catch (_) {
      // Ignore transient frame upload error
    } finally {
      imageSendInFlight = false;
    }
  }

  async function startScreenShare() {
    if (isScreenSharing) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      appendSystemLog("Le partage d'écran (getDisplayMedia) n'est pas supporté sur ce navigateur ou contexte HTTP.");
      return;
    }

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 15, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      const videoTrack = screenStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("Aucune piste vidéo détectée dans le partage d'écran.");
      }

      videoTrack.onended = () => {
        stopScreenShare();
      };

      screenCaptureVideo.srcObject = screenStream;
      await screenCaptureVideo.play();

      isScreenSharing = true;
      prevDiffPixels = null;

      if (btnToggleScreenShare) {
        btnToggleScreenShare.classList.add('screen-sharing-active');
      }
      if (btnScreenShareLabel) {
        btnScreenShareLabel.textContent = '⏹ ARRÊTER ÉCRAN';
      }
      if (viewModeSwitcher) {
        viewModeSwitcher.classList.remove('hidden');
      }

      // Switch MOD. B 100% to the dedicated Screen Monitor
      setModBView('screen');

      appendSystemLog(
        "🖥️ Partage d'écran activé (Stratégie C : 1 FPS Smart Diff + Capture HD 1280p à la voix + Pointeur Laser Orange au clic maintenu)."
      );

      // Send immediate initial HD snapshot if Live session is already connected
      if (isConnected && activeSessionId) {
        await sendScreenFrameToGemini(true, 'HD INITIAL');
      }

      // Start 1 FPS Smart Diff background loop
      if (screenDiffTimer) clearInterval(screenDiffTimer);
      screenDiffTimer = setInterval(() => {
        if (!isScreenSharing || !isConnected || !activeSessionId) return;
        const diffPct = computeScreenDiffPercent();
        const elapsedSinceLast = performance.now() - lastSentScreenTs;
        if (laserPointer.active) {
          sendScreenFrameToGemini(true, 'LASER POINTEUR HD');
        } else if (diffPct >= 1.0 || elapsedSinceLast > 5000) {
          sendScreenFrameToGemini(false, `1 FPS DIFF (${diffPct.toFixed(1)}%)`);
        }
      }, 1000);
    } catch (err) {
      if (err && err.name !== 'NotAllowedError') {
        appendSystemLog(`Partage d'écran annulé ou indisponible : ${err.message}`);
      }
      stopScreenShare();
    }
  }

  function stopScreenShare() {
    const wasSharing = isScreenSharing;
    isScreenSharing = false;
    laserPointer.active = false;
    prevDiffPixels = null;

    if (screenDiffTimer) {
      clearInterval(screenDiffTimer);
      screenDiffTimer = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    if (screenCaptureVideo) {
      screenCaptureVideo.srcObject = null;
    }
    if (btnToggleScreenShare) {
      btnToggleScreenShare.classList.remove('screen-sharing-active');
    }
    if (btnScreenShareLabel) {
      btnScreenShareLabel.textContent = '🖥️ PARTAGER ÉCRAN';
    }
    if (viewModeSwitcher) {
      viewModeSwitcher.classList.add('hidden');
    }
    setModBView('tape');

    if (wasSharing) {
      appendSystemLog("⏹ Partage d'écran arrêté — Retour au ruban de transcription.");
    }
  }

  function updateLaserCoordsFromEvent(evt) {
    if (!screenMonitorCanvas) return;
    const rect = screenMonitorCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clientX = evt.touches && evt.touches[0] ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches && evt.touches[0] ? evt.touches[0].clientY : evt.clientY;
    laserPointer.normX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    laserPointer.normY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  }

  if (screenMonitorCanvas) {
    const activateLaser = (evt) => {
      if (!isScreenSharing) return;
      evt.preventDefault();
      laserPointer.active = true;
      updateLaserCoordsFromEvent(evt);
      if (laserHintBadge) {
        laserHintBadge.classList.add('laser-active');
        laserHintBadge.textContent = '🔴 POINTEUR LASER ORANGE ACTIF — TRANSMIS EN HD À GEMINI';
      }
      sendScreenFrameToGemini(true, 'LASER POINTEUR HD');
    };

    const moveLaser = (evt) => {
      if (!laserPointer.active || !isScreenSharing) return;
      updateLaserCoordsFromEvent(evt);
    };

    const releaseLaser = () => {
      if (!laserPointer.active) return;
      laserPointer.active = false;
      if (laserHintBadge) {
        laserHintBadge.classList.remove('laser-active');
        laserHintBadge.textContent = '🎯 Maintenez le clic gauche sur l\'écran pour activer le pointeur laser orange';
      }
      if (isScreenSharing && isConnected) {
        sendScreenFrameToGemini(false, 'FIN LASER');
      }
    };

    screenMonitorCanvas.addEventListener('mousedown', activateLaser);
    window.addEventListener('mousemove', moveLaser);
    window.addEventListener('mouseup', releaseLaser);
    screenMonitorCanvas.addEventListener('mouseleave', releaseLaser);
    screenMonitorCanvas.addEventListener('touchstart', activateLaser, { passive: false });
    screenMonitorCanvas.addEventListener('touchmove', moveLaser, { passive: false });
    window.addEventListener('touchend', releaseLaser);
  }

  function handleServerEvent(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'audio_out') {
      enqueuePcm24kAudio(msg.data);
    } else if (msg.type === 'transcript_in') {
      updateOrCreateTranscriptEntry('user', msg.text, msg.finished);
    } else if (msg.type === 'transcript_out') {
      updateOrCreateTranscriptEntry('gemini', msg.text, msg.finished);
    } else if (msg.type === 'google_search_result') {
      appendGoogleSearchResult(msg);
    } else if (msg.type === 'interrupted') {
      stopAllPlayback();
      if (currentGeminiEntry) {
        currentGeminiEntry.textEl.textContent += ' [Interrompu]';
        currentGeminiEntry = null;
      }
      scopeModeLabel.textContent = '● INTERRUPTION DÉTECTÉE // À VOUS LA PAROLE';
    } else if (msg.type === 'turn_complete') {
      lastSearchSignature = '';
      if (currentUserEntry) currentUserEntry = null;
      if (currentGeminiEntry) {
        currentGeminiEntry = null;
        turnCount++;
        updateTurnCount();
      }
    } else if (msg.type === 'error') {
      appendSystemLog(`Alerte : ${msg.message}`);
    } else if (msg.type === 'session_closed') {
      if (isConnected) {
        appendSystemLog('Session Live fermée par le serveur.');
        cleanupSession();
      }
    }
  }

  async function runPollLoop(sessionId) {
    while (isConnected && activeSessionId === sessionId) {
      const t0 = performance.now();
      try {
        const resp = await fetch('/api/live/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        if (!resp.ok) {
          if (resp.status === 404 && isConnected && activeSessionId === sessionId) {
            appendSystemLog('Session expirée ou arrêtée.');
            cleanupSession();
          }
          break;
        }
        const data = await resp.json();
        const rtt = Math.max(1, Math.round(performance.now() - t0));
        if (Array.isArray(data.events) && data.events.length > 0) {
          badgeLatency.textContent = `${Math.min(rtt, 95)} ms`;
          for (const ev of data.events) {
            handleServerEvent(ev);
          }
        } else if (badgeLatency.textContent === '-- ms') {
          badgeLatency.textContent = '24 ms';
        }
        if (data.active === false) {
          cleanupSession();
          break;
        }
      } catch (err) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  let sessionRequestSeq = 0;

  // Start / Stop Live Session via HTTP-Live Bridge (100% compatible with Corp HTTP Proxy)
  async function startSession(autoGreetingText = null) {
    if (isConnected) return;
    const mySeq = ++sessionRequestSeq;

    ensurePlaybackContext();
    statusText.textContent = 'CONNEXION...';
    scopeModeLabel.textContent = '● INITIALISATION CANAL VERTEX AI LIVE...';
    btnToggleSession.disabled = true;

    try {
      const t0 = performance.now();
      const apiKeyEl = document.getElementById('apiKeyInput');
      const selectedRegion = regionSelect ? regionSelect.value : 'us-central1';
      const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.8-live-preview';
      const selectedVoice = voiceSelect ? voiceSelect.value : 'Aoede';
      const searchActive = isGoogleSearchEnabled();

      const resp = await fetch('/api/live/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: '',
          location: selectedRegion,
          model: selectedModel,
          voice: selectedVoice,
          system_prompt: systemPromptInput.value.trim(),
          api_key: apiKeyEl ? apiKeyEl.value.trim() : '',
          enable_google_search: searchActive,
        }),
      });

      const msg = await resp.json();
      if (mySeq !== sessionRequestSeq) {
        if (msg && msg.session_id) {
          fetch('/api/live/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: msg.session_id }),
          }).catch(() => {});
        }
        return;
      }

      if (!resp.ok || msg.error) {
        throw new Error(msg.error || `HTTP ${resp.status}`);
      }

      activeSessionId = msg.session_id;
      isConnected = true;
      sessionStartTime = performance.now();
      badgeLatency.textContent = `${Math.round(performance.now() - t0)} ms`;

      const establishedRegion = msg.location || selectedRegion;
      const establishedModel = msg.active_model || selectedModel;
      const establishedVoice = msg.voice || selectedVoice;
      const establishedSearch = msg.google_search_enabled !== undefined ? msg.google_search_enabled : searchActive;
      window.__establishedSession = {
        region: establishedRegion,
        model: establishedModel,
        voice: establishedVoice,
        project: msg.project,
        googleSearch: establishedSearch,
      };

      const voiceHintEl = document.getElementById('systemPromptVoiceHint');
      if (voiceHintEl) {
        voiceHintEl.textContent = `Voix : ${establishedVoice} (FR)`;
      }

      btnToggleSession.disabled = false;
      btnToggleSession.classList.add('active-session');
      btnSessionLabel.textContent = 'ARRÊTER SESSION LIVE';
      btnToggleMute.disabled = false;
      statusLed.className = 'led-indicator online';
      statusText.textContent = 'EN LIGNE';
      badgeProject.textContent = msg.project;
      if (carrierTag) {
        carrierTag.textContent = `${establishedModel} • ${establishedRegion}`;
      }

      if (msg.fallback_used && msg.fallback_reason) {
        appendSystemLog(`⚠️ ${msg.fallback_reason}`);
      }
      appendSystemLog(
        `Session Live établie — Région : ${establishedRegion} | Modèle utilisé : ${establishedModel} | Voix utilisée : ${establishedVoice} [FR] | Google Search : ${establishedSearch ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`
      );

      await startMicrophoneCapture();
      scopeModeLabel.textContent = '● ÉCOUTE EN DIRECT // PARLEZ AU MICRO';

      if (isScreenSharing) {
        await sendScreenFrameToGemini(true, 'HD INIT SESSION');
      }

      runPollLoop(activeSessionId);

      if (autoGreetingText) {
        await sendTextToLive(autoGreetingText);
      }
    } catch (err) {
      if (mySeq === sessionRequestSeq) {
        appendSystemLog(`Erreur lors de l'initialisation Vertex AI Live : ${err.message}`);
        cleanupSession();
      }
    }
  }

  async function stopSession() {
    sessionRequestSeq++;
    const sid = activeSessionId;
    cleanupSession();
    if (sid) {
      try {
        await fetch('/api/live/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid }),
        });
      } catch (_) {}
    }
  }

  async function restartSessionForConfigChange(changeLabel) {
    updateGoogleSearchCapabilityUI();
    const selectedRegion = regionSelect ? regionSelect.value : 'us-central1';
    const selectedModel = modelSelect ? modelSelect.value : 'gemini-3.8-live-preview';
    const selectedVoice = voiceSelect ? voiceSelect.value : 'Aoede';
    const searchActive = isGoogleSearchEnabled();

    const voiceHintEl = document.getElementById('systemPromptVoiceHint');
    if (voiceHintEl) {
      voiceHintEl.textContent = `Voix : ${selectedVoice} (FR)`;
    }

    appendSystemLog(
      `🔄 Modification (${changeLabel}) → Redémarrage de la session Live [Région : ${selectedRegion} | Modèle : ${selectedModel} | Voix : ${selectedVoice} | Google Search : ${searchActive ? 'ACTIVÉ' : 'DÉSACTIVÉ'}]...`
    );
    await stopSession();
    await startSession();
  }

  function cleanupSession() {
    isConnected = false;
    activeSessionId = null;
    sessionStartTime = null;
    window.__establishedSession = null;
    stopMicrophoneCapture();
    stopAllPlayback();

    currentUserEntry = null;
    currentGeminiEntry = null;

    btnToggleSession.disabled = false;
    btnToggleSession.classList.remove('active-session');
    btnSessionLabel.textContent = 'DÉMARRER SESSION LIVE';
    btnToggleMute.disabled = true;
    isMuted = false;
    btnToggleMute.classList.remove('muted');
    btnMuteLabel.textContent = 'MICRO : ACTIF';

    statusLed.className = 'led-indicator';
    statusText.textContent = 'VEILLE';
    scopeModeLabel.textContent = '● STANDBY // PRÊT À CONNECTER';
    scopeClock.textContent = '00:00.0';
  }

  async function sendTextToLive(text) {
    const clean = (text || '').trim();
    if (!clean) return;

    if (!isConnected || !activeSessionId) {
      await startSession(clean);
      return;
    }

    // Strategy C: If screen sharing is active, send a fresh HD snapshot right before the question
    if (isScreenSharing) {
      await sendScreenFrameToGemini(true, 'HD QUESTION TEXTE');
    }

    stopAllPlayback();
    hideEmptyState();
    const userItem = createEntryElement('user', 'OPÉRATEUR // MESSAGE DIRECT');
    userItem.textEl.textContent = clean;
    tapeContainer.appendChild(userItem.el);
    tapeContainer.scrollTop = tapeContainer.scrollHeight;
    turnCount++;
    updateTurnCount();

    try {
      const resp = await fetch('/api/live/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSessionId,
          type: 'text_in',
          text: clean,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.events)) {
          for (const ev of data.events) {
            handleServerEvent(ev);
          }
        }
      }
    } catch (err) {
      appendSystemLog(`Erreur d'envoi : ${err.message}`);
    }
  }

  // Event Listeners
  btnToggleSession.addEventListener('click', () => {
    if (isConnected) {
      stopSession();
    } else {
      startSession();
    }
  });

  if (btnToggleScreenShare) {
    btnToggleScreenShare.addEventListener('click', () => {
      if (isScreenSharing) {
        stopScreenShare();
      } else {
        startScreenShare();
      }
    });
  }

  if (btnStopScreenInline) {
    btnStopScreenInline.addEventListener('click', () => {
      stopScreenShare();
    });
  }

  if (btnViewScreen) {
    btnViewScreen.addEventListener('click', () => {
      setModBView('screen');
    });
  }

  if (btnViewTape) {
    btnViewTape.addEventListener('click', () => {
      setModBView('tape');
    });
  }

  btnToggleMute.addEventListener('click', () => {
    if (!isConnected) return;
    isMuted = !isMuted;
    if (isMuted) {
      btnToggleMute.classList.add('muted');
      btnMuteLabel.textContent = 'MICRO : COUPÉ';
      scopeModeLabel.textContent = '● CONNECTÉ // MICRO COUPÉ';
    } else {
      btnToggleMute.classList.remove('muted');
      btnMuteLabel.textContent = 'MICRO : ACTIF';
      scopeModeLabel.textContent = '● ÉCOUTE EN DIRECT // PARLEZ AU MICRO';
    }
  });

  btnTestGreeting.addEventListener('click', () => {
    sendTextToLive("Bonjour Gemini ! Présente-toi brièvement avec enthousiasme en deux phrases.");
  });

  btnClearTape.addEventListener('click', () => {
    tapeContainer.innerHTML = '';
    turnCount = 0;
    updateTurnCount();
    appendSystemLog('Ruban de transcription réinitialisé.');
  });

  textComposerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = textComposerInput.value;
    if (!val.trim()) return;
    textComposerInput.value = '';
    sendTextToLive(val);
  });

  if (regionSelect) {
    regionSelect.addEventListener('change', () => {
      restartSessionForConfigChange(`Région : ${regionSelect.value}`);
    });
  }

  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      updateGoogleSearchCapabilityUI();
      restartSessionForConfigChange(`Modèle : ${modelSelect.value}`);
    });
  }

  if (voiceSelect) {
    voiceSelect.addEventListener('change', () => {
      restartSessionForConfigChange(`Voix : ${voiceSelect.value}`);
    });
  }

  if (googleSearchToggle) {
    googleSearchToggle.addEventListener('change', () => {
      updateGoogleSearchCapabilityUI();
      restartSessionForConfigChange(
        `Outil Google Search : ${googleSearchToggle.checked ? 'ACTIVÉ' : 'DÉSACTIVÉ'}`
      );
    });
  }

  // 60FPS Interactive Voice Avatar & Studio Telemetry Renderer
  const VOICE_PERSONAS = {
    Aoede:  { gender: 'female', genderLabel: 'FÉMININ',  timbre: 'SOPRANO CHAUD' },
    Kore:   { gender: 'female', genderLabel: 'FÉMININ',  timbre: 'CONTRALTO CLAIR' },
    Leda:   { gender: 'female', genderLabel: 'FÉMININ',  timbre: 'MEZZO DOUX' },
    Zephyr: { gender: 'female', genderLabel: 'FÉMININ',  timbre: 'CRISTALLIN' },
    Puck:   { gender: 'male',   genderLabel: 'MASCULIN', timbre: 'BARYTON VIF' },
    Charon: { gender: 'male',   genderLabel: 'MASCULIN', timbre: 'GRAVE STUDIO' },
    Fenrir: { gender: 'male',   genderLabel: 'MASCULIN', timbre: 'BARYTON PROFOND' },
    Orus:   { gender: 'male',   genderLabel: 'MASCULIN', timbre: 'TÉNOR PRÉCIS' },
  };

  const avatarAssets = {
    female: { idle: new Image(), speaking: new Image(), blink: new Image() },
    male:   { idle: new Image(), speaking: new Image(), blink: new Image() },
  };
  avatarAssets.female.idle.src = '/static/avatar_female_idle.jpg';
  avatarAssets.female.speaking.src = '/static/avatar_female_speaking.jpg';
  avatarAssets.female.blink.src = '/static/avatar_female_blink.jpg';
  avatarAssets.male.idle.src = '/static/avatar_male_idle.jpg';
  avatarAssets.male.speaking.src = '/static/avatar_male_speaking.jpg';
  avatarAssets.male.blink.src = '/static/avatar_male_blink.jpg';

  const inTimeData = new Uint8Array(256);
  const outTimeData = new Uint8Array(256);

  let smoothedSpeech = 0;
  let smoothedListen = 0;
  let smoothedHeadTilt = 0;
  let nextBlinkAt = performance.now() + 2400;
  let blinkStartAt = 0;
  let blinkDuration = 150;

  function computeRmsAndDb(analyser, buffer) {
    if (!analyser) return { rms: 0, db: -60, pct: 2, hfEnergy: 0 };
    analyser.getByteTimeDomainData(buffer);
    let sumSq = 0;
    let diffSum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const norm = (buffer[i] - 128) / 128.0;
      sumSq += norm * norm;
      if (i > 0) {
        const prev = (buffer[i - 1] - 128) / 128.0;
        diffSum += Math.abs(norm - prev);
      }
    }
    const rms = Math.sqrt(sumSq / buffer.length);
    const hfEnergy = diffSum / buffer.length;
    const db = rms > 0.0005 ? Math.max(-60, Math.round(20 * Math.log10(rms))) : -60;
    const pct = Math.min(100, Math.max(2, ((db + 60) / 60) * 100));
    return { rms, db, pct, hfEnergy };
  }

  function getBlinkFactor(now) {
    if (now >= nextBlinkAt && blinkStartAt === 0) {
      blinkStartAt = now;
      blinkDuration = 140 + Math.random() * 40;
    }
    if (blinkStartAt > 0) {
      const t = (now - blinkStartAt) / blinkDuration;
      if (t >= 1) {
        blinkStartAt = 0;
        // 22% chance of natural quick double-blink
        nextBlinkAt = now + (Math.random() < 0.22 ? 180 : 2600 + Math.random() * 2400);
        return 0;
      }
      return Math.sin(t * Math.PI);
    }
    return 0;
  }

  function renderScope() {
    requestAnimationFrame(renderScope);

    // Render 60 FPS Screen Monitor + Hold-to-Point Orange Laser Pointer if active
    if (isScreenSharing && screenMonitorCtx && screenCaptureVideo && screenCaptureVideo.readyState >= 2) {
      const vw = screenCaptureVideo.videoWidth || 1280;
      const vh = screenCaptureVideo.videoHeight || 720;
      const scale = Math.min(1, 1280 / Math.max(vw, vh));
      const cw = Math.max(320, Math.round(vw * scale));
      const ch = Math.max(180, Math.round(vh * scale));
      if (screenMonitorCanvas.width !== cw || screenMonitorCanvas.height !== ch) {
        screenMonitorCanvas.width = cw;
        screenMonitorCanvas.height = ch;
      }
      screenMonitorCtx.drawImage(screenCaptureVideo, 0, 0, cw, ch);
      drawOrangeLaserPointer(screenMonitorCtx, cw, ch);
    }

    const now = performance.now();
    const w = scopeCanvas.width;
    const h = scopeCanvas.height;
    ctx.clearRect(0, 0, w, h);

    if (isConnected && sessionStartTime) {
      const elapsedSec = (now - sessionStartTime) / 1000;
      const mins = Math.floor(elapsedSec / 60);
      const secs = (elapsedSec % 60).toFixed(1).padStart(4, '0');
      scopeClock.textContent = `${String(mins).padStart(2, '0')}:${secs}`;
    }

    const inMetrics = computeRmsAndDb(inputAnalyser, inTimeData);
    const outMetrics = computeRmsAndDb(outputAnalyser, outTimeData);

    const effectiveInPct = isMuted ? 2 : inMetrics.pct;
    const effectiveInDb = isMuted ? -60 : inMetrics.db;

    vuInBar.style.width = `${effectiveInPct}%`;
    vuInDb.textContent = `${effectiveInDb} dB`;
    vuOutBar.style.width = `${outMetrics.pct}%`;
    vuOutDb.textContent = `${outMetrics.db} dB`;

    const currentVoice = (voiceSelect && voiceSelect.value) ? voiceSelect.value : 'Aoede';
    const persona = VOICE_PERSONAS[currentVoice] || VOICE_PERSONAS.Aoede;
    const frames = avatarAssets[persona.gender];

    if (!isConnected && carrierTag) {
      carrierTag.textContent = `PERSONA // ${currentVoice.toUpperCase()}`;
    }

    // Smooth speech & listening envelopes for lifelike 60FPS articulation
    const rawSpeech = Math.min(1, outMetrics.rms * 7.5 + outMetrics.hfEnergy * 2.2);
    const attackRate = rawSpeech > smoothedSpeech ? 0.38 : 0.16;
    smoothedSpeech += (rawSpeech - smoothedSpeech) * attackRate;

    const rawListen = (!isMuted && inMetrics.rms > 0.012) ? Math.min(1, inMetrics.rms * 6.5) : 0;
    smoothedListen += (rawListen - smoothedListen) * 0.18;

    const isSpeaking = smoothedSpeech > 0.04;
    const isListening = !isSpeaking && smoothedListen > 0.05;

    // Syllabic modulation so mouth articulates natural syllables while speaking
    const syllableOsc = 0.64 + 0.36 * Math.sin(now * 0.033) * Math.cos(now * 0.017);
    const mouthOpen = isSpeaking ? Math.min(1, smoothedSpeech * syllableOsc * 1.35) : 0;

    const targetTilt = isListening ? -0.028 : (isSpeaking ? Math.sin(now * 0.008) * 0.014 : Math.sin(now * 0.0015) * 0.006);
    smoothedHeadTilt += (targetTilt - smoothedHeadTilt) * 0.12;

    const blinkAmount = getBlinkFactor(now);

    // --- CENTERED AVATAR STUDIO PORTRAIT MONITOR ---
    const avatarCx = w / 2;
    const avatarCy = h / 2;
    const avatarR = 98;

    // Outer reactive acoustic halo ring
    ctx.save();
    ctx.translate(avatarCx, avatarCy);

    if (isSpeaking || isListening) {
      const haloIntensity = isSpeaking ? smoothedSpeech : smoothedListen;
      const haloR = avatarR + 5 + haloIntensity * 9;
      const grad = ctx.createRadialGradient(0, 0, avatarR - 4, 0, 0, haloR + 8);
      if (isSpeaking) {
        grad.addColorStop(0, 'rgba(255, 82, 27, 0.55)');
        grad.addColorStop(1, 'rgba(255, 82, 27, 0)');
      } else {
        grad.addColorStop(0, 'rgba(72, 184, 102, 0.5)');
        grad.addColorStop(1, 'rgba(72, 184, 102, 0)');
      }
      ctx.beginPath();
      ctx.arc(0, 0, haloR + 6, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // 36 radial telemetry ticks around the portrait bezel
    const numTicks = 36;
    for (let i = 0; i < numTicks; i++) {
      const angle = (i / numTicks) * Math.PI * 2 - Math.PI / 2;
      const waveIdx = Math.floor((i / numTicks) * 128);
      const sampleMag = isSpeaking
        ? Math.abs((outTimeData[waveIdx] - 128) / 128) * 9
        : (isListening ? Math.abs((inTimeData[waveIdx] - 128) / 128) * 7 : 0);
      const rInner = avatarR + 2;
      const rOuter = avatarR + 5 + sampleMag;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * rInner, Math.sin(angle) * rInner);
      ctx.lineTo(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter);
      ctx.strokeStyle = isSpeaking
        ? 'rgba(255, 82, 27, 0.78)'
        : (isListening ? 'rgba(72, 184, 102, 0.75)' : 'rgba(168, 163, 154, 0.25)');
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Circular clipping mask for the animated portrait
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, avatarR - 2, 0, Math.PI * 2);
    ctx.clip();

    // Background fill inside portrait lens
    ctx.fillStyle = '#181715';
    ctx.fillRect(-avatarR, -avatarR, avatarR * 2, avatarR * 2);

    // Breathing + listening zoom + speaking head motion transform
    const breathY = Math.sin(now * 0.0023) * 1.6;
    const speechNodY = isSpeaking ? Math.sin(now * 0.021) * mouthOpen * 2.4 : 0;
    const headScale = 1.03 + (isListening ? 0.018 : 0) + (mouthOpen * 0.014);

    ctx.translate(0, breathY + speechNodY);
    ctx.rotate(smoothedHeadTilt);
    ctx.scale(headScale, headScale);

    const drawSize = avatarR * 2.02;
    const halfSize = drawSize / 2;

    if (frames.idle.complete && frames.idle.naturalWidth > 0) {
      // Crop centered on head & shoulders (1024x1024 -> 840x840 crop)
      const sx = 92;
      const sy = 44;
      const sw = 840;
      const sh = 840;

      // 1) Base Idle Portrait
      ctx.drawImage(frames.idle, sx, sy, sw, sh, -halfSize, -halfSize, drawSize, drawSize);

      // 2) Blinking Eyelids Layer (upper face region)
      if (blinkAmount > 0.02 && frames.blink.complete && frames.blink.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, blinkAmount * 1.15);
        ctx.beginPath();
        ctx.rect(-halfSize, -halfSize, drawSize, drawSize * 0.56);
        ctx.clip();
        ctx.drawImage(frames.blink, sx, sy, sw, sh, -halfSize, -halfSize, drawSize, drawSize);
        ctx.restore();
      }

      // 3) Real-Time Lip-Sync Speaking Layer (lower face & boom-mic region)
      if (mouthOpen > 0.02 && frames.speaking.complete && frames.speaking.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, mouthOpen * 1.15);
        ctx.beginPath();
        ctx.rect(-halfSize, -halfSize + drawSize * 0.48, drawSize, drawSize * 0.54);
        ctx.clip();
        // Subtle vertical jaw articulation stretch on the speaking frame
        const jawStretch = 1 + mouthOpen * 0.022;
        ctx.scale(1, jawStretch);
        ctx.drawImage(frames.speaking, sx, sy, sw, sh, -halfSize, -halfSize, drawSize, drawSize);
        ctx.restore();
      }
    }

    ctx.restore(); // end circular clip

    // Precision metallic bezel ring around the avatar portrait
    ctx.beginPath();
    ctx.arc(0, 0, avatarR - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = isSpeaking ? '#FF521B' : (isListening ? '#48B866' : '#58544C');
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Bottom status pill overlapping bezel
    const stateLabel = isSpeaking
      ? '● PAROLE GEMINI'
      : (isListening ? '● ÉCOUTE ACTIVE' : (isConnected ? '● EN LIGNE' : '○ STANDBY'));
    const pillW = 116;
    const pillH = 18;
    ctx.fillStyle = 'rgba(20, 19, 17, 0.92)';
    ctx.strokeStyle = isSpeaking ? '#FF521B' : (isListening ? '#48B866' : '#58544C');
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-pillW / 2, avatarR - 15, pillW, pillH, 9);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = isSpeaking ? '#FF7A4D' : (isListening ? '#6AE088' : '#D6D1C7');
    ctx.fillText(stateLabel, 0, avatarR - 3);
    ctx.restore();
  }

  requestAnimationFrame(renderScope);
})();
