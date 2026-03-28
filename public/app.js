/* ========================================
   PrompterCam — Application Logic
   ======================================== */

(() => {
  'use strict';

  // ── SVG Logo ──
  const logoSVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="17" stroke="#E8C547" stroke-width="1.8"/>
    <circle cx="20" cy="20" r="7" stroke="#E8C547" stroke-width="1.4"/>
    <circle cx="20" cy="20" r="2.5" fill="#E8C547"/>
    <line x1="20" y1="27" x2="20" y2="35" stroke="#E8C547" stroke-width="1.4" opacity="0.5"/>
    <line x1="14" y1="10" x2="26" y2="10" stroke="#E8C547" stroke-width="1" opacity="0.3"/>
    <line x1="15" y1="13" x2="25" y2="13" stroke="#E8C547" stroke-width="1" opacity="0.25"/>
    <line x1="16" y1="16" x2="24" y2="16" stroke="#E8C547" stroke-width="1" opacity="0.2"/>
  </svg>`;

  document.querySelectorAll('.splash-logo, .app-logo-small, #remoteLogo').forEach(el => {
    el.innerHTML = logoSVG;
  });

  // ── State ──
  const state = {
    scripts: [],
    currentScriptId: null,
    settings: {
      speed: 5,
      fontSize: 36,
      fontFamily: 'sans-serif',
      textColor: '#F0F0F2',
      textAlign: 'center',
      lineHeight: 1.6,
      padding: 20,
      mirror: false,
      countdown: 3,
      bgOpacity: 70,
      voiceScroll: false,
      wpm: 150,
    },
    teleprompter: {
      isPlaying: false,
      isRecording: false,
      isPractice: false,
      scrollPosition: 0,
      totalHeight: 0,
      currentSection: 0,
      totalSections: 1,
    },
    camera: {
      stream: null,
      facingMode: 'user',
      showPip: true,
      pipSize: 'small',
      showBg: false,
    },
    recording: {
      mediaRecorder: null,
      chunks: [],
      startTime: 0,
      timerInterval: null,
    },
    takes: [],
    currentTakeIndex: 0,
    voiceRecognition: null,
    remoteBroadcast: null,
    wakeLock: null,
    onboarded: false,
    scrollAnimId: null,
    controlsHideTimeout: null,
  };

  // ── Helpers ──
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function countWords(text) {
    const clean = text.replace(/\[.*?\]/g, '').replace(/---/g, '').trim();
    if (!clean) return 0;
    return clean.split(/\s+/).length;
  }

  function estimateReadTime(text, wpm = 150) {
    const words = countWords(text);
    return Math.ceil(words / wpm);
  }

  function wpmFromSpeed(speed) {
    return Math.round(speed * 30);
  }

  // ── Storage Abstraction ──
  // Uses memory as primary store; syncs to backend API for persistence
  const memStore = {};

  function storeSet(key, value) {
    memStore[key] = value;
    // Fire-and-forget backend sync
    fetch('/api/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).catch(() => {});
  }

  function storeGet(key) {
    return memStore[key] ?? null;
  }

  async function storeLoad() {
    try {
      const res = await fetch('/api/store');
      if (res.ok) {
        const data = await res.json();
        Object.assign(memStore, data);
      }
    } catch(e) {}
  }

  function saveScripts() {
    storeSet('promptercam_scripts', JSON.stringify(state.scripts));
  }

  function loadScripts() {
    try {
      const data = storeGet('promptercam_scripts');
      if (data) state.scripts = JSON.parse(data);
    } catch(e) {}
  }

  function saveSettings() {
    storeSet('promptercam_settings', JSON.stringify(state.settings));
  }

  function loadSettings() {
    try {
      const data = storeGet('promptercam_settings');
      if (data) Object.assign(state.settings, JSON.parse(data));
    } catch(e) {}
  }

  function isOnboarded() {
    return storeGet('promptercam_onboarded') === '1';
  }

  function setOnboarded() {
    storeSet('promptercam_onboarded', '1');
  }

  // ── Sample script ──
  function createSampleScript() {
    return {
      id: generateId(),
      title: 'Copione di esempio',
      body: `Benvenuto in PrompterCam, il tuo teleprompter professionale.

Questo è un copione di esempio per mostrarti come funziona l'app. Il testo scorrerà sullo schermo mentre la fotocamera registra il tuo video.

[PAUSA]

Puoi aggiungere dei marcatori come questo per ricordarti di fare una pausa durante la lettura.

---

Questa è una nuova sezione. I separatori ti aiutano a organizzare il copione in parti logiche.

[SORRIDI]

Ricorda di sorridere e di guardare verso la fotocamera. L'indicatore in alto ti mostra dove si trova l'obiettivo.

[RALLENTA]

Quando vedi il marcatore "rallenta", prova a parlare più lentamente per enfatizzare un concetto importante.

---

PrompterCam ti permette di:
- Regolare la velocità di scorrimento in tempo reale
- Registrare video in alta definizione
- Rivedere e condividere le tue registrazioni

[PAUSA 3]

Prova a modificare questo copione o a crearne uno nuovo toccando il pulsante "+" nella schermata principale.

Buona registrazione!`,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings: null,
    };
  }

  // ── Navigation ──
  function showView(viewId) {
    $$('.view').forEach(v => v.classList.remove('active'));
    const view = $(`#${viewId}`);
    if (view) view.classList.add('active');
  }

  // ── Script List ──
  function renderScripts() {
    const container = $('#scriptList');
    const search = $('#searchScripts').value.toLowerCase();
    const sort = $('#sortScripts').value;

    let scripts = [...state.scripts];

    if (search) {
      scripts = scripts.filter(s =>
        s.title.toLowerCase().includes(search) || s.body.toLowerCase().includes(search)
      );
    }

    switch (sort) {
      case 'title': scripts.sort((a,b) => a.title.localeCompare(b.title)); break;
      case 'created': scripts.sort((a,b) => b.createdAt - a.createdAt); break;
      case 'modified': default: scripts.sort((a,b) => b.modifiedAt - a.modifiedAt); break;
    }

    if (scripts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <h3>${search ? 'Nessun risultato' : 'Nessun copione'}</h3>
          <p>${search ? 'Prova con un\'altra ricerca' : 'Tocca + per creare il tuo primo copione'}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = scripts.map(s => {
      const preview = s.body.replace(/\[.*?\]/g, '').replace(/---/g, '').substring(0, 120);
      const words = countWords(s.body);
      const readTime = estimateReadTime(s.body, state.settings.wpm);
      return `
        <div class="script-card" data-id="${s.id}" data-testid="script-card-${s.id}">
          <div class="script-card-actions">
            <button class="card-action-btn" data-action="duplicate" data-id="${s.id}" title="Duplica">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
            <button class="card-action-btn danger" data-action="delete" data-id="${s.id}" title="Elimina">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
          <div class="script-card-title">${escapeHtml(s.title)}</div>
          <div class="script-card-preview">${escapeHtml(preview)}</div>
          <div class="script-card-meta">
            <span>${words} parole</span>
            <span>~${readTime} min</span>
            <span>${formatDate(s.modifiedAt)}</span>
          </div>
        </div>
      `;
    }).join('');

    // Event delegation
    container.querySelectorAll('.script-card').forEach(card => {
      card.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (btn) {
          e.stopPropagation();
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === 'delete') {
            showConfirm('Elimina copione', 'Sei sicuro di voler eliminare questo copione?', () => {
              state.scripts = state.scripts.filter(s => s.id !== id);
              saveScripts();
              renderScripts();
            });
          } else if (action === 'duplicate') {
            const orig = state.scripts.find(s => s.id === id);
            if (orig) {
              const dup = { ...orig, id: generateId(), title: orig.title + ' (copia)', createdAt: Date.now(), modifiedAt: Date.now() };
              state.scripts.push(dup);
              saveScripts();
              renderScripts();
            }
          }
          return;
        }
        const id = card.dataset.id;
        openScriptEditor(id);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Script Editor ──
  function openScriptEditor(id) {
    let script;
    if (id) {
      script = state.scripts.find(s => s.id === id);
    } else {
      script = { id: generateId(), title: '', body: '', createdAt: Date.now(), modifiedAt: Date.now(), settings: null };
      state.scripts.push(script);
      saveScripts();
    }

    state.currentScriptId = script.id;
    $('#scriptTitle').value = script.title;
    $('#scriptBody').value = script.body;
    updateEditorStats();
    showView('viewEditScript');
  }

  function saveCurrentScript() {
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (!script) return;
    script.title = $('#scriptTitle').value || 'Copione senza titolo';
    script.body = $('#scriptBody').value;
    script.modifiedAt = Date.now();
    saveScripts();
  }

  function updateEditorStats() {
    const text = $('#scriptBody').value;
    const chars = text.length;
    const words = countWords(text);
    const readTime = estimateReadTime(text, state.settings.wpm);
    $('#charCount').textContent = `${chars} caratteri`;
    $('#wordCount').textContent = `${words} parole`;
    $('#readTime').textContent = `~${readTime} min`;
  }

  // ── Settings Panel ──
  function openSettings() {
    $('#settingsPanel').classList.add('open');
    syncSettingsUI();
  }

  function closeSettings() {
    $('#settingsPanel').classList.remove('open');
  }

  function syncSettingsUI() {
    const s = state.settings;
    $('#settingSpeed').value = s.speed;
    $('#speedValue').textContent = `${s.speed} (${wpmFromSpeed(s.speed)} PPM)`;
    $('#settingFontSize').value = s.fontSize;
    $('#fontSizeValue').textContent = `${s.fontSize}px`;
    $('#settingFontFamily').value = s.fontFamily;
    $('#settingLineHeight').value = Math.round(s.lineHeight * 10);
    $('#lineHeightValue').textContent = s.lineHeight.toFixed(1);
    $('#settingPadding').value = s.padding;
    $('#paddingValue').textContent = `${s.padding}px`;
    $('#settingBgOpacity').value = s.bgOpacity;
    $('#bgOpacityValue').textContent = `${s.bgOpacity}%`;

    $$('.color-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === s.textColor);
    });
    $$('.align-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.align === s.textAlign);
    });
    $$('.countdown-opt').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.countdown) === s.countdown);
    });

    $('#settingMirror').classList.toggle('active', s.mirror);
    $('#settingVoiceScroll').classList.toggle('active', s.voiceScroll);
  }

  function bindSettingsEvents() {
    $('#settingSpeed').addEventListener('input', e => {
      state.settings.speed = parseInt(e.target.value);
      $('#speedValue').textContent = `${state.settings.speed} (${wpmFromSpeed(state.settings.speed)} PPM)`;
      saveSettings();
    });

    $('#settingFontSize').addEventListener('input', e => {
      state.settings.fontSize = parseInt(e.target.value);
      $('#fontSizeValue').textContent = `${state.settings.fontSize}px`;
      saveSettings();
    });

    $('#settingFontFamily').addEventListener('change', e => {
      state.settings.fontFamily = e.target.value;
      saveSettings();
    });

    $('#settingLineHeight').addEventListener('input', e => {
      state.settings.lineHeight = parseInt(e.target.value) / 10;
      $('#lineHeightValue').textContent = state.settings.lineHeight.toFixed(1);
      saveSettings();
    });

    $('#settingPadding').addEventListener('input', e => {
      state.settings.padding = parseInt(e.target.value);
      $('#paddingValue').textContent = `${state.settings.padding}px`;
      saveSettings();
    });

    $('#settingBgOpacity').addEventListener('input', e => {
      state.settings.bgOpacity = parseInt(e.target.value);
      $('#bgOpacityValue').textContent = `${state.settings.bgOpacity}%`;
      saveSettings();
      if (state.camera.showBg) {
        $('#cameraBgOverlay').style.background = `rgba(10,10,12,${state.settings.bgOpacity / 100})`;
      }
    });

    $$('.color-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.color-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.textColor = btn.dataset.color;
        saveSettings();
        if ($('#tpText')) {
          $('#tpText').style.color = state.settings.textColor;
        }
      });
    });

    $$('.align-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.align-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.textAlign = btn.dataset.align;
        saveSettings();
        if ($('#tpText')) {
          $('#tpText').style.textAlign = state.settings.textAlign;
        }
      });
    });

    $$('.countdown-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.countdown-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.countdown = parseInt(btn.dataset.countdown);
        saveSettings();
      });
    });

    $('#settingMirror').addEventListener('click', () => {
      state.settings.mirror = !state.settings.mirror;
      $('#settingMirror').classList.toggle('active', state.settings.mirror);
      saveSettings();
      if ($('#tpText')) {
        $('#tpText').classList.toggle('mirror', state.settings.mirror);
      }
    });

    $('#settingVoiceScroll').addEventListener('click', () => {
      state.settings.voiceScroll = !state.settings.voiceScroll;
      $('#settingVoiceScroll').classList.toggle('active', state.settings.voiceScroll);
      saveSettings();
    });

    $('#settingsBackdrop').addEventListener('click', closeSettings);
    $('#btnCloseSettings').addEventListener('click', closeSettings);
  }

  // ── Confirm Dialog ──
  let confirmCallback = null;
  function showConfirm(title, message, onConfirm) {
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    $('#confirmDialog').classList.remove('hidden');
    confirmCallback = onConfirm;
  }

  // ── Camera ──
  async function initCamera() {
    try {
      if (state.camera.stream) {
        state.camera.stream.getTracks().forEach(t => t.stop());
      }
      const constraints = {
        video: {
          facingMode: state.camera.facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
        },
      };
      state.camera.stream = await navigator.mediaDevices.getUserMedia(constraints);
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      showCameraError(err);
      return false;
    }
  }

  function showCameraError(err) {
    let msg = 'Impossibile accedere alla fotocamera.';
    if (err.name === 'NotAllowedError') {
      msg = 'Permesso fotocamera negato. Vai nelle impostazioni del browser e consenti l\'accesso alla fotocamera per questo sito.';
    } else if (err.name === 'NotFoundError') {
      msg = 'Nessuna fotocamera trovata sul dispositivo.';
    }
    showConfirm('Errore Fotocamera', msg, () => {});
  }

  function attachCameraToElements() {
    if (!state.camera.stream) return;
    
    const pipVideo = $('#cameraPipVideo');
    const bgVideo = $('#cameraBackground');
    
    if (pipVideo) pipVideo.srcObject = state.camera.stream;
    if (bgVideo) bgVideo.srcObject = state.camera.stream;
  }

  function stopCamera() {
    if (state.camera.stream) {
      state.camera.stream.getTracks().forEach(t => t.stop());
      state.camera.stream = null;
    }
  }

  // ── Teleprompter ──
  function buildTeleprompterText(body) {
    const sections = body.split('---');
    state.teleprompter.totalSections = sections.length;
    
    let html = '';
    sections.forEach((section, sIdx) => {
      const lines = section.trim().split('\n');
      let paraHtml = '';
      
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
          if (paraHtml) {
            html += `<div class="tp-paragraph" data-section="${sIdx}">${paraHtml}</div>`;
            paraHtml = '';
          }
          return;
        }
        
        // Process cue markers
        const processed = trimmed.replace(/\[(.*?)\]/g, (match, content) => {
          return `<span class="tp-cue" data-cue="${escapeHtml(content)}">[${escapeHtml(content)}]</span>`;
        });
        
        paraHtml += processed + ' ';
      });
      
      if (paraHtml) {
        html += `<div class="tp-paragraph" data-section="${sIdx}">${paraHtml}</div>`;
      }
      
      if (sIdx < sections.length - 1) {
        html += '<hr class="tp-section-break">';
      }
    });
    
    return html;
  }

  async function startTeleprompter(practiceMode = false) {
    saveCurrentScript();
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (!script || !script.body.trim()) return;

    state.teleprompter.isPractice = practiceMode;
    state.teleprompter.isPlaying = false;
    state.teleprompter.isRecording = false;
    state.teleprompter.scrollPosition = 0;
    state.takes = [];
    state.currentTakeIndex = 0;

    // Init camera (even for practice, for PiP preview)
    if (!practiceMode) {
      const cameraOk = await initCamera();
      if (!cameraOk) return;
    } else {
      // Try camera for PiP but don't block if unavailable
      try { await initCamera(); } catch(e) {}
    }

    showView('viewTeleprompter');

    // Setup text
    const tpText = $('#tpText');
    const s = state.settings;
    tpText.innerHTML = buildTeleprompterText(script.body);
    tpText.style.fontSize = s.fontSize + 'px';
    tpText.style.fontFamily = s.fontFamily;
    tpText.style.color = s.textColor;
    tpText.style.textAlign = s.textAlign;
    tpText.style.lineHeight = s.lineHeight;
    tpText.style.padding = `0 ${s.padding}px`;
    tpText.classList.toggle('mirror', s.mirror);

    // Camera setup
    attachCameraToElements();
    updatePipVisibility();
    updateCameraBg();

    // Update speed display
    updateSpeedDisplay();

    // Section indicator
    updateSectionIndicator();

    // Timer display
    updateTimerDisplay();

    // Badges
    if (practiceMode) {
      const badge = $('#tpRecBadge');
      badge.classList.remove('hidden');
      badge.classList.add('practice');
      badge.querySelector('.rec-label').textContent = 'PROVA';
    } else {
      $('#tpRecBadge').classList.add('hidden');
    }

    // Wake lock
    requestWakeLock();

    // Calculate total height after render
    requestAnimationFrame(() => {
      const container = $('#tpScrollContainer');
      state.teleprompter.totalHeight = tpText.scrollHeight - container.clientHeight;
      if (state.teleprompter.totalHeight < 0) state.teleprompter.totalHeight = tpText.scrollHeight;

      // Countdown
      if (s.countdown > 0) {
        startCountdown(s.countdown);
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleTeleprompterKeys);
  }

  function startCountdown(seconds) {
    const overlay = $('#countdownOverlay');
    const number = $('#countdownNumber');
    overlay.classList.remove('hidden');
    let count = seconds;
    number.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(interval);
        overlay.classList.add('hidden');
      } else {
        number.textContent = count;
      }
    }, 1000);
  }

  function updateSpeedDisplay() {
    const s = state.settings.speed;
    const wpm = wpmFromSpeed(s);
    $('#speedLabel').textContent = `${s}x · ${wpm} PPM`;
  }

  function updateSectionIndicator() {
    const indicator = $('#tpSectionIndicator');
    indicator.textContent = `${state.teleprompter.currentSection + 1} di ${state.teleprompter.totalSections}`;
  }

  function updateTimerDisplay() {
    const elapsed = state.teleprompter.isRecording
      ? (Date.now() - state.recording.startTime) / 1000
      : 0;
    
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    const totalWords = script ? countWords(script.body) : 0;
    const wpm = wpmFromSpeed(state.settings.speed);
    const totalSeconds = totalWords / wpm * 60;
    
    const progress = state.teleprompter.totalHeight > 0
      ? state.teleprompter.scrollPosition / state.teleprompter.totalHeight
      : 0;
    
    const remaining = Math.max(0, totalSeconds * (1 - progress));
    
    $('#timerElapsed').textContent = formatTime(elapsed);
    $('#timerRemaining').textContent = formatTime(remaining);
  }

  // ── Scroll Animation ──
  function startScrolling() {
    if (state.teleprompter.isPlaying) return;
    state.teleprompter.isPlaying = true;
    updatePlayPauseIcon();

    let lastTime = performance.now();
    
    function scroll(now) {
      if (!state.teleprompter.isPlaying) return;
      
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      
      // Speed: pixels per second based on speed setting
      const pixelsPerSecond = state.settings.speed * 25;
      state.teleprompter.scrollPosition += pixelsPerSecond * dt;
      
      const container = $('#tpScrollContainer');
      const tpText = $('#tpText');
      
      // Clamp
      const maxScroll = tpText.scrollHeight - container.clientHeight;
      if (state.teleprompter.scrollPosition >= maxScroll) {
        state.teleprompter.scrollPosition = maxScroll;
        state.teleprompter.isPlaying = false;
        updatePlayPauseIcon();
        onScrollFinished();
      }
      
      container.scrollTop = state.teleprompter.scrollPosition;
      
      // Update progress
      const progress = maxScroll > 0 ? state.teleprompter.scrollPosition / maxScroll : 0;
      $('#tpProgressFill').style.width = `${Math.min(100, progress * 100)}%`;
      
      // Update section
      updateCurrentSection();
      
      // Check cue markers
      checkCueMarkers();
      
      // Update timer
      updateTimerDisplay();
      
      // Broadcast to remote
      broadcastState();
      
      if (state.teleprompter.isPlaying) {
        state.scrollAnimId = requestAnimationFrame(scroll);
      }
    }
    
    state.scrollAnimId = requestAnimationFrame(scroll);
  }

  function stopScrolling() {
    state.teleprompter.isPlaying = false;
    if (state.scrollAnimId) {
      cancelAnimationFrame(state.scrollAnimId);
      state.scrollAnimId = null;
    }
    updatePlayPauseIcon();
  }

  function togglePlayPause() {
    if (state.teleprompter.isPlaying) {
      stopScrolling();
    } else {
      startScrolling();
    }
  }

  function updatePlayPauseIcon() {
    const playing = state.teleprompter.isPlaying;
    $('#iconPlay').classList.toggle('hidden', playing);
    $('#iconPause').classList.toggle('hidden', !playing);
  }

  function resetScroll() {
    if (state.teleprompter.isRecording) {
      showConfirm('Riavvia', 'La registrazione è in corso. Vuoi riavviare il copione?', () => {
        doResetScroll();
      });
    } else {
      doResetScroll();
    }
  }

  function doResetScroll() {
    stopScrolling();
    state.teleprompter.scrollPosition = 0;
    $('#tpScrollContainer').scrollTop = 0;
    $('#tpProgressFill').style.width = '0%';
    state.teleprompter.currentSection = 0;
    updateSectionIndicator();
    $('#scrollFinished').classList.add('hidden');
  }

  function onScrollFinished() {
    if (state.teleprompter.isRecording) {
      $('#scrollFinished').classList.remove('hidden');
    }
  }

  function updateCurrentSection() {
    const container = $('#tpScrollContainer');
    const scrollTop = container.scrollTop;
    const guideline = container.clientHeight * 0.35;
    const target = scrollTop + guideline;
    
    const paragraphs = $$('#tpText .tp-paragraph');
    let currentSection = 0;
    
    paragraphs.forEach(p => {
      if (p.offsetTop <= target) {
        currentSection = parseInt(p.dataset.section) || 0;
      }
    });
    
    if (currentSection !== state.teleprompter.currentSection) {
      state.teleprompter.currentSection = currentSection;
      updateSectionIndicator();
    }
  }

  // ── Cue Markers ──
  const shownCues = new Set();
  
  function checkCueMarkers() {
    const container = $('#tpScrollContainer');
    const scrollTop = container.scrollTop;
    const guideline = container.clientHeight * 0.35;
    const target = scrollTop + guideline;
    
    const cues = $$('#tpText .tp-cue');
    cues.forEach(cue => {
      const cueTop = cue.offsetTop;
      const cueId = cue.dataset.cue + '_' + cueTop;
      
      if (Math.abs(cueTop - target) < 30 && !shownCues.has(cueId)) {
        shownCues.add(cueId);
        showCueOverlay(cue.dataset.cue);
        
        // Auto-pause on [PAUSA X]
        const pauseMatch = cue.dataset.cue.match(/PAUSA\s+(\d+)/i);
        if (pauseMatch) {
          const pauseSeconds = parseInt(pauseMatch[1]);
          stopScrolling();
          setTimeout(() => {
            if (!state.teleprompter.isPlaying) {
              startScrolling();
            }
          }, pauseSeconds * 1000);
        } else if (cue.dataset.cue.match(/^PAUSA$/i)) {
          stopScrolling();
          setTimeout(() => {
            if (!state.teleprompter.isPlaying) {
              startScrolling();
            }
          }, 2000);
        }
      }
    });
  }

  function showCueOverlay(text) {
    const overlay = $('#tpCueOverlay');
    overlay.textContent = text;
    overlay.classList.remove('hidden');
    
    // Remove the animation class and re-add
    overlay.style.animation = 'none';
    overlay.offsetHeight; // Force reflow
    overlay.style.animation = '';
    
    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 2000);
  }

  // ── Recording ──
  function startRecording() {
    if (!state.camera.stream) return;
    if (state.teleprompter.isPractice) return;
    
    // Stop voice scroll to avoid mic conflict during recording
    if (state.voiceRecognition) {
      stopVoiceScroll();
    }
    
    state.recording.chunks = [];
    
    // Pick best supported codec — prefer mp4 (Safari/iOS), fallback to webm
    const codecPreference = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
    ];
    let mimeType = '';
    for (const codec of codecPreference) {
      if (MediaRecorder.isTypeSupported(codec)) {
        mimeType = codec;
        break;
      }
    }
    
    const recorderOptions = {
      videoBitsPerSecond: 5000000,  // 5 Mbps video
      audioBitsPerSecond: 128000,   // 128 kbps audio
    };
    if (mimeType) recorderOptions.mimeType = mimeType;
    
    try {
      state.recording.mediaRecorder = new MediaRecorder(state.camera.stream, recorderOptions);
    } catch (e) {
      // Fallback without options if device doesn't support them
      try {
        state.recording.mediaRecorder = new MediaRecorder(state.camera.stream, { mimeType: mimeType || undefined });
      } catch (e2) {
        state.recording.mediaRecorder = new MediaRecorder(state.camera.stream);
      }
    }
    
    state.recording.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.recording.chunks.push(e.data);
      }
    };
    
    state.recording.mediaRecorder.onstop = () => {
      finishRecording();
    };
    
    state.recording.mediaRecorder.start(1000); // 1s chunks for cleaner audio boundaries
    state.recording.startTime = Date.now();
    state.teleprompter.isRecording = true;
    
    // UI updates
    const badge = $('#tpRecBadge');
    badge.classList.remove('hidden', 'practice');
    badge.querySelector('.rec-label').textContent = 'REC';
    
    const recordBtn = $('#btnRecord');
    recordBtn.classList.add('recording');
    
    // Timer
    state.recording.timerInterval = setInterval(() => {
      const elapsed = (Date.now() - state.recording.startTime) / 1000;
      $('#recTimer').textContent = formatTime(elapsed);
      updateTimerDisplay();
    }, 1000);
    
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(100);
  }

  function stopRecording() {
    if (!state.recording.mediaRecorder || state.recording.mediaRecorder.state === 'inactive') return;
    
    state.recording.mediaRecorder.stop();
    state.teleprompter.isRecording = false;
    
    clearInterval(state.recording.timerInterval);
    
    // UI
    $('#tpRecBadge').classList.add('hidden');
    $('#btnRecord').classList.remove('recording');
    $('#scrollFinished').classList.add('hidden');
    
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  }

  function toggleRecording() {
    if (state.teleprompter.isPractice) return;
    
    if (state.teleprompter.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  function finishRecording() {
    const mimeType = state.recording.mediaRecorder?.mimeType || 'video/webm';
    const blob = new Blob(state.recording.chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const duration = (Date.now() - state.recording.startTime) / 1000;
    
    const take = {
      blob,
      url,
      duration,
      size: blob.size,
      timestamp: Date.now(),
      mimeType,
    };
    
    state.takes.push(take);
    state.currentTakeIndex = state.takes.length - 1;
    
    // Switch to review
    showVideoReview();
  }

  // ── Video Review ──
  function showVideoReview() {
    if (state.takes.length === 0) return;
    
    stopScrolling();
    releaseWakeLock();
    document.removeEventListener('keydown', handleTeleprompterKeys);
    
    showView('viewReview');
    
    // Render takes list
    if (state.takes.length > 1) {
      const takesList = $('#takesList');
      takesList.classList.remove('hidden');
      takesList.innerHTML = state.takes.map((t, i) => `
        <div class="take-card ${i === state.currentTakeIndex ? 'active' : ''}" data-index="${i}" data-testid="take-card-${i}">
          <div class="take-card-label">Ripresa ${i + 1}</div>
          <div class="take-card-time">${formatTime(t.duration)}</div>
        </div>
      `).join('');
      
      takesList.querySelectorAll('.take-card').forEach(card => {
        card.addEventListener('click', () => {
          state.currentTakeIndex = parseInt(card.dataset.index);
          loadTakeForReview();
          takesList.querySelectorAll('.take-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        });
      });
    } else {
      $('#takesList').classList.add('hidden');
    }
    
    loadTakeForReview();
  }

  function loadTakeForReview() {
    const take = state.takes[state.currentTakeIndex];
    if (!take) return;
    
    const video = $('#reviewVideo');
    video.src = take.url;
    
    video.onloadedmetadata = () => {
      const dur = video.duration;
      $('#videoDuration').textContent = `Durata: ${formatTime(dur)}`;
      $('#videoSize').textContent = `Dimensione: ${(take.size / (1024 * 1024)).toFixed(1)} MB`;
      
      // Setup trim
      $('#trimStart').max = 100;
      $('#trimEnd').max = 100;
      $('#trimStart').value = 0;
      $('#trimEnd').value = 100;
      $('#trimStartLabel').textContent = '00:00';
      $('#trimEndLabel').textContent = formatTime(dur);
    };
  }

  function downloadVideo() {
    const take = state.takes[state.currentTakeIndex];
    if (!take) return;
    
    const now = new Date();
    const filename = `Teleprompter_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
    const ext = take.mimeType.includes('mp4') ? 'mp4' : 'webm';
    
    // Try Web Share API first (iOS)
    if (navigator.share && navigator.canShare) {
      const file = new File([take.blob], `${filename}.${ext}`, { type: take.mimeType });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(() => {
          // Fallback to download
          triggerDownload(take.blob, `${filename}.${ext}`);
        });
        return;
      }
    }
    
    triggerDownload(take.blob, `${filename}.${ext}`);
  }

  function triggerDownload(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function shareVideo() {
    const take = state.takes[state.currentTakeIndex];
    if (!take) return;
    
    const now = new Date();
    const filename = `Teleprompter_${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
    const ext = take.mimeType.includes('mp4') ? 'mp4' : 'webm';
    
    if (navigator.share) {
      const file = new File([take.blob], `${filename}.${ext}`, { type: take.mimeType });
      navigator.share({
        title: 'PrompterCam Video',
        files: [file],
      }).catch(() => {});
    } else {
      downloadVideo();
    }
  }

  // ── Camera Controls ──
  function updatePipVisibility() {
    const pip = $('#cameraPip');
    if (state.camera.showPip && state.camera.stream) {
      pip.classList.remove('hidden');
      pip.classList.toggle('large', state.camera.pipSize === 'large');
    } else {
      pip.classList.add('hidden');
    }
  }

  function togglePip() {
    if (!state.camera.stream) return;
    
    if (!state.camera.showPip) {
      state.camera.showPip = true;
      state.camera.pipSize = 'small';
    } else if (state.camera.pipSize === 'small') {
      state.camera.pipSize = 'large';
    } else {
      state.camera.showPip = false;
    }
    
    updatePipVisibility();
  }

  function updateCameraBg() {
    const bg = $('#cameraBackground');
    const overlay = $('#cameraBgOverlay');
    
    if (state.camera.showBg && state.camera.stream) {
      bg.classList.remove('hidden');
      overlay.classList.remove('hidden');
      overlay.style.background = `rgba(10,10,12,${state.settings.bgOpacity / 100})`;
    } else {
      bg.classList.add('hidden');
      overlay.classList.add('hidden');
    }
  }

  function toggleCameraBg() {
    state.camera.showBg = !state.camera.showBg;
    updateCameraBg();
  }

  async function switchCamera() {
    state.camera.facingMode = state.camera.facingMode === 'user' ? 'environment' : 'user';
    
    const wasRecording = state.teleprompter.isRecording;
    if (wasRecording) stopRecording();
    
    await initCamera();
    attachCameraToElements();
    
    if (wasRecording) startRecording();
  }

  // ── Wake Lock ──
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        state.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) {}
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      state.wakeLock.release();
      state.wakeLock = null;
    }
  }

  // ── Voice Scroll ──
  function initVoiceScroll() {
    if (!state.settings.voiceScroll) return;
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.voiceRecognition = new SpeechRecognition();
    state.voiceRecognition.continuous = true;
    state.voiceRecognition.interimResults = true;
    state.voiceRecognition.lang = 'it-IT';
    
    state.voiceRecognition.onresult = (event) => {
      // Voice detected — keep scrolling
      if (!state.teleprompter.isPlaying) {
        startScrolling();
      }
    };
    
    state.voiceRecognition.onspeechend = () => {
      // Voice stopped — pause scrolling
      stopScrolling();
    };
    
    state.voiceRecognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        // Expected, restart
        try { state.voiceRecognition.start(); } catch(err) {}
      }
    };
    
    state.voiceRecognition.onend = () => {
      if (state.settings.voiceScroll && $('#viewTeleprompter').classList.contains('active')) {
        try { state.voiceRecognition.start(); } catch(e) {}
      }
    };
    
    try {
      state.voiceRecognition.start();
      $('#voiceIndicator').classList.remove('hidden');
    } catch(e) {}
  }

  function stopVoiceScroll() {
    if (state.voiceRecognition) {
      try { state.voiceRecognition.stop(); } catch(e) {}
      state.voiceRecognition = null;
    }
    $('#voiceIndicator').classList.add('hidden');
  }

  // ── Remote Control ──
  function initRemoteControl() {
    // Use BroadcastChannel for same-origin communication
    try {
      state.remoteBroadcast = new BroadcastChannel('promptercam_remote');
      
      state.remoteBroadcast.onmessage = (event) => {
        const data = event.data;
        if (data.type === 'command') {
          switch (data.action) {
            case 'play': startScrolling(); break;
            case 'pause': stopScrolling(); break;
            case 'toggle': togglePlayPause(); break;
            case 'speedUp': changeSpeed(1); break;
            case 'speedDown': changeSpeed(-1); break;
            case 'reset': doResetScroll(); break;
          }
        } else if (data.type === 'remote_connected') {
          $('#remoteIndicator').classList.remove('hidden');
        }
      };
    } catch(e) {}
  }

  function broadcastState() {
    if (!state.remoteBroadcast) return;
    try {
      state.remoteBroadcast.postMessage({
        type: 'state',
        isPlaying: state.teleprompter.isPlaying,
        speed: state.settings.speed,
        progress: state.teleprompter.totalHeight > 0
          ? state.teleprompter.scrollPosition / state.teleprompter.totalHeight * 100
          : 0,
      });
    } catch(e) {}
  }

  function showRemoteModal() {
    const url = window.location.origin + window.location.pathname + '?remote=1';
    $('#remoteURL').value = url;
    $('#remoteModal').classList.remove('hidden');
    
    // QR code (simple text-based fallback)
    const qrContainer = $('#remoteQR');
    qrContainer.innerHTML = `<div style="text-align:center;padding:20px;color:#0A0A0C;font-size:12px;word-break:break-all;">${url}</div>`;
  }

  function initRemotePage() {
    const page = $('#remoteControlPage');
    page.classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    
    const bc = new BroadcastChannel('promptercam_remote');
    
    // Notify main that remote connected
    bc.postMessage({ type: 'remote_connected' });
    
    bc.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'state') {
        $('#remoteSpeedDisplay').textContent = `${data.speed}x`;
        $('#remoteProgressFill').style.width = `${data.progress}%`;
        $('#remotePosition').textContent = `${Math.round(data.progress)}%`;
        $('#remoteStatus').textContent = data.isPlaying ? 'In riproduzione' : 'In pausa';
      }
    };
    
    $('#remoteBtnPlayPause').addEventListener('click', () => {
      bc.postMessage({ type: 'command', action: 'toggle' });
    });
    $('#remoteBtnSpeedUp').addEventListener('click', () => {
      bc.postMessage({ type: 'command', action: 'speedUp' });
    });
    $('#remoteBtnSpeedDown').addEventListener('click', () => {
      bc.postMessage({ type: 'command', action: 'speedDown' });
    });
    $('#remoteBtnReset').addEventListener('click', () => {
      bc.postMessage({ type: 'command', action: 'reset' });
    });
  }

  // ── Speed Control ──
  function changeSpeed(delta) {
    state.settings.speed = Math.max(1, Math.min(20, state.settings.speed + delta));
    saveSettings();
    updateSpeedDisplay();
    syncSettingsUI();
  }

  // ── Keyboard Shortcuts ──
  function handleTeleprompterKeys(e) {
    switch (e.key) {
      case ' ':
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowUp':
        e.preventDefault();
        changeSpeed(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        changeSpeed(1);
        break;
      case 'r':
      case 'R':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          toggleRecording();
        }
        break;
      case 'Escape':
        e.preventDefault();
        exitTeleprompter();
        break;
      case 'Home':
        e.preventDefault();
        resetScroll();
        break;
    }
  }

  // ── Exit Teleprompter ──
  function exitTeleprompter() {
    if (state.teleprompter.isRecording) {
      showConfirm('Esci dal teleprompter', 'La registrazione è in corso. Vuoi uscire e fermare la registrazione?', () => {
        stopRecording();
        doExitTeleprompter();
      });
    } else {
      doExitTeleprompter();
    }
  }

  function doExitTeleprompter() {
    stopScrolling();
    stopVoiceScroll();
    releaseWakeLock();
    stopCamera();
    shownCues.clear();
    document.removeEventListener('keydown', handleTeleprompterKeys);
    
    if (state.takes.length > 0) {
      showVideoReview();
    } else {
      showView('viewEditScript');
    }
  }

  // ── Touch Zones ──
  function bindTouchZones() {
    let touchStartY = 0;
    let touchStartTime = 0;

    $('#touchLeft').addEventListener('click', () => changeSpeed(-1));
    $('#touchCenter').addEventListener('click', () => togglePlayPause());
    $('#touchRight').addEventListener('click', () => changeSpeed(1));
    
    // Swipe to manual scroll when paused
    const container = $('#tpScrollContainer');
    container.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }, { passive: true });
    
    container.addEventListener('touchmove', (e) => {
      if (state.teleprompter.isPlaying) return;
      
      const deltaY = touchStartY - e.touches[0].clientY;
      touchStartY = e.touches[0].clientY;
      
      state.teleprompter.scrollPosition = Math.max(0, state.teleprompter.scrollPosition + deltaY);
      container.scrollTop = state.teleprompter.scrollPosition;
      
      const maxScroll = $('#tpText').scrollHeight - container.clientHeight;
      const progress = maxScroll > 0 ? state.teleprompter.scrollPosition / maxScroll : 0;
      $('#tpProgressFill').style.width = `${Math.min(100, progress * 100)}%`;
    }, { passive: true });
  }

  // ── Trim ──
  function bindTrimControls() {
    const video = $('#reviewVideo');
    
    $('#trimStart').addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (video.duration) {
        const time = (val / 100) * video.duration;
        video.currentTime = time;
        $('#trimStartLabel').textContent = formatTime(time);
      }
    });
    
    $('#trimEnd').addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      if (video.duration) {
        const time = (val / 100) * video.duration;
        $('#trimEndLabel').textContent = formatTime(time);
      }
    });
  }

  // ── Onboarding ──
  function showOnboarding() {
    const onboarding = $('#onboarding');
    onboarding.classList.remove('hidden');
    let currentSlide = 0;
    
    function goToSlide(idx) {
      $$('.onboarding-slide').forEach(s => s.classList.remove('active'));
      $$('.dot').forEach(d => d.classList.remove('active'));
      const slide = $(`.onboarding-slide[data-slide="${idx}"]`);
      const dot = $(`.dot[data-dot="${idx}"]`);
      if (slide) slide.classList.add('active');
      if (dot) dot.classList.add('active');
      
      if (idx === 2) {
        $('#onboardingNext').textContent = 'Inizia';
      } else {
        $('#onboardingNext').textContent = 'Avanti';
      }
      currentSlide = idx;
    }
    
    $('#onboardingNext').addEventListener('click', () => {
      if (currentSlide < 2) {
        goToSlide(currentSlide + 1);
      } else {
        finishOnboarding();
      }
    });
    
    $('#onboardingSkip').addEventListener('click', finishOnboarding);
    
    $$('.dot').forEach(d => {
      d.addEventListener('click', () => goToSlide(parseInt(d.dataset.dot)));
    });
  }

  function finishOnboarding() {
    setOnboarded();
    $('#onboarding').classList.add('hidden');
    $('#app').classList.remove('hidden');
    
    // Add sample script
    if (state.scripts.length === 0) {
      state.scripts.push(createSampleScript());
      saveScripts();
    }
    renderScripts();
  }

  // ── Initialization ──
  async function init() {
    // Check for remote control mode
    const params = new URLSearchParams(window.location.search);
    if (params.get('remote') === '1') {
      document.getElementById('splash').style.display = 'none';
      initRemotePage();
      return;
    }

    // Load persisted data from backend
    await storeLoad();
    loadScripts();
    loadSettings();

    // Splash → Onboarding or App
    setTimeout(() => {
      $('#splash').style.display = 'none';
      
      if (!isOnboarded()) {
        showOnboarding();
      } else {
        $('#app').classList.remove('hidden');
        if (state.scripts.length === 0) {
          state.scripts.push(createSampleScript());
          saveScripts();
        }
        renderScripts();
      }
    }, 3000);

    // Bind events
    bindNavigationEvents();
    bindEditorEvents();
    bindSettingsEvents();
    bindTeleprompterControls();
    bindReviewEvents();
    bindTouchZones();
    bindTrimControls();
    bindDialogEvents();
  }

  function bindNavigationEvents() {
    $('#btnNewScript').addEventListener('click', () => openScriptEditor(null));
    
    $('#btnBackFromEdit').addEventListener('click', () => {
      saveCurrentScript();
      showView('viewScripts');
      renderScripts();
    });
    
    $('#searchScripts').addEventListener('input', renderScripts);
    $('#sortScripts').addEventListener('change', renderScripts);
    
    $('#btnGlobalSettings').addEventListener('click', openSettings);
  }

  function bindEditorEvents() {
    $('#scriptBody').addEventListener('input', () => {
      updateEditorStats();
      saveCurrentScript();
    });
    
    $('#scriptTitle').addEventListener('input', saveCurrentScript);
    
    // Cue buttons
    $$('.cue-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const textarea = $('#scriptBody');
        const cue = btn.dataset.cue;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.substring(0, start) + cue + text.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + cue.length;
        textarea.focus();
        updateEditorStats();
        saveCurrentScript();
      });
    });
    
    // Import file
    $('#btnImportFile').addEventListener('click', () => {
      $('#fileInput').click();
    });
    
    $('#fileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        $('#scriptBody').value = ev.target.result;
        if (!$('#scriptTitle').value) {
          $('#scriptTitle').value = file.name.replace('.txt', '');
        }
        updateEditorStats();
        saveCurrentScript();
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    
    // Paste from clipboard
    $('#btnPasteClipboard').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const textarea = $('#scriptBody');
        const start = textarea.selectionStart;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(textarea.selectionEnd);
        updateEditorStats();
        saveCurrentScript();
      } catch (e) {
        // Fallback
        $('#scriptBody').focus();
        document.execCommand('paste');
      }
    });
    
    // Script settings
    $('#btnScriptSettings').addEventListener('click', openSettings);
    
    // Start buttons
    $('#btnStartTeleprompter').addEventListener('click', () => startTeleprompter(false));
    $('#btnPractice').addEventListener('click', () => startTeleprompter(true));
  }

  function bindTeleprompterControls() {
    $('#btnPlayPause').addEventListener('click', togglePlayPause);
    $('#btnRecord').addEventListener('click', toggleRecording);
    $('#btnExit').addEventListener('click', exitTeleprompter);
    $('#btnReset').addEventListener('click', resetScroll);
    $('#btnSpeedUp').addEventListener('click', () => changeSpeed(1));
    $('#btnSpeedDown').addEventListener('click', () => changeSpeed(-1));
    $('#btnTogglePip').addEventListener('click', togglePip);
    $('#btnToggleCamBg').addEventListener('click', toggleCameraBg);
    $('#btnSwitchCamera').addEventListener('click', switchCamera);
    $('#btnTpSettings').addEventListener('click', openSettings);
    $('#btnRemoteControl').addEventListener('click', () => {
      showRemoteModal();
      initRemoteControl();
    });
    
    // Scroll finished
    $('#btnStopAfterFinish').addEventListener('click', () => {
      stopRecording();
    });
    $('#btnDismissFinish').addEventListener('click', () => {
      $('#scrollFinished').classList.add('hidden');
    });
  }

  function bindReviewEvents() {
    $('#btnBackFromReview').addEventListener('click', () => {
      // Clean up takes URLs
      state.takes.forEach(t => {
        if (t.url) URL.revokeObjectURL(t.url);
      });
      state.takes = [];
      showView('viewScripts');
      renderScripts();
    });
    
    $('#btnSaveVideo').addEventListener('click', downloadVideo);
    $('#btnShareVideo').addEventListener('click', shareVideo);
    
    $('#btnDeleteTake').addEventListener('click', () => {
      showConfirm('Elimina ripresa', 'Sei sicuro di voler eliminare questa ripresa?', () => {
        const take = state.takes[state.currentTakeIndex];
        if (take?.url) URL.revokeObjectURL(take.url);
        state.takes.splice(state.currentTakeIndex, 1);
        
        if (state.takes.length === 0) {
          showView('viewScripts');
          renderScripts();
        } else {
          state.currentTakeIndex = Math.min(state.currentTakeIndex, state.takes.length - 1);
          showVideoReview();
        }
      });
    });
  }

  function bindDialogEvents() {
    // Confirm dialog
    $('#confirmOk').addEventListener('click', () => {
      $('#confirmDialog').classList.add('hidden');
      if (confirmCallback) confirmCallback();
      confirmCallback = null;
    });
    
    $('#confirmCancel').addEventListener('click', () => {
      $('#confirmDialog').classList.add('hidden');
      confirmCallback = null;
    });
    
    $('#confirmBackdrop').addEventListener('click', () => {
      $('#confirmDialog').classList.add('hidden');
      confirmCallback = null;
    });
    
    // Remote modal
    $('#btnCloseRemote').addEventListener('click', () => {
      $('#remoteModal').classList.add('hidden');
    });
    
    $('#remoteBackdrop').addEventListener('click', () => {
      $('#remoteModal').classList.add('hidden');
    });
    
    $('#btnCopyRemoteURL').addEventListener('click', () => {
      const url = $('#remoteURL').value;
      navigator.clipboard.writeText(url).then(() => {
        $('#btnCopyRemoteURL').textContent = 'Copiato!';
        setTimeout(() => {
          $('#btnCopyRemoteURL').textContent = 'Copia';
        }, 2000);
      });
    });
  }

  // ── Service Worker ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // ── Start ──
  document.addEventListener('DOMContentLoaded', init);

})();
