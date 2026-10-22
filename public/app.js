'use strict';

(function () {
  const VOICES = window.SAMBERT_VOICES || [];
  const LS_KEY = 'sambert.credentials';
  const SAMPLE_TEXT = '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。';

  const $ = (sel) => document.querySelector(sel);

  const els = {
    text: $('#text-input'),
    charCount: $('#char-count'),
    sampleBtn: $('#sample-text-btn'),
    synthBtn: $('#synthesize-btn'),
    message: $('#synthesis-message'),
    voiceList: $('#voice-list'),
    voiceSearch: $('#voice-search'),
    filters: document.querySelectorAll('.filter-chip'),
    rate: $('#rate'),
    pitch: $('#pitch'),
    volume: $('#volume'),
    rateVal: $('#rate-value'),
    pitchVal: $('#pitch-value'),
    volumeVal: $('#volume-value'),
    format: $('#format'),
    sampleRate: $('#sample-rate'),
    player: $('#player'),
    audio: $('#audio-el'),
    playBtn: $('#play-btn'),
    seekTrack: $('#seek-track'),
    seekFill: $('#seek-fill'),
    timeLabel: $('#time-label'),
    billedLabel: $('#billed-label'),
    download: $('#download-link'),
    status: $('#credential-status'),
    banner: $('#missing-key-banner'),
    settingsBtn: $('#open-settings'),
    bannerSettings: $('#banner-settings'),
    backdrop: $('#settings-backdrop'),
    form: $('#settings-form'),
    apiKeyInput: $('#input-api-key'),
    workspaceInput: $('#input-workspace'),
    serverNote: $('#server-config-note'),
    cancelBtn: $('#cancel-settings'),
    clearBtn: $('#clear-settings'),
  };

  const state = {
    voices: VOICES,
    selectedId: 'sambert-zhichu-v1',
    filter: 'all',
    keyword: '',
    server: { apiKeyConfigured: false, workspaceConfigured: false },
    credentials: loadCredentials(),
    currentUrl: null,
    abort: null,
  };

  // ---------------- 凭据 ----------------

  function loadCredentials() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || { apiKey: '', workspaceId: '' };
    } catch {
      return { apiKey: '', workspaceId: '' };
    }
  }

  function saveCredentials(creds) {
    state.credentials = creds;
    localStorage.setItem(LS_KEY, JSON.stringify(creds));
  }

  function credentialMode() {
    if (state.credentials.apiKey) return 'browser';
    if (state.server.apiKeyConfigured) return 'server';
    return 'none';
  }

  function refreshCredentialUi() {
    const mode = credentialMode();
    const label = { server: '服务端凭据已配置', browser: '使用浏览器里的凭据', none: '凭据未配置' }[mode];
    els.status.textContent = label;
    els.status.dataset.mode = mode;
    els.banner.hidden = mode !== 'none';
  }

  // ---------------- 音色列表 ----------------

  function isForeign(voice) {
    return /英[语文]|西班牙|意大利|印尼|法语|德语|泰语/.test(voice.scene);
  }

  function filteredVoices() {
    const kw = state.keyword.trim().toLowerCase();
    return state.voices.filter((v) => {
      if (state.filter === 'f' && v.sex !== 'f') return false;
      if (state.filter === 'm' && v.sex !== 'm') return false;
      if (state.filter === 'child' && v.sex !== 'child') return false;
      if (state.filter === 'foreign' && !isForeign(v)) return false;
      if (state.filter === 'free' && !v.free) return false;
      if (kw) {
        const hay = `${v.name} ${v.tag} ${v.scene} ${v.id}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  function renderVoices() {
    const list = filteredVoices();
    els.voiceList.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'voice-empty';
      empty.textContent = '没有符合条件的音色，换个关键词试试。';
      els.voiceList.appendChild(empty);
      return;
    }
    for (const v of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'voice' + (v.id === state.selectedId ? ' is-selected' : '');
      btn.dataset.id = v.id;

      const row1 = document.createElement('span');
      row1.className = 'voice-row1';
      const name = document.createElement('span');
      name.className = 'voice-name';
      name.textContent = v.name;
      const tag = document.createElement('span');
      tag.className = 'voice-tag';
      tag.textContent = v.tag;
      row1.append(name, tag);

      const row2 = document.createElement('span');
      row2.className = 'voice-row2';
      const model = document.createElement('span');
      model.className = 'voice-model';
      model.textContent = v.id;
      row2.appendChild(model);
      if (v.emo) {
        const badge = document.createElement('span');
        badge.className = 'voice-badge emo';
        badge.textContent = '多情感';
        row2.appendChild(badge);
      }
      if (!v.free) {
        const badge = document.createElement('span');
        badge.className = 'voice-badge free';
        badge.textContent = '付费';
        row2.appendChild(badge);
      }

      btn.append(row1, row2);
      btn.addEventListener('click', () => selectVoice(v));
      els.voiceList.appendChild(btn);
    }
  }

  function selectVoice(v) {
    state.selectedId = v.id;
    els.sampleRate.value = String(v.rate);
    renderVoices();
  }

  function selectedVoice() {
    return state.voices.find((v) => v.id === state.selectedId);
  }

  // ---------------- 合成 ----------------

  function setMessage(text, isError) {
    els.message.textContent = text || '';
    els.message.classList.toggle('is-error', Boolean(isError));
  }

  function setBusy(busy) {
    els.synthBtn.disabled = busy || !els.text.value.trim();
    if (busy) {
      els.synthBtn.classList.add('is-stamping');
      els.synthBtn.querySelector('.seal-label').textContent = '合成中';
      // 重新触发盖章动画
      void els.synthBtn.offsetWidth;
    } else {
      els.synthBtn.classList.remove('is-stamping');
      els.synthBtn.querySelector('.seal-label').textContent = '合成试听';
    }
  }

  async function synthesize() {
    const text = els.text.value.trim();
    if (!text) return;
    if (credentialMode() === 'none') {
      openSettings();
      return;
    }

    if (state.abort) state.abort.abort();
    const controller = new AbortController();
    state.abort = controller;

    resetPlayer();
    setBusy(true);
    setMessage('正在把文稿发给 Sambert…');

    const payload = {
      text,
      model: selectedVoice().id,
      format: els.format.value,
      sample_rate: Number(els.sampleRate.value),
      volume: Number(els.volume.value),
      rate: Number(els.rate.value),
      pitch: Number(els.pitch.value),
    };
    if (state.credentials.apiKey) {
      payload.credentials = {
        apiKey: state.credentials.apiKey,
        workspaceId: state.credentials.workspaceId || '',
      };
    }

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = `合成失败（HTTP ${res.status}）`;
        try {
          const data = await res.json();
          if (data.error && data.error.message) message = data.error.message;
        } catch {}
        throw new Error(message);
      }

      const blob = await res.blob();
      const billed = res.headers.get('x-billed-characters');
      presentAudio(blob, billed);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessage(err.message || '合成失败，请稍后重试。', true);
    } finally {
      if (state.abort === controller) state.abort = null;
      setBusy(false);
    }
  }

  // ---------------- 播放 ----------------

  function resetPlayer() {
    if (state.currentUrl) URL.revokeObjectURL(state.currentUrl);
    state.currentUrl = null;
    els.audio.removeAttribute('src');
    els.player.hidden = true;
    els.billedLabel.textContent = '';
  }

  function presentAudio(blob, billed) {
    const v = selectedVoice();
    const ext = els.format.value === 'pcm' ? 'pcm' : els.format.value;
    const url = URL.createObjectURL(blob);
    state.currentUrl = url;

    els.audio.src = url;
    els.download.href = url;
    els.download.download = `${v.name}-${v.id}.${ext}`;
    els.player.hidden = false;
    els.player.classList.remove('is-playing');
    els.billedLabel.textContent = billed ? `本次计费 ${billed} 字` : '';
    els.seekFill.style.width = '0';
    els.timeLabel.textContent = '0:00 / 0:00';

    if (ext === 'pcm') {
      els.playBtn.disabled = true;
      setMessage('pcm 是无文件头的原始音频，浏览器无法直接试听，可下载后用播放器打开。');
      return;
    }
    els.playBtn.disabled = false;
    setMessage('合成完成，点播放键试听。');
    els.audio.play().catch(() => {});
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function seekToEvent(e) {
    const rect = els.seekTrack.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (Number.isFinite(els.audio.duration)) els.audio.currentTime = ratio * els.audio.duration;
  }

  // ---------------- 设置弹窗 ----------------

  function openSettings() {
    els.apiKeyInput.value = state.credentials.apiKey || '';
    els.workspaceInput.value = state.credentials.workspaceId || '';
    if (state.server.apiKeyConfigured) {
      els.serverNote.hidden = false;
      els.serverNote.textContent = '站点已在服务端配置凭据；这里填写的内容只在本次覆盖服务端配置。';
    } else {
      els.serverNote.hidden = true;
    }
    els.backdrop.hidden = false;
    (state.credentials.apiKey ? els.workspaceInput : els.apiKeyInput).focus();
  }

  function closeSettings() {
    els.backdrop.hidden = true;
  }

  // ---------------- 事件绑定 ----------------

  function bind() {
    els.text.addEventListener('input', () => {
      els.charCount.textContent = `${els.text.value.length} 字`;
      els.synthBtn.disabled = els.text.value.trim() === '';
    });

    els.sampleBtn.addEventListener('click', () => {
      els.text.value = SAMPLE_TEXT;
      els.text.dispatchEvent(new Event('input'));
      els.text.focus();
    });

    els.synthBtn.addEventListener('click', synthesize);

    els.voiceSearch.addEventListener('input', (e) => {
      state.keyword = e.target.value;
      renderVoices();
    });

    els.filters.forEach((chip) => {
      chip.addEventListener('click', () => {
        els.filters.forEach((c) => c.classList.toggle('is-active', c === chip));
        state.filter = chip.dataset.filter;
        renderVoices();
      });
    });

    const bindSlider = (input, out, step) => {
      input.addEventListener('input', () => {
        out.textContent = step < 1 ? Number(input.value).toFixed(2).replace(/0$/, '') : input.value;
      });
    };
    bindSlider(els.rate, els.rateVal, 0.05);
    bindSlider(els.pitch, els.pitchVal, 0.05);
    bindSlider(els.volume, els.volumeVal, 1);

    els.settingsBtn.addEventListener('click', openSettings);
    els.bannerSettings.addEventListener('click', openSettings);
    els.cancelBtn.addEventListener('click', closeSettings);
    els.backdrop.addEventListener('click', (e) => {
      if (e.target === els.backdrop) closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.backdrop.hidden) closeSettings();
    });

    els.clearBtn.addEventListener('click', () => {
      saveCredentials({ apiKey: '', workspaceId: '' });
      els.apiKeyInput.value = '';
      els.workspaceInput.value = '';
      refreshCredentialUi();
      els.apiKeyInput.focus();
    });

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveCredentials({
        apiKey: els.apiKeyInput.value.trim(),
        workspaceId: els.workspaceInput.value.trim(),
      });
      refreshCredentialUi();
      closeSettings();
    });

    els.playBtn.addEventListener('click', () => {
      if (els.audio.paused) els.audio.play();
      else els.audio.pause();
    });
    els.audio.addEventListener('play', () => els.player.classList.add('is-playing'));
    els.audio.addEventListener('pause', () => els.player.classList.remove('is-playing'));
    els.audio.addEventListener('ended', () => els.player.classList.remove('is-playing'));
    els.audio.addEventListener('loadedmetadata', updateProgress);
    els.audio.addEventListener('timeupdate', updateProgress);

    let dragging = false;
    els.seekTrack.addEventListener('pointerdown', (e) => {
      dragging = true;
      els.seekTrack.setPointerCapture(e.pointerId);
      seekToEvent(e);
    });
    els.seekTrack.addEventListener('pointermove', (e) => {
      if (dragging) seekToEvent(e);
    });
    els.seekTrack.addEventListener('pointerup', () => { dragging = false; });
    els.seekTrack.addEventListener('keydown', (e) => {
      const d = els.audio.duration;
      if (!Number.isFinite(d)) return;
      if (e.key === 'ArrowLeft') els.audio.currentTime = Math.max(0, els.audio.currentTime - d * 0.05);
      if (e.key === 'ArrowRight') els.audio.currentTime = Math.min(d, els.audio.currentTime + d * 0.05);
    });
  }

  function updateProgress() {
    const d = els.audio.duration;
    const t = els.audio.currentTime || 0;
    const ratio = Number.isFinite(d) && d > 0 ? t / d : 0;
    els.seekFill.style.width = `${ratio * 100}%`;
    els.seekTrack.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    els.timeLabel.textContent = `${formatTime(t)} / ${formatTime(d)}`;
  }

  // ---------------- 启动 ----------------

  async function init() {
    bind();
    renderVoices();
    els.sampleRate.value = String(selectedVoice().rate);
    els.charCount.textContent = '0 字';
    els.synthBtn.disabled = true;
    refreshCredentialUi();
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      state.server = await res.json();
    } catch {
      state.server = { apiKeyConfigured: false, workspaceConfigured: false };
    }
    refreshCredentialUi();
  }

  init();
})();
