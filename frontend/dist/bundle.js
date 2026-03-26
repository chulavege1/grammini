"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/modules/media/audio-capture.ts
  var AudioCaptureModule, AudioCapture;
  var init_audio_capture = __esm({
    "src/modules/media/audio-capture.ts"() {
      "use strict";
      AudioCaptureModule = class {
        constructor() {
          this.audioContext = null;
          this.processor = null;
          this.source = null;
          this._micMuted = false;
        }
        /**
         * Set mic mute state (for practice mode - bot won't hear you)
         */
        setMicMute(muted) {
          this._micMuted = muted;
          console.log("[AudioCapture] Mic muted:", muted);
        }
        /**
         * Get mic mute state
         */
        isMicMuted() {
          return this._micMuted;
        }
        /**
         * Start capturing audio from mediaStream
         */
        start(mediaStream, ws, options) {
          if (!mediaStream) {
            console.log("[AudioCapture] No mediaStream available");
            return false;
          }
          const audioTracks = mediaStream.getAudioTracks();
          if (audioTracks.length === 0) {
            console.log("[AudioCapture] No audio tracks in mediaStream");
            return false;
          }
          console.log("[AudioCapture] Starting with track:", audioTracks[0].label);
          try {
            this.audioContext = new AudioContext({ sampleRate: 16e3 });
            if (this.audioContext.state === "suspended") {
              this.audioContext.resume().catch((e) => {
                console.log("[AudioCapture] Resume failed:", e);
              });
            }
            this.source = this.audioContext.createMediaStreamSource(mediaStream);
            this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
            let chunkCount = 0;
            this.processor.onaudioprocess = (e) => {
              if (!options.isConnected()) {
                if (chunkCount === 0)
                  console.log("[AudioCapture] Not connected, skipping");
                return;
              }
              if (!ws || ws.readyState !== WebSocket.OPEN) {
                if (chunkCount === 0)
                  console.log("[AudioCapture] WebSocket not open, skipping");
                return;
              }
              const inputData = e.inputBuffer.getChannelData(0);
              if (options.micLevelEl) {
                if (this._micMuted) {
                  options.micLevelEl.style.width = "0%";
                } else {
                  const level = this.calculateRMS(inputData) * 100;
                  options.micLevelEl.style.width = `${Math.min(level * 3, 100)}%`;
                }
              }
              if (options.isPlaying()) {
                if (chunkCount % 50 === 0)
                  console.log("[AudioCapture] AI speaking, paused");
                return;
              }
              if (this._micMuted) {
                return;
              }
              const pcm16 = this.floatToPCM16(inputData);
              const base64 = this.arrayBufferToBase64(pcm16.buffer);
              ws.send(JSON.stringify({ type: "audio", data: base64 }));
              chunkCount++;
              if (chunkCount <= 3 || chunkCount % 100 === 0) {
                console.log(`[AudioCapture] Sent chunk #${chunkCount}`);
              }
            };
            this.source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            console.log("[AudioCapture] Started successfully");
            return true;
          } catch (e) {
            console.error("[AudioCapture] Failed to start:", e);
            return false;
          }
        }
        /**
         * Stop audio capture and clean up resources
         */
        stop() {
          try {
            this.processor?.disconnect();
            this.source?.disconnect();
            this.audioContext?.close();
          } catch (e) {
            console.log("[AudioCapture] Error stopping:", e);
          }
          this.processor = null;
          this.source = null;
          this.audioContext = null;
          console.log("[AudioCapture] Stopped");
        }
        /**
         * Calculate RMS level (optimized with SIMD-friendly loop)
         */
        calculateRMS(data) {
          let sum = 0;
          const len = data.length;
          for (let i = 0; i < len; i += 4) {
            sum += data[i] * data[i];
            if (i + 1 < len)
              sum += data[i + 1] * data[i + 1];
            if (i + 2 < len)
              sum += data[i + 2] * data[i + 2];
            if (i + 3 < len)
              sum += data[i + 3] * data[i + 3];
          }
          return Math.sqrt(sum / len);
        }
        /**
         * Convert Float32 to Int16 PCM (optimized)
         */
        floatToPCM16(input) {
          const output = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            output[i] = Math.max(-32768, Math.min(32767, input[i] * 32767 | 0));
          }
          return output;
        }
        /**
         * Convert ArrayBuffer to Base64 (optimized chunked approach)
         */
        arrayBufferToBase64(buffer) {
          const bytes = new Uint8Array(buffer);
          const CHUNK_SIZE = 8192;
          let binary = "";
          for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.subarray(i, i + CHUNK_SIZE);
            binary += String.fromCharCode(...chunk);
          }
          return btoa(binary);
        }
      };
      AudioCapture = new AudioCaptureModule();
      if (typeof window !== "undefined") {
        window.AudioCapture = AudioCapture;
      }
      console.log("[AudioCapture] Module loaded (TS)");
    }
  });

  // src/modules/media/audio-playback.ts
  var AudioPlaybackModule, AudioPlayback, resumeHandler;
  var init_audio_playback = __esm({
    "src/modules/media/audio-playback.ts"() {
      "use strict";
      AudioPlaybackModule = class {
        constructor() {
          this.context = null;
          this.gainNode = null;
          this.scheduledEndTime = 0;
          this.MIN_BUFFER_TIME = 0.1;
          // Load from localStorage if available, otherwise default to 1.0 (100%)
          this._volume = localStorage.getItem("app_volume") ? parseInt(localStorage.getItem("app_volume"), 10) / 100 : 1;
          this._muted = false;
          this._playbackRate = 1;
          // Reusable typed arrays for performance
          this.floatBuffer = null;
          // Tracking for karaoke sync
          this.chunksPlayed = 0;
          this.totalAudioDurationMs = 0;
          // Track active audio sources (kept for potential future use)
          this.activeSources = [];
        }
        /**
         * Set volume (0.0 - 1.0)
         */
        setVolume(volume) {
          this._volume = Math.max(0, Math.min(1, volume));
          if (this.gainNode) {
            this.gainNode.gain.value = this._muted ? 0 : this._volume;
          }
        }
        /**
         * Set mute state
         */
        setMute(muted) {
          this._muted = muted;
          if (this.gainNode) {
            this.gainNode.gain.value = this._muted ? 0 : this._volume;
          }
        }
        /**
         * Set playback rate (0.5 - 2.0)
         * Rate applies to NEW audio chunks only (changing mid-playback causes audio glitches)
         */
        setPlaybackRate(rate) {
          const newRate = Math.max(0.5, Math.min(2, rate));
          console.log("[AudioPlayback] setPlaybackRate:", rate, "-> clamped to:", newRate);
          this._playbackRate = newRate;
        }
        /**
         * Get current playback rate
         */
        getPlaybackRate() {
          return this._playbackRate;
        }
        /**
         * Play audio chunk from base64 PCM16 data
         */
        playChunk(base64Audio) {
          try {
            const bytes = this.base64ToUint8Array(base64Audio);
            const samples = this.pcm16ToFloat32(bytes);
            const ctx = this.getContext();
            if (!ctx)
              return;
            const buffer = ctx.createBuffer(1, samples.length, 24e3);
            buffer.getChannelData(0).set(samples);
            const currentTime = ctx.currentTime;
            const startTime = Math.max(currentTime + this.MIN_BUFFER_TIME, this.scheduledEndTime);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = this._playbackRate;
            if (this.gainNode) {
              source.connect(this.gainNode);
            } else {
              source.connect(ctx.destination);
            }
            const adjustedDuration = buffer.duration / this._playbackRate;
            this.scheduledEndTime = startTime + adjustedDuration;
            source.start(startTime);
            this.activeSources.push(source);
            this.chunksPlayed++;
            this.totalAudioDurationMs += adjustedDuration * 1e3;
            source.onended = () => {
              const idx = this.activeSources.indexOf(source);
              if (idx > -1) {
                this.activeSources.splice(idx, 1);
              }
            };
          } catch (e) {
            console.error("[AudioPlayback] Error:", e);
          }
        }
        /**
         * Get or create audio context
         */
        getContext() {
          if (!this.context || this.context.state === "closed") {
            try {
              this.context = new AudioContext({ sampleRate: 24e3 });
              this.gainNode = this.context.createGain();
              this.gainNode.gain.value = this._muted ? 0 : this._volume;
              this.gainNode.connect(this.context.destination);
              this.scheduledEndTime = 0;
            } catch (e) {
              console.error("[AudioPlayback] Failed to create AudioContext:", e);
              return null;
            }
          }
          if (this.context.state === "suspended") {
            this.context.resume().catch(() => {
            });
          }
          return this.context;
        }
        /**
         * Optimized Base64 decode using atob + typed array
         */
        base64ToUint8Array(base64) {
          const binaryString = atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i += 4) {
            bytes[i] = binaryString.charCodeAt(i);
            if (i + 1 < len)
              bytes[i + 1] = binaryString.charCodeAt(i + 1);
            if (i + 2 < len)
              bytes[i + 2] = binaryString.charCodeAt(i + 2);
            if (i + 3 < len)
              bytes[i + 3] = binaryString.charCodeAt(i + 3);
          }
          return bytes;
        }
        /**
         * Optimized PCM16 to Float32 conversion
         */
        pcm16ToFloat32(bytes) {
          const numSamples = bytes.length >> 1;
          if (!this.floatBuffer || this.floatBuffer.length !== numSamples) {
            this.floatBuffer = new Float32Array(numSamples);
          }
          const view = new DataView(bytes.buffer);
          const scale = 1 / 32768;
          for (let i = 0; i < numSamples; i++) {
            this.floatBuffer[i] = view.getInt16(i << 1, true) * scale;
          }
          return this.floatBuffer;
        }
        reset() {
          this.scheduledEndTime = 0;
          this.chunksPlayed = 0;
          this.totalAudioDurationMs = 0;
        }
        /**
         * Skip/interrupt current playback without destroying AudioContext.
         * Cancels all scheduled audio sources so mic can work immediately.
         * AudioContext stays alive for future audio from Gemini.
         */
        skipPlayback() {
          console.log("[AudioPlayback] Skipping current playback, canceling", this.activeSources.length, "sources");
          for (const source of this.activeSources) {
            try {
              source.stop();
            } catch (e) {
            }
          }
          this.activeSources = [];
          this.scheduledEndTime = 0;
          this.chunksPlayed = 0;
          this.totalAudioDurationMs = 0;
          console.log("[AudioPlayback] Playback skipped \u2014 mic should work now");
        }
        stop() {
          this.skipPlayback();
          try {
            if (this.context && this.context.state !== "closed") {
              this.context.close();
            }
          } catch (e) {
            console.log("[AudioPlayback] Error stopping:", e);
          }
          this.context = null;
          this.gainNode = null;
          this.floatBuffer = null;
        }
        /**
         * Get current audio buffer delay in milliseconds
         * (how far ahead audio is scheduled)
         */
        getAudioDelay() {
          if (!this.context)
            return 0;
          const delay = Math.max(0, this.scheduledEndTime - this.context.currentTime);
          return delay * 1e3;
        }
        getIsPlaying() {
          if (!this.context)
            return false;
          return this.context.currentTime < this.scheduledEndTime + 0.05;
        }
      };
      AudioPlayback = new AudioPlaybackModule();
      resumeHandler = () => {
        const ctx = AudioPlayback.context;
        if (ctx && ctx.state === "suspended") {
          ctx.resume().catch(() => {
          });
        }
      };
      ["touchstart", "touchend", "click", "keydown"].forEach((type) => {
        document.addEventListener(type, resumeHandler, { once: false, passive: true });
      });
      if (typeof window !== "undefined") {
        window.AudioPlayback = AudioPlayback;
      }
      console.log("[AudioPlayback] Module loaded (TS)");
    }
  });

  // src/modules/media/screen-capture.ts
  var ScreenCaptureModule, ScreenCapture;
  var init_screen_capture = __esm({
    "src/modules/media/screen-capture.ts"() {
      "use strict";
      ScreenCaptureModule = class {
        constructor() {
          this.captureInterval = null;
          this.lastScreenshot = null;
          this.canvas = null;
          this.ctx = null;
        }
        /**
         * Start capturing frames from video element
         */
        start(videoElement, ws, options) {
          if (!videoElement?.srcObject) {
            console.log("[ScreenCapture] No video source");
            return false;
          }
          this.canvas = document.createElement("canvas");
          this.ctx = this.canvas.getContext("2d", { alpha: false });
          const interval = options.interval ?? 1e3;
          this.captureInterval = window.setInterval(() => {
            if (!options.isConnected() || !ws || !videoElement.videoWidth)
              return;
            this.canvas.width = Math.min(videoElement.videoWidth, 1280);
            this.canvas.height = Math.min(videoElement.videoHeight, 960);
            this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
            const dataUrl = this.canvas.toDataURL("image/jpeg", 0.85);
            const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
            this.lastScreenshot = dataUrl;
            ws.send(JSON.stringify({ type: "image", data: base64 }));
          }, interval);
          console.log("[ScreenCapture] Started");
          return true;
        }
        stop() {
          if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
          }
          this.canvas = null;
          this.ctx = null;
          console.log("[ScreenCapture] Stopped");
        }
        getLastScreenshot() {
          return this.lastScreenshot;
        }
        openFullscreen(src) {
          let lightbox = document.getElementById("screenshot-lightbox");
          if (!lightbox) {
            lightbox = document.createElement("div");
            lightbox.id = "screenshot-lightbox";
            lightbox.className = "screenshot-lightbox";
            lightbox.innerHTML = `
                <div class="lightbox-content">
                    <img class="lightbox-img" />
                    <button class="lightbox-close">\u2715</button>
                </div>
            `;
            lightbox.addEventListener("click", (e) => {
              const target = e.target;
              if (target === lightbox || target.classList.contains("lightbox-close")) {
                lightbox.classList.remove("active");
              }
            });
            document.body.appendChild(lightbox);
          }
          lightbox.querySelector(".lightbox-img").src = src;
          lightbox.classList.add("active");
        }
      };
      ScreenCapture = new ScreenCaptureModule();
      document.addEventListener("click", (e) => {
        const target = e.target;
        if (target.classList.contains("context-img")) {
          ScreenCapture.openFullscreen(target.src);
        }
      });
      if (typeof window !== "undefined") {
        window.ScreenCapture = ScreenCapture;
        window.openScreenshotFullscreen = (src) => ScreenCapture.openFullscreen(src);
      }
      console.log("[ScreenCapture] Module loaded (TS)");
    }
  });

  // src/modules/core/state.ts
  var state_exports = {};
  __export(state_exports, {
    addAttachment: () => addAttachment,
    addToHistory: () => addToHistory,
    appendToLastModelHistory: () => appendToLastModelHistory,
    clearAttachments: () => clearAttachments,
    clearHistory: () => clearHistory,
    getState: () => getState,
    setConnected: () => setConnected,
    setPlaying: () => setPlaying,
    setState: () => setState,
    setWebSocket: () => setWebSocket,
    updateLastModelHistoryText: () => updateLastModelHistoryText
  });
  function getState() {
    return state;
  }
  function setState(updates) {
    state = { ...state, ...updates };
  }
  function setConnected(connected) {
    state.isConnected = connected;
  }
  function setPlaying(playing) {
    state.isPlaying = playing;
  }
  function setWebSocket(ws) {
    state.ws = ws;
  }
  function addToHistory(message) {
    state.conversationHistory.push(message);
  }
  function appendToLastModelHistory(text) {
    for (let i = state.conversationHistory.length - 1; i >= 0; i--) {
      if (state.conversationHistory[i].role === "model") {
        const msg = state.conversationHistory[i];
        if (msg.parts && msg.parts.length > 0) {
          msg.parts[0].text += "\n\n" + text;
        } else if (msg.text !== void 0) {
          msg.text += "\n\n" + text;
        } else {
          msg.text = text;
        }
        break;
      }
    }
  }
  function updateLastModelHistoryText(text) {
    for (let i = state.conversationHistory.length - 1; i >= 0; i--) {
      if (state.conversationHistory[i].role === "model") {
        const msg = state.conversationHistory[i];
        if (msg.parts && msg.parts.length > 0) {
          msg.parts[0].text = text;
        } else {
          msg.text = text;
        }
        break;
      }
    }
  }
  function clearHistory() {
    state.conversationHistory = [];
  }
  function addAttachment(attachment) {
    state.pendingAttachments.push(attachment);
  }
  function clearAttachments() {
    state.pendingAttachments = [];
  }
  var state;
  var init_state = __esm({
    "src/modules/core/state.ts"() {
      "use strict";
      state = {
        ws: null,
        isConnected: false,
        isPlaying: false,
        mediaStream: null,
        currentChatId: "",
        conversationHistory: [],
        pendingAttachments: [],
        lastUserInput: "",
        currentFacingMode: "user",
        keepaliveInterval: null
      };
    }
  });

  // src/modules/core/elements.ts
  function initElements() {
    return {
      // Input
      textInput: document.getElementById("text-input"),
      sendBtn: document.getElementById("send-btn"),
      attachBtn: document.getElementById("attach-btn"),
      fileInput: document.getElementById("file-input"),
      // Controls
      saveBtn: document.getElementById("save-btn"),
      newChatBtn: document.getElementById("new-chat-btn"),
      stopBtn: document.getElementById("stop-btn"),
      // Video
      videoSection: document.getElementById("video-section"),
      videoPreview: document.getElementById("video-preview"),
      videoPlaceholder: document.getElementById("video-placeholder"),
      cameraToggle: document.getElementById("camera-toggle"),
      // Status
      statusText: document.getElementById("status-text"),
      statusDot: document.getElementById("status-dot"),
      micLevel: document.getElementById("mic-level-bar"),
      stopRow: document.getElementById("stop-row"),
      // Settings
      themeSelect: document.getElementById("theme-select"),
      languageLevel: document.getElementById("language-level"),
      voiceSelect: document.getElementById("voice-select"),
      // Chat
      chatList: document.getElementById("chat-list"),
      chatContainer: document.getElementById("chat-messages"),
      contextMenu: document.getElementById("context-menu"),
      // Progress
      progressWidget: document.getElementById("progress-widget")
    };
  }
  function getElements() {
    if (!elements) {
      elements = initElements();
    }
    return elements;
  }
  var elements;
  var init_elements = __esm({
    "src/modules/core/elements.ts"() {
      "use strict";
    }
  });

  // src/modules/chat/chat-sessions.ts
  function getSessions() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }
  function saveSessions(sessions) {
    try {
      const trimmed = sessions.slice(0, MAX_SESSIONS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.error("[ChatSessions] Failed to save:", e);
    }
  }
  function getCurrentChatId() {
    return localStorage.getItem(CURRENT_CHAT_KEY) || "";
  }
  function setCurrentChatId(id) {
    localStorage.setItem(CURRENT_CHAT_KEY, id);
  }
  function getSession(id) {
    return getSessions().find((s) => s.id === id);
  }
  function saveSession(id, preview, language, mode, level) {
    const sessions = getSessions();
    const now = Date.now();
    const existing = sessions.find((s) => s.id === id);
    if (existing) {
      existing.lastMessageAt = now;
      existing.preview = preview.substring(0, 60);
      const index = sessions.indexOf(existing);
      sessions.splice(index, 1);
      sessions.unshift(existing);
    } else {
      const title = new Date(now).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
      sessions.unshift({
        id,
        title,
        createdAt: now,
        lastMessageAt: now,
        preview: preview.substring(0, 60),
        messages: [],
        language: language || void 0,
        mode: mode || void 0,
        level: level || void 0
      });
    }
    saveSessions(sessions);
    setCurrentChatId(id);
    renderSessionList();
  }
  function saveMessage(chatId, role, text) {
    const sessions = getSessions();
    let session = sessions.find((s) => s.id === chatId);
    if (!session) {
      const now = Date.now();
      session = {
        id: chatId,
        title: new Date(now).toLocaleString("ru-RU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        }),
        createdAt: now,
        lastMessageAt: now,
        preview: text.substring(0, 60),
        messages: []
      };
      sessions.unshift(session);
    }
    session.messages.push({
      role,
      text,
      timestamp: Date.now()
    });
    if (role !== "system") {
      session.preview = text.substring(0, 60);
      session.lastMessageAt = Date.now();
    }
    if (session.messages.length > 100) {
      session.messages = session.messages.slice(-100);
    }
    saveSessions(sessions);
    renderSessionList();
  }
  function removeLastMessage(chatId) {
    const sessions = getSessions();
    const session = sessions.find((s) => s.id === chatId);
    if (!session || session.messages.length === 0)
      return;
    session.messages.pop();
    if (session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      session.preview = lastMsg.text.substring(0, 60);
    } else {
      session.preview = "No messages";
    }
    saveSessions(sessions);
  }
  function updateLastAiMessageText(chatId, newText) {
    const sessions = getSessions();
    const session = sessions.find((s) => s.id === chatId);
    if (!session || session.messages.length === 0)
      return;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === "ai") {
        session.messages[i].text = newText;
        session.preview = session.messages[i].text.substring(0, 60);
        saveSessions(sessions);
        renderSessionList();
        break;
      }
    }
  }
  function getMessages(chatId) {
    const session = getSession(chatId);
    return session?.messages || [];
  }
  function deleteSession(id) {
    const sessions = getSessions().filter((s) => s.id !== id);
    saveSessions(sessions);
    if (getCurrentChatId() === id) {
      setCurrentChatId("");
    }
    renderSessionList();
  }
  function renderSessionList() {
    const container2 = document.getElementById("history-list");
    if (!container2)
      return;
    const sessions = getSessions();
    const currentId = getCurrentChatId();
    if (sessions.length === 0) {
      container2.innerHTML = '<div class="empty-history">No chats yet</div>';
      return;
    }
    container2.innerHTML = sessions.map((session) => {
      const langFlag = session.language ? LANGUAGE_FLAGS[session.language] || "" : "";
      const langName = session.language || "";
      const modeIcon = session.mode === "active" ? "\u{1F3AD}" : session.mode === "grammar" ? "\u{1F4DA}" : "\u{1F4D6}";
      const levelStr = session.level || "";
      const dateStr = formatRelativeDate(session.lastMessageAt || session.createdAt);
      const infoLine = [
        langFlag && langName ? `${langFlag} ${langName}` : "",
        levelStr ? `${levelStr} ${modeIcon}` : "",
        dateStr
      ].filter(Boolean).join(" \u2022 ");
      const rawPreview = session.preview || "No messages";
      const cleanPreview = rawPreview.replace(/<[^>]*>?/gm, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").substring(0, 60);
      return `
        <div class="history-item ${session.id === currentId ? "active" : ""}" data-id="${session.id}">
            <div class="history-item-content">
                <div class="history-item-title">${session.title}</div>
                <div class="history-item-meta">${infoLine}</div>
                <div class="history-item-preview">${cleanPreview}</div>
            </div>
            <div class="history-item-actions">
                <button class="history-item-edit" title="Rename" data-id="${session.id}">\u270F\uFE0F</button>
                <button class="history-item-delete" title="Delete" data-id="${session.id}">\xD7</button>
            </div>
        </div>
    `;
    }).join("");
    container2.querySelectorAll(".history-item").forEach((item) => {
      item.querySelector(".history-item-edit")?.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const id = e.target.dataset.id;
        if (id)
          showRenameDialog(id);
      });
      item.querySelector(".history-item-delete")?.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const id = e.target.dataset.id;
        if (id)
          showDeleteConfirmation(id, e.target);
      });
      item.addEventListener("click", (e) => {
        const target = e.target;
        if (!target.classList.contains("history-item-delete") && !target.classList.contains("history-item-edit")) {
          const id = item.dataset.id;
          if (id)
            loadSession(id);
        }
      });
    });
  }
  function showDeleteConfirmation(id, _button) {
    const existing = document.querySelector(".delete-confirm-modal");
    if (existing)
      existing.remove();
    const modal = document.createElement("div");
    modal.className = "delete-confirm-modal";
    modal.innerHTML = `
        <div class="delete-confirm-content">
            <p>\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E\u0442 \u0447\u0430\u0442?</p>
            <div class="delete-confirm-buttons">
                <button class="confirm-yes">\u0414\u0430</button>
                <button class="confirm-no">\u041D\u0435\u0442</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (!document.getElementById("delete-confirm-style")) {
      const style = document.createElement("style");
      style.id = "delete-confirm-style";
      style.textContent = `
            .delete-confirm-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            }
            .delete-confirm-content {
                background: var(--surface-color, #1e1e2e);
                padding: 20px 30px;
                border-radius: 12px;
                text-align: center;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            }
            .delete-confirm-content p {
                margin: 0 0 15px 0;
                font-size: 16px;
                color: var(--text-color, #fff);
            }
            .delete-confirm-buttons {
                display: flex;
                gap: 10px;
                justify-content: center;
            }
            .delete-confirm-buttons button {
                padding: 8px 24px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: opacity 0.2s;
            }
            .delete-confirm-buttons button:hover {
                opacity: 0.8;
            }
            .confirm-yes {
                background: #e74c3c;
                color: white;
            }
            .confirm-no {
                background: #555;
                color: white;
            }
        `;
      document.head.appendChild(style);
    }
    modal.querySelector(".confirm-yes")?.addEventListener("click", () => {
      deleteSession(id);
      modal.remove();
    });
    modal.querySelector(".confirm-no")?.addEventListener("click", () => {
      modal.remove();
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal)
        modal.remove();
    });
  }
  function renameSession(id, newTitle) {
    const sessions = getSessions();
    const session = sessions.find((s) => s.id === id);
    if (session) {
      session.title = newTitle.trim() || session.title;
      saveSessions(sessions);
      renderSessionList();
    }
  }
  function showRenameDialog(id) {
    const session = getSession(id);
    if (!session)
      return;
    const existing = document.querySelector(".rename-modal");
    if (existing)
      existing.remove();
    const modal = document.createElement("div");
    modal.className = "rename-modal";
    modal.innerHTML = `
        <div class="rename-modal-content">
            <p>\u041F\u0435\u0440\u0435\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u0442\u044C \u0447\u0430\u0442</p>
            <input type="text" class="rename-input" value="${session.title}" placeholder="\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0447\u0430\u0442\u0430" />
            <div class="rename-buttons">
                <button class="rename-save">\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C</button>
                <button class="rename-cancel">\u041E\u0442\u043C\u0435\u043D\u0430</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (!document.getElementById("rename-modal-style")) {
      const style = document.createElement("style");
      style.id = "rename-modal-style";
      style.textContent = `
            .rename-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            }
            .rename-modal-content {
                background: var(--surface-color, #1e1e2e);
                padding: 24px;
                border-radius: 12px;
                min-width: 300px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            }
            .rename-modal-content p {
                margin: 0 0 15px 0;
                font-size: 16px;
                color: var(--text-color, #fff);
                font-weight: 600;
            }
            .rename-input {
                width: 100%;
                padding: 10px 12px;
                border: 1px solid #444;
                border-radius: 8px;
                background: #2a2a3a;
                color: #fff;
                font-size: 14px;
                box-sizing: border-box;
                margin-bottom: 15px;
            }
            .rename-input:focus {
                outline: none;
                border-color: var(--accent, #6366f1);
            }
            .rename-buttons {
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            .rename-buttons button {
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                transition: opacity 0.2s;
            }
            .rename-save {
                background: var(--accent, #6366f1);
                color: white;
            }
            .rename-cancel {
                background: #555;
                color: white;
            }
            .rename-buttons button:hover {
                opacity: 0.85;
            }
        `;
      document.head.appendChild(style);
    }
    const input = modal.querySelector(".rename-input");
    input?.focus();
    input?.select();
    modal.querySelector(".rename-save")?.addEventListener("click", () => {
      const newTitle = input.value.trim();
      if (newTitle) {
        renameSession(id, newTitle);
      }
      modal.remove();
    });
    modal.querySelector(".rename-cancel")?.addEventListener("click", () => {
      modal.remove();
    });
    input?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        const newTitle = input.value.trim();
        if (newTitle) {
          renameSession(id, newTitle);
        }
        modal.remove();
      }
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal)
        modal.remove();
    });
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape")
        modal.remove();
    });
  }
  function loadSession(id) {
    console.log("[ChatSessions] Loading session:", id);
    setCurrentChatId(id);
    document.querySelectorAll(".history-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.id === id);
    });
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer)
      return;
    chatContainer.innerHTML = "";
    const messages = getMessages(id);
    console.log("[ChatSessions] Loading", messages.length, "messages");
    messages.forEach((msg) => {
      const msgDiv = document.createElement("div");
      msgDiv.className = `message ${msg.role}`;
      const bubbleDiv = document.createElement("div");
      bubbleDiv.className = msg.role === "ai" ? "message-bubble karaoke-text" : "message-bubble";
      if (msg.role === "ai" && typeof window.Vocabulary?.formatMessage === "function") {
        const rawText = msg.text.replace(/<[^>]*>/g, "").trim();
        if (rawText.includes("REPLICA") || rawText.includes("\u0413\u0440\u0430\u043C\u043C\u0438\u043D\u0438") || !msg.text.includes("dialogue-block")) {
          bubbleDiv.innerHTML = window.Vocabulary.formatMessage(msg.text);
        } else {
          bubbleDiv.innerHTML = msg.text;
        }
      } else {
        bubbleDiv.innerHTML = msg.text;
      }
      msgDiv.appendChild(bubbleDiv);
      const timeDiv = document.createElement("div");
      timeDiv.className = "message-time";
      timeDiv.textContent = new Date(msg.timestamp).toLocaleTimeString();
      msgDiv.appendChild(timeDiv);
      chatContainer.appendChild(msgDiv);
    });
    if (window.AppState) {
      window.AppState.setState({ currentChatId: id });
    }
  }
  function initChatSessions() {
    renderSessionList();
    const currentId = getCurrentChatId();
    if (currentId) {
      const session = getSession(currentId);
      if (session) {
        loadSession(currentId);
      }
    }
    console.log("[ChatSessions] Initialized with", getSessions().length, "sessions");
  }
  function formatRelativeDate(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const day = 864e5;
    if (diff < day) {
      return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (diff < 2 * day) {
      return "Yesterday";
    } else if (diff < 7 * day) {
      return new Date(timestamp).toLocaleDateString([], { weekday: "short" });
    } else {
      return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
    }
  }
  function findSessionByLanguage(language) {
    return getSessions().find((s) => s.language === language);
  }
  var STORAGE_KEY, CURRENT_CHAT_KEY, MAX_SESSIONS, LANGUAGE_FLAGS;
  var init_chat_sessions = __esm({
    "src/modules/chat/chat-sessions.ts"() {
      "use strict";
      STORAGE_KEY = "gemini_chat_sessions";
      CURRENT_CHAT_KEY = "gemini_current_chat_id";
      MAX_SESSIONS = 50;
      LANGUAGE_FLAGS = {
        German: "\u{1F1E9}\u{1F1EA}",
        English: "\u{1F1EC}\u{1F1E7}",
        Spanish: "\u{1F1EA}\u{1F1F8}",
        French: "\u{1F1EB}\u{1F1F7}",
        Italian: "\u{1F1EE}\u{1F1F9}",
        Portuguese: "\u{1F1F5}\u{1F1F9}",
        Russian: "\u{1F1F7}\u{1F1FA}",
        Ukrainian: "\u{1F1FA}\u{1F1E6}",
        Polish: "\u{1F1F5}\u{1F1F1}",
        Czech: "\u{1F1E8}\u{1F1FF}",
        Dutch: "\u{1F1F3}\u{1F1F1}",
        Swedish: "\u{1F1F8}\u{1F1EA}",
        Norwegian: "\u{1F1F3}\u{1F1F4}",
        Danish: "\u{1F1E9}\u{1F1F0}",
        Finnish: "\u{1F1EB}\u{1F1EE}",
        Greek: "\u{1F1EC}\u{1F1F7}",
        Turkish: "\u{1F1F9}\u{1F1F7}",
        Arabic: "\u{1F1F8}\u{1F1E6}",
        Hebrew: "\u{1F1EE}\u{1F1F1}",
        Persian: "\u{1F1EE}\u{1F1F7}",
        Hindi: "\u{1F1EE}\u{1F1F3}",
        Chinese: "\u{1F1E8}\u{1F1F3}",
        Japanese: "\u{1F1EF}\u{1F1F5}",
        Korean: "\u{1F1F0}\u{1F1F7}",
        Thai: "\u{1F1F9}\u{1F1ED}",
        Vietnamese: "\u{1F1FB}\u{1F1F3}",
        Indonesian: "\u{1F1EE}\u{1F1E9}",
        Romanian: "\u{1F1F7}\u{1F1F4}",
        Hungarian: "\u{1F1ED}\u{1F1FA}",
        Bulgarian: "\u{1F1E7}\u{1F1EC}",
        Croatian: "\u{1F1ED}\u{1F1F7}",
        Serbian: "\u{1F1F7}\u{1F1F8}"
      };
      if (typeof window !== "undefined") {
        window.ChatSessions = {
          getSessions,
          getSession,
          saveSession,
          saveMessage,
          removeLastMessage,
          getMessages,
          deleteSession,
          renderSessionList,
          loadSession,
          getCurrentChatId,
          findSessionByLanguage,
          init: initChatSessions
        };
      }
    }
  });

  // src/modules/core/session-logger.ts
  var SessionLoggerModule, SessionLogger;
  var init_session_logger = __esm({
    "src/modules/core/session-logger.ts"() {
      "use strict";
      SessionLoggerModule = class {
        constructor() {
          this.sessionId = "";
          this.buffer = [];
          this.flushTimer = null;
          this.isActive = false;
        }
        /**
         * Start a new logging session.
         */
        startSession(mode, level) {
          const now = /* @__PURE__ */ new Date();
          const pad = (n) => n.toString().padStart(2, "0");
          this.sessionId = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
          this.buffer = [];
          this.isActive = true;
          this.log("CONFIG", `Session started: mode=${mode}, level=${level}`);
          if (this.flushTimer)
            clearInterval(this.flushTimer);
          this.flushTimer = setInterval(() => this.flush(), 3e3);
          console.log(`[SessionLogger] Started: ${this.sessionId}`);
        }
        /**
         * Log an entry.
         */
        log(type, data) {
          if (!this.isActive)
            return;
          const now = /* @__PURE__ */ new Date();
          const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;
          this.buffer.push({ time, type, data });
          if (this.buffer.length >= 20) {
            this.flush();
          }
        }
        // ========== Convenience methods ==========
        /** User said something */
        userMessage(text) {
          this.log("USER", text);
        }
        /** Bot said something (final transcript) */
        aiMessage(text) {
          this.log("AI_CHAT", text.substring(0, 500));
        }
        /** Bot partial text */
        aiPartial(text) {
          if (text.length > 30) {
            this.log("AI_PARTIAL", text.substring(0, 200));
          }
        }
        /** Bot thinking */
        aiThinking(text) {
          this.log("THINK", text.substring(0, 500));
        }
        /** We sent a text command to the bot */
        sentCommand(text) {
          this.log("SENT_CMD", text);
        }
        /** Auto-continue triggered */
        autoContinue(delivered, expected) {
          this.log("AUTO_CONTINUE", `triggered: ${delivered}/${expected}`);
        }
        /** Manual continue button pressed */
        manualContinue(delivered, expected) {
          this.log("MANUAL_CONTINUE", `pressed: ${delivered}/${expected}`);
        }
        /** WebSocket config sent */
        wsConfig(config) {
          this.log("WS_CONFIG", JSON.stringify(config));
        }
        /** Incomplete replicas detected */
        incompleteDetected(delivered, promised) {
          this.log("INCOMPLETE", `${delivered}/${promised} items`);
        }
        // ========== Flush to server ==========
        /**
         * Send buffered entries to server.
         */
        async flush() {
          if (this.buffer.length === 0)
            return;
          if (!this.sessionId)
            return;
          const entries = [...this.buffer];
          this.buffer = [];
          try {
            await fetch("/api/log", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                session_id: this.sessionId,
                entries
              })
            });
          } catch (e) {
            console.warn("[SessionLogger] Flush failed:", e);
            this.buffer.unshift(...entries);
          }
        }
        /**
         * Stop logging and flush remaining data.
         */
        stopSession() {
          this.log("CONFIG", "Session ended");
          this.flush();
          if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
          }
          this.isActive = false;
          console.log(`[SessionLogger] Stopped: ${this.sessionId}`);
        }
        get currentSessionId() {
          return this.sessionId;
        }
      };
      SessionLogger = new SessionLoggerModule();
      if (typeof window !== "undefined") {
        window.SessionLogger = SessionLogger;
      }
      console.log("[SessionLogger] Module loaded");
    }
  });

  // src/modules/chat/enrichment.ts
  var enrichment_exports = {};
  __export(enrichment_exports, {
    enrichDialogueBlocks: () => enrichDialogueBlocks,
    handleReplicaMetadata: () => handleReplicaMetadata,
    injectInlineTtsButtons: () => injectInlineTtsButtons,
    resetEnrichment: () => resetEnrichment
  });
  function getNativeLangFlag() {
    const code = getNativeLanguage();
    const lang = LANGUAGES.find((l) => l.code === code);
    return lang?.flag || "\u{1F1F7}\u{1F1FA}";
  }
  function getNativeLangName() {
    const code = getNativeLanguage();
    const lang = LANGUAGES.find((l) => l.code === code);
    return lang?.nameEn || "Russian";
  }
  function handleReplicaMetadata(args) {
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer)
      return;
    let allBlocks = Array.from(chatContainer.querySelectorAll(".dialogue-block"));
    if (allBlocks.length === 0) {
      const lastAiMessage = chatContainer.querySelector(".message.ai:last-child .message-bubble");
      if (lastAiMessage) {
        const replNum = args.replica_id || 1;
        lastAiMessage.innerHTML = `<div class="dialogue-block" data-dialogue-id="dlg-${replNum}">
                <div class="dialogue-header">
                    <span class="dialogue-number">${replNum}</span>
                    <span class="dialogue-speaker-label">\u0413\u0420\u0410\u041C\u041C\u0418\u041D\u0418</span>
                </div>
                <div class="dialogue-content"><span class="translation-icon translation" style="margin-right: 8px;">\u{1F1E9}\u{1F1EA}</span></div>
            </div>`;
        allBlocks = Array.from(chatContainer.querySelectorAll(".dialogue-block"));
      } else {
        return;
      }
    }
    let block;
    if (args.replica_id) {
      const matchingBlocks = allBlocks.filter((b) => b.getAttribute("data-dialogue-id") === `dlg-${args.replica_id}`);
      block = matchingBlocks.length > 0 ? matchingBlocks[matchingBlocks.length - 1] : void 0;
    }
    if (!block) {
      block = allBlocks.find((b) => !b.querySelector('.hint-container[data-enriched="tool_call"]'));
    }
    if (!block) {
      block = allBlocks[allBlocks.length - 1];
    }
    const dialogueContent = block.querySelector(".dialogue-content");
    if (!dialogueContent)
      return;
    let hintStr = args.hint_grammar || "";
    if (!hintStr.includes("\u{1F4DC} \u0413\u0420\u0410\u041C\u041C\u0410\u0422\u0418\u041A\u0410")) {
      hintStr = `\u{1F4DC} \u0413\u0420\u0410\u041C\u041C\u0410\u0422\u0418\u041A\u0410
${hintStr}`;
    }
    let answerStr = "";
    if (args.answer_options && Array.isArray(args.answer_options)) {
      answerStr = "\u041E\u0422\u0412\u0415\u0422 / ANSWER\n" + args.answer_options.join("\n");
    }
    const cleanSection = `<hint>
${hintStr}
</hint>
<answer>
${answerStr}
</answer>`;
    if (args.original_text && args.original_text.trim() !== "") {
      const iconSpan = dialogueContent.querySelector(".translation-icon");
      const existingTtsBtn = dialogueContent.querySelector(".german-tts-btn");
      const existingTransBlock = dialogueContent.querySelector(".translation-block, .translation");
      const currentText = dialogueContent.textContent?.replace("\u{1F1E9}\u{1F1EA}", "").trim() || "";
      const hasAudioEmoji = currentText.includes("\u{1F508}");
      let finalGermanText = args.original_text;
      finalGermanText = finalGermanText.replace(/REPLICA\s*\d+\s*:?/gi, "").trim();
      const halfLen = Math.floor(finalGermanText.length / 2);
      if (finalGermanText.length > 20) {
        for (let i = Math.floor(finalGermanText.length / 3); i <= halfLen + 5; i++) {
          const firstPart = finalGermanText.substring(0, i).trim();
          const remainder = finalGermanText.substring(i).trim();
          if (firstPart.length > 10 && remainder.startsWith(firstPart)) {
            console.warn(`[Enrichment] \u26A0\uFE0F Detected AI text duplication in original_text! Cleaning it.`);
            finalGermanText = firstPart;
            break;
          }
        }
      }
      console.log(`[Enrichment] \u2705 Using cleaned original_text (${finalGermanText.length} chars) \u2014 streamed was ${currentText.length} chars`);
      if (hasAudioEmoji && !finalGermanText.includes("\u{1F508}")) {
        finalGermanText += " \u{1F508}";
      }
      dialogueContent.innerHTML = "";
      if (iconSpan)
        dialogueContent.appendChild(iconSpan);
      const textSpan = document.createElement("span");
      let escapedText = escapeHtml(finalGermanText);
      let formattedText = escapedText.replace(/([.!?])\s{1,3}([A-ZÄÖÜА-ЯЁ])/g, "$1<br>$2");
      textSpan.innerHTML = " " + formattedText + " ";
      dialogueContent.appendChild(textSpan);
      if (existingTtsBtn) {
        dialogueContent.appendChild(existingTtsBtn);
      } else {
        const newTtsBtn = document.createElement("button");
        newTtsBtn.className = "tts-inline-btn german-tts-btn";
        newTtsBtn.title = "\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 (Gemini)";
        newTtsBtn.textContent = "\u{1F50A}";
        newTtsBtn.setAttribute("onclick", "playDialogueText(this)");
        dialogueContent.appendChild(newTtsBtn);
      }
      if (existingTransBlock)
        dialogueContent.appendChild(existingTransBlock);
    }
    if (args.translation) {
      let escapedTranslation = escapeHtml(args.translation);
      let formattedTranslation = escapedTranslation.replace(/([.!?])\s{1,3}([A-ZÄÖÜА-ЯЁ])/g, "$1<br>$2");
      let textHtml = `<div class="translation-text-section" style="display: flex; flex-direction: row; align-items: flex-start; gap: 6px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
                            <span class="translation-icon" style="flex-shrink: 0;">${getNativeLangFlag()}</span> 
                            <span class="translation-text" style="flex-grow: 1;">${formattedTranslation}</span>
                            <button class="tts-inline-btn translation-tts-btn" style="flex-shrink: 0;" onclick="playTranslationText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C">\u{1F50A}</button>
                        </div>`;
      const transDiv = document.createElement("div");
      transDiv.className = "translation-block translation selected-theme";
      transDiv.innerHTML = textHtml;
      const existingInDom = dialogueContent.querySelector(".translation-block, .translation");
      if (existingInDom)
        existingInDom.remove();
      dialogueContent.appendChild(transDiv);
    } else if (args.original_text) {
      console.warn(`[Enrichment] \u26A0\uFE0F Translation missing for replica ${args.replica_id} \u2014 AI omitted it from tool_call`);
      const placeholderDiv = document.createElement("div");
      placeholderDiv.className = "translation-block translation selected-theme";
      placeholderDiv.setAttribute("data-needs-translation", "true");
      placeholderDiv.innerHTML = `<div class="translation-text-section" style="display: flex; flex-direction: row; align-items: flex-start; gap: 6px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
            <span class="translation-icon" style="flex-shrink: 0;">${getNativeLangFlag()}</span> 
            <span class="translation-text" style="flex-grow: 1; color: rgba(255,255,255,0.4); font-style: italic;">\u23F3 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044F...</span>
        </div>`;
      const existingInDom2 = dialogueContent.querySelector(".translation-block, .translation");
      if (existingInDom2)
        existingInDom2.remove();
      dialogueContent.appendChild(placeholderDiv);
    }
    const Vocabulary2 = window.Vocabulary;
    let combinedHtml = "";
    if (Vocabulary2 && typeof Vocabulary2.buildHintAnswerHtml === "function") {
      const hintMatch = cleanSection.match(/<hint>([\s\S]*?)<\/hint>/i);
      const answerMatch = cleanSection.match(/<answer>([\s\S]*?)<\/answer>/i);
      const hintContent = hintMatch ? hintMatch[1].trim() : "";
      const answerContent = answerMatch ? answerMatch[1].trim() : "";
      combinedHtml = Vocabulary2.buildHintAnswerHtml(hintContent, answerContent);
    } else {
      combinedHtml = parseBlockSection(cleanSection);
    }
    block.querySelectorAll(".enrichment-loader").forEach((el) => el.remove());
    block.querySelectorAll(".hint-container").forEach((el) => el.remove());
    const wrapper = document.createElement("div");
    wrapper.innerHTML = combinedHtml;
    const newHint = wrapper.firstElementChild;
    if (newHint) {
      newHint.setAttribute("data-enriched", "tool_call");
      block.appendChild(newHint);
    }
    try {
      const SKIP_CLASSES = ["translation", "translation-block", "translation-icon", "hint-text", "answer-text", "hint-container", "answer-container", "dialogue-header", "dialogue-number", "dialogue-speaker-label", "hint-btn", "tts-play-btn", "german-tts-btn", "hint-column", "hint-panel", "answer-item", "answer-list", "answer-header", "hint-header", "hint-list", "hint-item", "thought-details", "ai-thinking-inline", "thought-title", "thought-content", "karaoke-word"];
      const wrapTextNodesForKaraoke = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || "";
          if (text.trim()) {
            const wrapper2 = document.createDocumentFragment();
            let wordIdx = 0;
            const parts = text.split(/(\s+)/);
            parts.forEach((part) => {
              if (part.trim()) {
                const span = document.createElement("span");
                span.className = "karaoke-word";
                span.id = `kw-enrich-${Date.now()}-${wordIdx++}`;
                span.textContent = part;
                wrapper2.appendChild(span);
              } else if (part) {
                wrapper2.appendChild(document.createTextNode(part));
              }
            });
            node.parentNode?.replaceChild(wrapper2, node);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node;
          if (!SKIP_CLASSES.some((cls) => el.classList.contains(cls))) {
            Array.from(node.childNodes).forEach((child) => wrapTextNodesForKaraoke(child));
          }
        }
      };
      const dcForKaraoke = block.querySelectorAll(".dialogue-content");
      dcForKaraoke.forEach((dc) => {
        Array.from(dc.childNodes).forEach((child) => wrapTextNodesForKaraoke(child));
      });
    } catch (e) {
      console.warn("[Enrichment] Karaoke re-wrap failed (non-fatal):", e);
    }
    injectInlineTtsButtons();
    const parentMsg = block.closest(".message.ai");
    if (parentMsg && !parentMsg.classList.contains("streaming")) {
      const chatId = window.ChatSessions?.getCurrentChatId?.() || "";
      const bubble = parentMsg.querySelector(".message-bubble");
      if (chatId && bubble && typeof window.ChatSessions?.updateLastAiMessageText === "function") {
        window.ChatSessions.updateLastAiMessageText(chatId, bubble.innerHTML);
      }
    }
  }
  function enrichDialogueBlocks(isTurnComplete = false) {
    if (enrichTimer)
      clearTimeout(enrichTimer);
    enrichTimer = setTimeout(() => {
      enrichTimer = null;
      doEnrichment(isTurnComplete);
    }, 2e3);
  }
  async function doEnrichment(isTurnComplete = false) {
    if (isEnriching)
      return;
    const teacherModeRadio = document.querySelector('input[name="teacher-mode"]:checked');
    const deliveryMode = window.getDeliveryMode?.() || "interactive";
    if (teacherModeRadio?.value === "active" && deliveryMode !== "fast_text") {
      if (!isTurnComplete) {
        console.log(`[Enrichment] \u{1F6D1} Text Bot disabled (Active + ${deliveryMode} mode \u2014 waiting for Tool Calls).`);
        return;
      } else {
        console.log(`[Enrichment] \u{1F504} Turn complete in ${deliveryMode} mode. Text Bot will run as fallback for missed metadata.`);
      }
    }
    const streamingModule = window.StreamingDisplay;
    if (streamingModule?.streamingAiMsg) {
      if (isTurnComplete) {
        console.warn(`[Enrichment] \u26A0\uFE0F Overriding isTurnComplete=true because Voice AI started a NEW stream during the debounce delay!`);
        isTurnComplete = false;
      }
    }
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer)
      return;
    const allBlocks = Array.from(chatContainer.querySelectorAll(".dialogue-block[data-dialogue-id]"));
    const blocksToEnrich = [];
    allBlocks.forEach((block, index) => {
      const blockId = block.getAttribute("data-dialogue-id") || "";
      if (!isTurnComplete && index === allBlocks.length - 1) {
        console.log(`[Enrichment] \u{1F6E1}\uFE0F Protecting active live block ${blockId} from Parallel Harvest.`);
        return;
      }
      if (block.querySelector(".enrichment-loader")) {
        return;
      }
      const existingHintContainer = block.querySelector(".hint-container");
      if (existingHintContainer) {
        enrichedBlockIds.add(blockId);
        return;
      }
      const contentEl = block.querySelector(".dialogue-content");
      if (!contentEl)
        return;
      const germanText = contentEl.textContent?.trim() || "";
      const translationEl = block.querySelector(".translation");
      const translationText = translationEl?.textContent?.trim() || "";
      const numEl = block.querySelector(".dialogue-number");
      const dialogueNum = numEl?.textContent?.trim() || blockId;
      if (germanText.length < 10) {
        if (!isTurnComplete) {
          console.log(`[Enrichment] \u{1F6E1}\uFE0F Skipping short block ${blockId} because Voice AI is still writing to it.`);
          return;
        }
        blocksToEnrich.push({
          id: blockId,
          num: dialogueNum,
          germanText: "",
          // Empty means missing / needs rewrite
          translation: "",
          element: block
        });
        return;
      }
      const germanHtml = contentEl ? contentEl.innerHTML || "" : "";
      if (!isTurnComplete && /<hint\b/i.test(germanHtml) && !/<\/hint>/i.test(germanHtml)) {
        console.log(`[Enrichment] \u{1F6E1}\uFE0F Skipping Block ${blockId} \u2014 Voice AI is still streaming a <hint> tag.`);
        return;
      }
      blocksToEnrich.push({
        id: blockId,
        num: dialogueNum,
        germanText,
        translation: translationText,
        element: block
      });
    });
    let expectedReplicas = window.StreamingDisplay?.lastPromisedCount || 0;
    const allBlocksNow = Array.from(chatContainer.querySelectorAll(".dialogue-block[data-dialogue-id]"));
    if (allBlocksNow.length > 0) {
      const currentDeliveryMode = window.getDeliveryMode?.() || "interactive";
      if (currentDeliveryMode !== "fast_text") {
        expectedReplicas = 1;
      } else if (!expectedReplicas || expectedReplicas < 3) {
        const teacherModeRadio2 = document.querySelector('input[name="teacher-mode"]:checked');
        const mode = teacherModeRadio2?.value || "standard";
        expectedReplicas = mode === "active" ? 10 : 5;
      }
      if (isTurnComplete && expectedReplicas > allBlocksNow.length) {
        const missingCount = expectedReplicas - allBlocksNow.length;
        console.log(`[Enrichment] Missing ${missingCount} blocks. Generating them with Text Bot.`);
        const event = new CustomEvent("system-message", {
          detail: { text: `\u23F3 \u0421\u0442\u0440\u0438\u043C Voice AI \u043F\u0440\u0435\u0440\u0432\u0430\u043D. \u0422\u0435\u043A\u0441\u0442\u043E\u0432\u044B\u0439 \u0418\u0418 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442 \u043D\u0435\u0434\u043E\u0441\u0442\u0430\u044E\u0449\u0438\u0435 ${missingCount} \u0434\u0438\u0430\u043B\u043E\u0433\u0430... (\u043E\u0436\u0438\u0434\u0430\u0439\u0442\u0435 ~40 \u0441\u0435\u043A)` }
        });
        window.dispatchEvent(event);
        let appendTarget = allBlocksNow[allBlocksNow.length - 1];
        let startNum = allBlocksNow.length + 1;
        for (let i = 0; i < missingCount; i++) {
          const blockNum = startNum + i;
          const blockId = "dlg-" + blockNum;
          const dummyBlock = document.createElement("div");
          dummyBlock.className = "dialogue-block";
          dummyBlock.setAttribute("data-dialogue-id", blockId);
          dummyBlock.innerHTML = `
                <div class="dialogue-header">
                    <span class="dialogue-number">${blockNum}</span>
                    <span class="dialogue-speaker-label">\u0413\u0420\u0410\u041C\u041C\u0418\u041D\u0418</span>
                    <button class="tts-play-btn" onclick="playDialogueText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C">\u{1F50A}</button>
                </div>
                <div class="dialogue-content">
                    <div class="enrichment-loader">
                        <div class="preloader-spinner"></div>
                        <span>\u0421\u0431\u043E\u0440\u043A\u0430 \u0431\u043B\u043E\u043A\u0430 \u043E\u0442 \u0422\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u0433\u043E \u0418\u0418...</span>
                    </div>
                </div>
            `;
          if (appendTarget) {
            appendTarget.after(dummyBlock);
          } else {
            chatContainer.appendChild(dummyBlock);
          }
          appendTarget = dummyBlock;
          blocksToEnrich.push({
            id: blockId,
            num: blockNum.toString(),
            germanText: "",
            translation: "",
            element: dummyBlock
          });
        }
        chatContainer.scrollTo({
          top: chatContainer.scrollHeight,
          behavior: "smooth"
        });
      }
    }
    if (blocksToEnrich.length === 0)
      return;
    isEnriching = true;
    console.log(`[Enrichment] Batching ${blocksToEnrich.length} blocks into 1 API call`);
    SessionLogger.log("ENRICH", `Batching ${blocksToEnrich.length} blocks`);
    const loaders = /* @__PURE__ */ new Map();
    blocksToEnrich.forEach((b) => {
      enrichedBlockIds.add(b.id);
      const existingLoader = b.element.querySelector(".enrichment-loader");
      if (!existingLoader) {
        const loader = document.createElement("div");
        loader.className = "enrichment-loader";
        loader.setAttribute("data-enrich-id", b.id);
        loader.innerHTML = `<div class="preloader-spinner"></div> <span>\u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u044E \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0438 \u0434\u043B\u044F \u0431\u043B\u043E\u043A\u0430 ${b.num}...</span>`;
        b.element.appendChild(loader);
        loaders.set(b.id, loader);
      } else {
        loaders.set(b.id, existingLoader);
      }
    });
    const apiKeyInput = document.getElementById("api-key");
    const baseApiKey = apiKeyInput?.value?.trim() || localStorage.getItem("gemini_api_key") || "";
    const allKeys = window.getAllIllustrationKeys ? window.getAllIllustrationKeys() : baseApiKey;
    if (!baseApiKey && !allKeys) {
      console.warn("[Enrichment] No API key available");
      loaders.forEach((l) => l.remove());
      isEnriching = false;
      return;
    }
    const BATCH_SIZE = blocksToEnrich.length > 0 ? blocksToEnrich.length : 1;
    const chunks = [];
    for (let i = 0; i < blocksToEnrich.length; i += BATCH_SIZE) {
      chunks.push(blocksToEnrich.slice(i, i + BATCH_SIZE));
    }
    console.log(`[Enrichment] Processing ${blocksToEnrich.length} blocks in ${chunks.length} batches of max ${BATCH_SIZE}`);
    SessionLogger.log("ENRICH", `Starting ${chunks.length} batches`);
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      console.log(`[Enrichment] Fetching batch ${c + 1}/${chunks.length} (blocks ${chunk.map((b) => b.num).join(", ")})`);
      const prompt2 = buildBatchPrompt(chunk);
      const state2 = getState();
      const recentContext = state2?.conversationHistory ? state2.conversationHistory.slice(-5).map((m) => ({
        role: m.role || "user",
        // The backend expects 'role', not 'type'
        text: m.parts?.[0]?.text || m.text || ""
      })) : [];
      const requestPayload = {
        api_key: allKeys,
        message: prompt2,
        context: recentContext,
        custom_instructions: ENRICHMENT_SYSTEM_PROMPT,
        response_format: "json"
      };
      console.log(`[Enrichment] \u{1F511} Sending batch request with API Key length: ${allKeys.length}, starts with: ${allKeys.substring(0, 5)}...`);
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload)
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          console.error(`[Enrichment] API error in batch ${c + 1}: ${response.status}`, errText);
          chunk.forEach((b) => {
            const l = loaders.get(b.id);
            if (l) {
              l.innerHTML = `
                            <div style="background:#422; border:1px solid #f66; padding:10px; border-radius:8px; margin-top:5px; margin-bottom: 20px;">
                                <span style="color:#f66;font-size:12px; font-weight:bold;">\u274C \u041E\u0448\u0438\u0431\u043A\u0430 API: ${response.status}</span>
                                <pre style="color:#ddd; font-size:10px; white-space:pre-wrap; max-height:150px; overflow-y:auto;">${escapeHtml(errText)}</pre>
                            </div>
                        `;
            }
            enrichedBlockIds.add(b.id);
          });
          continue;
        }
        const data = await response.json();
        const text = data.text || "";
        if (text) {
          console.log(`[Enrichment] Got response for batch ${c + 1} (${text.length} chars), parsing...`);
          distributeEnrichment(text, chunk, loaders);
        } else {
          chunk.forEach((b) => {
            const l = loaders.get(b.id);
            if (l) {
              l.innerHTML = `<span style="color:#f66;font-size:12px;">\u274C \u041F\u0443\u0441\u0442\u043E\u0439 \u043E\u0442\u0432\u0435\u0442 \u043E\u0442 \u0418\u0418</span>`;
            }
          });
        }
        if (c < chunks.length - 1) {
          console.log(`[Enrichment] Pacing batches. Waiting 5 seconds before next request...`);
          await new Promise((resolve) => setTimeout(resolve, 5e3));
        }
      } catch (err) {
        console.error(`[Enrichment] Error in batch ${c + 1}:`, err);
        chunk.forEach((b) => {
          const l = loaders.get(b.id);
          if (l) {
            const msg = err instanceof Error ? err.message : "\u0421\u0435\u0442\u0435\u0432\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430";
            l.innerHTML = `<span style="color:#f66;font-size:12px;">\u274C \u041E\u0448\u0438\u0431\u043A\u0430: ${msg}</span>`;
          }
        });
      }
    }
    isEnriching = false;
  }
  function buildBatchPrompt(blocks) {
    const nativeLang = getNativeLangName();
    let prompt2 = `Analyze ${blocks.length} C2 German dialogue replicas. Output a JSON array with ${blocks.length} objects.

`;
    prompt2 += `Each object structure:
`;
    prompt2 += `{
`;
    prompt2 += `  "blockNum": "N",
`;
    prompt2 += `  "fixedGerman": "MANDATORY: ALWAYS ONLY pure German text! The complete German C2 sentence. For [MISSING BLOCK]: generate a NEW 30+ word C2 German sentence continuing the conversation topic. NO TRANSLATION HERE.",
`;
    prompt2 += `  "fixedTranslation": "MANDATORY: Pure ${nativeLang} translation of the German sentence.",
`;
    prompt2 += `  "hint": "\u{1F4DC} \u0413\u0420\u0410\u041C\u041C\u0410\u0422\u0418\u041A\u0410 / GRAMMAR\\n\u25B8 SATZPERIODE: [syntactic analysis]\\n\u25B8 STILISTIK: [register + devices]\\n\u25B8 RHETORIK: [rhetorical figures]\\n\u25B8 KONTEXT: [discourse function]\\n\u25B8 WORTWAHL: [3-5 C2 vocab items with German explanations]",
`;
    prompt2 += `  "answer": "+ [C2 German 15+ words] (${nativeLang} translation)\\n- [C2 German 15+ words] (${nativeLang} translation)\\n~ [C2 German 15+ words] (${nativeLang} translation)\\n\u{1F393} [C2 German 15+ words] (${nativeLang} translation)\\n\u{1F3C6} [C2 German 15+ words] (${nativeLang} translation)"
`;
    prompt2 += `}

`;
    prompt2 += `CRITICAL RULES:
`;
    prompt2 += `- Raw JSON ONLY. No markdown, no \`\`\`json.
`;
    prompt2 += `- EXACTLY ${blocks.length} objects in the array.
`;
    prompt2 += `- fixedGerman MUST NEVER be empty! ONLY GERMAN TEXT. NO ${nativeLang.toUpperCase()} TEXT INSIDE fixedGerman.
`;
    prompt2 += `- fixedTranslation MUST NEVER be empty! PUT THE ${nativeLang.toUpperCase()} TRANSLATION HERE.
`;
    prompt2 += `- ALL 5 hint sections required (SATZPERIODE, STILISTIK, RHETORIK, KONTEXT, WORTWAHL).
`;
    prompt2 += `- Each answer option: 15+ words C2 German + (${nativeLang} translation in parentheses).
`;
    prompt2 += `- \u{1F6AB} NO meta-talk ("\u0414\u0438\u0430\u043B\u043E\u0433 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D!", "\u041A\u0430\u043A \u0432\u0430\u043C?").

`;
    blocks.forEach((b, i) => {
      prompt2 += `--- BLOCK ${i + 1} (num: ${b.num}) ---
`;
      if (b.germanText) {
        prompt2 += `DE: "${b.germanText}"
`;
        if (b.translation) {
          prompt2 += `${nativeLang}: ${b.translation}
`;
        }
      } else {
        prompt2 += `[MISSING BLOCK \u2014 generate new C2 German sentence FOR "fixedGerman" AND ${nativeLang} translation FOR "fixedTranslation" continuing conversation topic]
`;
      }
      prompt2 += "\n";
    });
    return prompt2;
  }
  function distributeEnrichment(text, blocks, loaders) {
    let parsedBlocks = [];
    try {
      let cleanText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const arrayStart = cleanText.indexOf("[");
      const objectStart = cleanText.indexOf("{");
      const hasArray = arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);
      if (hasArray) {
        cleanText = cleanText.substring(arrayStart);
        let possibleEnds = [];
        for (let i = 0; i < cleanText.length; i++) {
          if (cleanText[i] === "]")
            possibleEnds.push(i);
        }
        let success = false;
        for (let i = possibleEnds.length - 1; i >= 0; i--) {
          try {
            const testJson = cleanText.substring(0, possibleEnds[i] + 1);
            parsedBlocks = JSON.parse(testJson);
            success = true;
            break;
          } catch (e) {
          }
        }
        if (!success) {
          console.warn("[Enrichment] JSON truncated, attempting repair...");
          const lastCloseBrace = cleanText.lastIndexOf("}");
          if (lastCloseBrace > 0) {
            try {
              const repaired = cleanText.substring(0, lastCloseBrace + 1) + "]";
              parsedBlocks = JSON.parse(repaired);
              success = true;
              console.log(`[Enrichment] \u2705 JSON repaired successfully (${parsedBlocks.length} blocks recovered)`);
            } catch (e2) {
            }
          }
          if (!success) {
            throw new Error("Could not extract valid JSON array (truncated)");
          }
        }
      } else if (objectStart !== -1) {
        cleanText = cleanText.substring(objectStart);
        let possibleEnds = [];
        for (let i = 0; i < cleanText.length; i++) {
          if (cleanText[i] === "}")
            possibleEnds.push(i);
        }
        let success = false;
        for (let i = possibleEnds.length - 1; i >= 0; i--) {
          try {
            const testJson = cleanText.substring(0, possibleEnds[i] + 1);
            const parsed = JSON.parse(testJson);
            parsedBlocks = Array.isArray(parsed) ? parsed : [parsed];
            success = true;
            console.log(`[Enrichment] \u2705 Parsed single JSON object (no array brackets)`);
            break;
          } catch (e) {
          }
        }
        if (!success) {
          throw new Error("Could not extract valid JSON object");
        }
      } else {
        parsedBlocks = JSON.parse(cleanText);
      }
      if (!Array.isArray(parsedBlocks)) {
        parsedBlocks = [parsedBlocks];
      }
    } catch (e) {
      console.error("[Enrichment] Failed to parse JSON response.");
      console.error("[Enrichment] RAW AI RESPONSE:", text);
      loaders.forEach((l) => {
        const rawDump = escapeHtml(text);
        l.innerHTML = `
                <div style="background:#311; border:1px solid #f44; padding:10px; border-radius:8px; margin-top:5px; margin-bottom: 20px;">
                    <div style="color:#f66;font-size:12px; font-weight:bold; margin-bottom:5px;">\u274C \u041E\u0448\u0438\u0431\u043A\u0430: \u0418\u0418 \u0432\u0435\u0440\u043D\u0443\u043B \u043D\u0435 JSON. \u0421\u044B\u0440\u043E\u0439 \u043E\u0442\u0432\u0435\u0442:</div>
                    <textarea readonly style="width:100%; height:100px; background:#111; color:#0f0; font-family:monospace; font-size:10px; border:1px solid #333; padding:5px; border-radius:4px;">${rawDump}</textarea>
                </div>
            `;
      });
      return;
    }
    console.log(`[Enrichment] Parsed ${parsedBlocks.length} JSON objects for ${blocks.length} blocks`);
    let currentHistoryText = "";
    const state2 = getState();
    if (state2 && state2.conversationHistory) {
      for (let i = state2.conversationHistory.length - 1; i >= 0; i--) {
        if (state2.conversationHistory[i].role === "model") {
          const msg = state2.conversationHistory[i];
          currentHistoryText = msg.parts?.[0]?.text || msg.text || "";
          break;
        }
      }
    }
    blocks.forEach((block, i) => {
      const bd = parsedBlocks[i] || parsedBlocks.find((p) => p.blockNum == block.num) || null;
      const loader = loaders.get(block.id);
      if (!bd) {
        if (loader) {
          loader.innerHTML = `<span style="color:#f90;font-size:12px;">\u26A0\uFE0F \u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D \u0431\u043B\u043E\u043A ${block.num} (\u0418\u0418 \u043D\u0435 \u0432\u0435\u0440\u043D\u0443\u043B \u0434\u0430\u043D\u043D\u044B\u0435)</span>`;
        }
        return;
      }
      const bdKeys = Object.keys(bd);
      console.log(`[Enrichment] Block ${block.num} API keys: [${bdKeys.join(", ")}]`);
      const rawGerman = (bd.fixedGerman || bd.fixed_german || bd.german || bd.germanText || bd.german_text || bd.text || bd.DE || bd.de || bd.sentence || bd.germanSentence || bd.content || "").toString().trim();
      const fixedGerman = rawGerman.length > 5 ? rawGerman : null;
      const rawTrans = (bd.fixedTranslation || bd.fixed_translation || bd.translation || bd.russianTranslation || bd.russian || bd.RU || bd.ru || bd.trans || "").toString().trim();
      const fixedTrans = rawTrans.length > 3 ? rawTrans : null;
      console.log(`[Enrichment] Block ${block.num}: german=${fixedGerman ? fixedGerman.substring(0, 60) + "..." : "NULL"}, trans=${fixedTrans ? fixedTrans.substring(0, 40) + "..." : "NULL"}`);
      const dialogueContent = block.element.querySelector(".dialogue-content");
      const isDummyBlock = dialogueContent && !dialogueContent.querySelector(".dialogue-text, span:not(.enrichment-loader span)");
      if (dialogueContent && (fixedGerman || fixedTrans)) {
        console.log(`[Enrichment] \u{1F527} Rendering text for Block ${block.num}`);
        const Vocabulary2 = window.Vocabulary;
        dialogueContent.innerHTML = "";
        if (fixedGerman) {
          const germanHtml = Vocabulary2?.formatMessage ? Vocabulary2.formatMessage(fixedGerman) : escapeHtml(fixedGerman);
          const textWrapper = document.createElement("div");
          textWrapper.className = "dialogue-text";
          textWrapper.innerHTML = germanHtml;
          const ttsBtn = document.createElement("button");
          ttsBtn.className = "tts-inline-btn german-tts-btn";
          ttsBtn.title = "\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C";
          ttsBtn.textContent = "\u{1F50A}";
          ttsBtn.setAttribute("onclick", "playDialogueText(this)");
          textWrapper.appendChild(ttsBtn);
          dialogueContent.appendChild(textWrapper);
        }
        if (fixedTrans) {
          const transDiv = document.createElement("div");
          transDiv.className = "translation-block translation selected-theme";
          let escapedTrans = escapeHtml(fixedTrans);
          let formattedTrans = escapedTrans.replace(/([.!?])\s{1,3}([A-ZÄÖÜА-ЯЁ])/g, "$1<br>$2");
          transDiv.innerHTML = `<div class="translation-text-section" style="display: flex; flex-direction: row; align-items: flex-start; gap: 6px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    <span class="translation-icon" style="flex-shrink: 0;">${getNativeLangFlag()}</span>
                    <span class="translation-text" style="flex-grow: 1;">${formattedTrans}</span>
                    <button class="tts-inline-btn translation-tts-btn" style="flex-shrink: 0;" onclick="playTranslationText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C">\u{1F50A}</button>
                </div>`;
          dialogueContent.appendChild(transDiv);
        }
      } else if (dialogueContent && isDummyBlock && !fixedGerman) {
        console.warn(`[Enrichment] \u26A0\uFE0F Block ${block.num}: No German text found in API response! Keys: [${bdKeys.join(", ")}]`);
        dialogueContent.innerHTML = `<div style="color: #f90; padding: 10px; font-size: 12px;">
                \u26A0\uFE0F \u0422\u0435\u043A\u0441\u0442\u043E\u0432\u044B\u0439 \u0418\u0418 \u043D\u0435 \u0432\u0435\u0440\u043D\u0443\u043B \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 \u0442\u0435\u043A\u0441\u0442 \u0434\u043B\u044F \u0431\u043B\u043E\u043A\u0430 ${block.num}.
                <br>\u041F\u043E\u043B\u044F: [${bdKeys.join(", ")}]
            </div>`;
      }
      let injectionStr = "";
      if (fixedGerman) {
        injectionStr += `[REPLICA ${block.num}]:
${fixedGerman} ${fixedTrans ? `(${fixedTrans})` : ""}
`;
      }
      const hintStr = bd.hint || "";
      const answerStr = bd.answer || "";
      const cleanSection = `<hint>
${hintStr}
</hint>
<answer>
${answerStr}
</answer>`;
      injectionStr += cleanSection.trim() + "\n";
      const injectIntoBuffer = (buffer) => {
        if (!buffer)
          return buffer;
        const currentBlockRegex = new RegExp(`(?:^|\\n|\\.\\s+)(?:\\[?REPLICA\\s+)?${block.num}(?:\\]?|\\.)\\s*:?`, "i");
        const nextBlockNum = parseInt(block.num) + 1;
        const nextBlockRegex = new RegExp(`(?:^|\\n|\\.\\s+)(?:\\[?REPLICA\\s+)?${nextBlockNum}(?:\\]?|\\.)\\s*:?`, "i");
        const currentMatch = buffer.match(currentBlockRegex);
        const nextMatch = buffer.match(nextBlockRegex);
        if (fixedGerman && currentMatch) {
          const startIdx = currentMatch.index;
          const endIdx = nextMatch ? nextMatch.index : buffer.length;
          return buffer.slice(0, startIdx) + "\n" + injectionStr + buffer.slice(endIdx);
        } else if (!buffer.includes(cleanSection.trim())) {
          if (nextMatch) {
            return buffer.slice(0, nextMatch.index) + "\n" + injectionStr + buffer.slice(nextMatch.index);
          } else {
            return buffer + "\n" + injectionStr;
          }
        }
        return buffer;
      };
      currentHistoryText = injectIntoBuffer(currentHistoryText);
      const streamingDisplay = window.StreamingDisplay;
      if (streamingDisplay && streamingDisplay.aiAccumulatedText !== void 0) {
        streamingDisplay.aiAccumulatedText = injectIntoBuffer(streamingDisplay.aiAccumulatedText);
      }
      const html = parseBlockSection(cleanSection);
      if (loader && loader.parentNode) {
        loader.outerHTML = html;
      } else {
        block.element.insertAdjacentHTML("beforeend", html);
      }
      block.element.querySelectorAll(".enrichment-loader").forEach((el) => el.remove());
      const newHint = block.element.querySelector(".hint-container:not([data-enriched])");
      if (newHint) {
        newHint.setAttribute("data-enriched", "true");
        block.element.appendChild(newHint);
      }
      console.log(`[Enrichment] \u2705 Block ${block.num} enriched`);
    });
    injectInlineTtsButtons();
    if (currentHistoryText) {
      updateLastModelHistoryText(currentHistoryText);
      const chatId = getCurrentChatId();
      if (chatId) {
        updateLastAiMessageText(chatId, currentHistoryText);
      }
    }
  }
  function injectInlineTtsButtons() {
    const chatContainer = document.getElementById("chat-container");
    if (!chatContainer)
      return;
    chatContainer.querySelectorAll(".dialogue-block").forEach((block) => {
      if (block.getAttribute("data-tts-injected"))
        return;
      const dialogueContent = block.querySelector(".dialogue-content");
      if (!dialogueContent)
        return;
      const ttsBar = document.createElement("div");
      ttsBar.className = "tts-bar";
      ttsBar.innerHTML = `
            <button class="tts-bar-btn" onclick="speakDialogueGerman(this)" title="\u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 \u0442\u0435\u043A\u0441\u0442">
                \u{1F50A} <span>\u041D\u0435\u043C\u0435\u0446\u043A\u0438\u0439</span>
            </button>
            <button class="tts-bar-btn" onclick="speakDialogueTranslation(this)" title="\u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C \u043F\u0435\u0440\u0435\u0432\u043E\u0434">
                \u{1F50A} <span>\u041F\u0435\u0440\u0435\u0432\u043E\u0434</span>
            </button>
        `;
      const firstStructural = dialogueContent.querySelector(".hint-container, .enrichment-loader");
      if (firstStructural) {
        dialogueContent.insertBefore(ttsBar, firstStructural);
      } else {
        dialogueContent.appendChild(ttsBar);
      }
      block.setAttribute("data-tts-injected", "true");
    });
  }
  function parseBlockSection(section) {
    const hintMatch = section.match(/<hint>([\s\S]*?)<\/hint>/i);
    const answerMatch = section.match(/<answer>([\s\S]*?)<\/answer>/i);
    if (!hintMatch && !answerMatch) {
      return `<div class="hint-container expanded" style="margin-top:8px;">
            <div class="hint-panel hint-text" style="display:block;">
                <div class="hint-header">\u{1F4DC} GRAMMAR</div>
                <div>${escapeHtml(section.trim()).replace(/\n/g, "<br>")}</div>
            </div>
        </div>`;
    }
    const Vocabulary2 = window.Vocabulary;
    if (Vocabulary2 && typeof Vocabulary2.buildHintAnswerHtml === "function") {
      const hintContent = hintMatch ? hintMatch[1].trim() : "";
      const answerContent = answerMatch ? answerMatch[1].trim() : "";
      return Vocabulary2.buildHintAnswerHtml(hintContent, answerContent);
    }
    const hintId = "hint_e_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4);
    let hintHtml = "";
    if (hintMatch) {
      const hintContent = hintMatch[1].trim();
      const parts = hintContent.split("\u25B8").map((p) => p.trim()).filter((p) => p.length > 0);
      if (parts.length > 1) {
        const title = parts[0];
        const items = parts.slice(1).map(
          (item) => `<div class="hint-item"><span class="hint-bullet">\u25B8</span> ${escapeHtml(item)}</div>`
        ).join("");
        hintHtml = `<div class="hint-header">${escapeHtml(title)}</div><div class="hint-list">${items}</div>`;
      } else {
        hintHtml = escapeHtml(hintContent);
      }
    }
    let answerHtml = "";
    if (answerMatch) {
      const answerContent = answerMatch[1].trim();
      const lines = answerContent.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      const answerItems = lines.map((line) => {
        let cls = "answer-item-neutral";
        if (line.startsWith("+")) {
          cls = "answer-item-positive";
          line = line.substring(1).trim();
        } else if (line.startsWith("-")) {
          cls = "answer-item-negative";
          line = line.substring(1).trim();
        } else if (line.startsWith("~")) {
          cls = "answer-item-variant";
          line = line.substring(1).trim();
        } else if (line.startsWith("\u{1F393}")) {
          cls = "answer-item-expert";
          line = line.substring(2).trim();
        } else if (line.startsWith("\u{1F3C6}")) {
          cls = "answer-item-champion";
          line = line.substring(2).trim();
        }
        return `
                <div class="answer-item ${cls}">
                    <div class="answer-content">
                        <span class="answer-german">${escapeHtml(line.trim())}</span>
                    </div>
                </div>
            `;
      }).join("");
      answerHtml = `
            <div class="answer-list">${answerItems}</div>
        `;
    }
    return `
        <div class="hint-container expanded" id="${hintId}">
            <div class="hint-column">
                <button class="hint-btn hint-btn-hint" onclick="revealHint('${hintId}', 'hint', event)" title="\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0443">\u0413\u0420\u0410\u041C\u041C\u0410\u0422\u0418\u041A\u0410</button>
                <div class="hint-panel hint-text hidden" data-type="hint">${hintHtml}</div>
            </div>
            <div class="hint-column">
                <button class="hint-btn hint-btn-answer hidden" onclick="revealHint('${hintId}', 'answer', event)" title="\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442">\u041E\u0422\u0412\u0415\u0422</button>
                <div class="hint-panel hint-text hidden" data-type="answer">${answerHtml}</div>
            </div>
        </div>
    `.replace(/\s+/g, " ").trim();
  }
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function resetEnrichment() {
    enrichedBlockIds.clear();
    isEnriching = false;
    if (enrichTimer) {
      clearTimeout(enrichTimer);
      enrichTimer = null;
    }
  }
  var ENRICHMENT_SYSTEM_PROMPT, enrichedBlockIds, isEnriching, enrichTimer;
  var init_enrichment = __esm({
    "src/modules/chat/enrichment.ts"() {
      "use strict";
      init_session_logger();
      init_state();
      init_chat_sessions();
      init_language_picker();
      ENRICHMENT_SYSTEM_PROMPT = `You are an elite C2-level German linguistics operator (Germanistik PhD level). You serve as the "eyes and hands" of a real-time voice conversation system. A Voice AI generates German sentences, and YOUR job is to produce PERFECT grammar analysis and answer options for each sentence.

YOUR IDENTITY: You are the GRAMMAR OPERATOR \u2014 a meticulous C2 linguistics expert who sees the full context of the conversation and produces publication-quality analysis.

STRICT OUTPUT FORMAT:
- Output ONLY a raw JSON array of objects. NO text before or after.
- Each object MUST contain EXACTLY 5 keys: "blockNum", "fixedGerman", "fixedTranslation", "hint", "answer".
- NO markdown, NO \`\`\`json wrappers, NO conversational text.

HINT FIELD FORMAT (MUST follow this EXACT structure):
\u{1F4DC} \u0413\u0420\u0410\u041C\u041C\u0410\u0422\u0418\u041A\u0410 / GRAMMAR
\u25B8 SATZPERIODE: [Analyze the full syntactic architecture: Hauptsatz/Nebensatz hierarchy, V2/Vf placement, Genitivketten depth, Ausklammerung, TeKaMoLo violations]
\u25B8 STILISTIK: [Identify register: Wissenschaftssprache/Feuilleton/Essayistik. Name specific devices: Nominalstil, Partizipialattribute, erweiterte Attribute]
\u25B8 RHETORIK: [List ALL rhetorical devices used: Chiasmus, Litotes, Klimax, Parallelismus, Anapher, rhetorische Frage, Metapher]
\u25B8 KONTEXT: [Thematic context and discourse function of this utterance in the broader argument]
\u25B8 WORTWAHL: [3-5 key C2 vocabulary items with brief German explanations: "kakophonisch \u2014 dissonant, chaotisch", "Sinnflut \u2014 \xDCberfluss an Reizen"]

ANSWER FIELD FORMAT (MUST follow this EXACT structure \u2014 5 options, each 15+ words C2 German):
+ [Agree/support \u2014 long C2 German sentence continuing the argument] (\u0440\u0443\u0441\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434)
- [Disagree/challenge \u2014 long C2 German counterargument] (\u0440\u0443\u0441\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434)
~ [Nuanced/differentiated \u2014 long C2 German alternative perspective] (\u0440\u0443\u0441\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434)
\u{1F393} [Expert meta-analysis \u2014 long C2 German academic observation about the argument] (\u0440\u0443\u0441\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434)
\u{1F3C6} [Brilliant synthesis \u2014 long C2 German sentence that elevates the discourse] (\u0440\u0443\u0441\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434)

QUALITY REQUIREMENTS:
- HINT must have ALL 5 sections (SATZPERIODE, STILISTIK, RHETORIK, KONTEXT, WORTWAHL). Missing any = FAILURE.
- Each ANSWER option MUST be minimum 15 words of authentic C2 German using Genitivketten, Wissenschaftssprache, or literary register.
- Each ANSWER option MUST end with (\u0440\u0443\u0441\u0441\u043A\u0438\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u0432 \u0441\u043A\u043E\u0431\u043A\u0430\u0445) \u2014 the translation MUST be in parentheses.
- fixedGerman: If the original is incomplete/cut off, write the COMPLETE sentence. Otherwise EMPTY STRING "".
- fixedTranslation: If translation is missing/incomplete, write FULL Russian translation. Otherwise EMPTY STRING "".
- For [MISSING BLOCK]: Generate a NEW C2 German sentence that CONTINUES the conversation topic, plus Russian translation.
- \u{1F6AB} NEVER output meta-talk like "\u0414\u0438\u0430\u043B\u043E\u0433 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D!", "\u041A\u0430\u043A \u0432\u0430\u043C?", "\u0414\u0430\u043B\u044C\u0448\u0435?" inside ANY field.

=== C2 LINGUISTIC REFERENCE (USE THIS KNOWLEDGE IN YOUR ANALYSIS) ===

GRAMMATIK C2 \u2014 Advanced constructions to identify and analyze:
\u2022 Satzperioden (4+ Nebens\xE4tze verkettet), Split-Konstruktionen, Nachfeldbesetzung
\u2022 Genitivketten: des Aufstiegs der Bedeutung des Begriffs der W\xFCrde
\u2022 Partizipialattribute (erweitert): der seit langem als obsolet geltende Grundsatz
\u2022 Konjunktiv II Plusquamperfekt: h\xE4tte man nicht vernachl\xE4ssigen d\xFCrfen
\u2022 Funktionsverbgef\xFCge: in Erw\xE4gung ziehen, zum Ausdruck bringen, zur Debatte stehen
\u2022 Nominalisierung: das Infragestellen, das Hintanstellen, die Inbetriebnahme
\u2022 Ausklammerung: Er hat gestern gesehen, den Mann mit dem roten Hut
\u2022 TeKaMoLo Inversionen als Stilmittel
\u2022 Irreale Konzessivs\xE4tze: Selbst wenn man... zugestehen w\xFCrde, bliebe die Frage

LEXIKALISCHE FELDER C2 (10 obligatorische Bereiche):
1. Philosophie/Epistemologie: Ontologie, Hermeneutik, Ph\xE4nomenologie, Dialektik, Transzendenz
2. Jurisprudenz/Politik: Rechtsstaatlichkeit, Subsidiarit\xE4t, Souver\xE4nit\xE4t, Jurisdiktion
3. Wissenschaft/Forschung: Paradigmenwechsel, peer-reviewed, Falsifizierbarkeit, Empirie
4. \xD6konomie/Finanzwelt: Liquidit\xE4t, Volatilit\xE4t, Rendite, Kapitalallokation
5. Medien/Diskurs: postfaktisch, Deutungshoheit, Framing, Agenda-Setting, Medienkompetenz
6. Psychologie/Soziologie: Resilienz, Selbstwirksamkeit, Milieu, soziale Stratifikation
7. Technologie/Digitalisierung: Algorithmik, Automatisierung, Datafizierung, Singularit\xE4t
8. Umwelt/Nachhaltigkeit: Dekarbonisierung, Biodiversit\xE4t, \xF6kologischer Fu\xDFabdruck
9. Kunst/Literatur: Expressionismus, Avantgarde, \xC4sthetik, Intermedialit\xE4t
10. Diplomatische Sprache: Akkreditierung, Nichteinmischung, Realpolitik, Memorandum

STILISTIK\u2014REGISTER (identify which one the sentence uses):
\u2022 Wissenschaftssprache: Nominalstil, Passivkonstruktionen, hedging (d\xFCrfte, scheint)
\u2022 Feuilleton: metaphorische Verdichtung, ironische Distanz, kulturelle Anspielungen
\u2022 Diplomatisch: Litotes, conditionnel, Euphemismus, protokollarische Formeln
\u2022 Essayistisch: rhetor. Fragen, pers\xF6nliche Reflexion, aphoristische Zuspitzung

CAN-DO C2 (the user is learning these skills \u2014 your answers must MODEL them):
1. Nuancierte Argumentation mit Konzessivs\xE4tzen und Einschr\xE4nkungen
2. Akademisches Hedging: "Es lie\xDFe sich mit gewisser Berechtigung argumentieren..."
3. Stilistische Variation: Chiasmus, Klimax, Antithese in der Antwort demonstrieren
4. Intertextuelle Referenzen: Philosophen, Theorien, historische Parallelen zitieren
5. Register-Switching: zwischen Wissenschafts- und Feuilletonsprache wechseln`;
      enrichedBlockIds = /* @__PURE__ */ new Set();
      isEnriching = false;
      enrichTimer = null;
      console.log("[Enrichment] Module loaded \u2014 batched Text API delegation for <hint>/<answer>");
    }
  });

  // src/modules/chat/streaming-display.ts
  function createSelToolbar() {
    const tb = document.createElement("div");
    tb.id = "sel-toolbar";
    tb.innerHTML = `
        <button class="sel-btn sel-btn-tts" data-action="tts" title="\u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442">\u{1F50A} \u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C</button>
        <button class="sel-btn sel-btn-analyze" data-action="analyze" title="\u0420\u0430\u0437\u0431\u043E\u0440 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438">\u{1F4DD} \u0410\u043D\u0430\u043B\u0438\u0437 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438</button>
        <button class="sel-btn sel-btn-explain" data-action="explain" title="\u041E\u0431\u044A\u044F\u0441\u043D\u0438\u0442\u044C \u043A\u0430\u043A \u0434\u043B\u044F \u043D\u043E\u0432\u0438\u0447\u043A\u0430">\u{1F4A1} \u041E\u0431\u044C\u044F\u0441\u043D\u0438\u0442\u044C \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u043E</button>
    `;
    tb.addEventListener("click", async (e) => {
      const btn = e.target.closest(".sel-btn");
      if (!btn || !selectedTextForTTS)
        return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === "tts") {
        btn.textContent = "\u23F3 ...";
        try {
          const voice = document.getElementById("voice-select")?.value || "Zephyr";
          const Vocabulary2 = window.Vocabulary;
          await Vocabulary2?.speakText?.(selectedTextForTTS, voice);
          btn.textContent = "\u2705 \u0413\u043E\u0442\u043E\u0432\u043E";
          setTimeout(() => {
            btn.textContent = "\u{1F50A} \u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C";
          }, 1500);
        } catch {
          btn.textContent = "\u274C";
          setTimeout(() => {
            btn.textContent = "\u{1F50A} \u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C";
          }, 1500);
        }
      } else if (action === "analyze") {
        const textToAnalyze = selectedTextForTTS;
        hideSelToolbar();
        showAnalysisPanel("\u{1F4DD} \u0410\u043D\u0430\u043B\u0438\u0437 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438", textToAnalyze, "analyze");
      } else if (action === "explain") {
        const textToExplain = selectedTextForTTS;
        hideSelToolbar();
        showAnalysisPanel("\u{1F4A1} \u041E\u0431\u044A\u044F\u0441\u043D\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0449\u0438\u0445", textToExplain, "explain");
      }
    });
    tb.addEventListener("mousedown", (e) => {
      if (e.target.closest(".sel-btn")) {
        e.preventDefault();
      }
    });
    document.body.appendChild(tb);
    return tb;
  }
  async function showAnalysisPanel(title, text, mode) {
    closeAnalysisPanel();
    const overlay2 = document.createElement("div");
    overlay2.id = "sel-analysis-overlay";
    overlay2.addEventListener("click", closeAnalysisPanel);
    document.body.appendChild(overlay2);
    const panel = document.createElement("div");
    panel.id = "sel-analysis-panel";
    panel.innerHTML = `
        <div class="sel-panel-header">
            <span>${title}</span>
            <button class="sel-panel-close" title="\u0417\u0430\u043A\u0440\u044B\u0442\u044C">\xD7</button>
        </div>
        <div class="sel-panel-body">
            <div class="sel-panel-original">"${text}"</div>
            <div class="sel-panel-loading">\u{1F916} \u0410\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u044E...<br><small>\u041D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0435\u043A\u0443\u043D\u0434</small></div>
        </div>
    `;
    panel.querySelector(".sel-panel-close")?.addEventListener("click", closeAnalysisPanel);
    document.body.appendChild(panel);
    const level = localStorage.getItem("gemini_level") || "A1";
    const lang = localStorage.getItem("gemini_target_language") || "German";
    const nativeLang = localStorage.getItem("gemini_native_language") || "Russian";
    const apiKey = document.getElementById("api-key")?.value || localStorage.getItem("gemini_api_key") || "";
    const message = mode === "analyze" ? `\u0420\u0430\u0437\u0431\u0435\u0440\u0438 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0443 \u044D\u0442\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0430 \u043D\u0430 \u044F\u0437\u044B\u043A\u0435 ${lang} \u041E\u0427\u0415\u041D\u042C \u041F\u041E\u0414\u0420\u041E\u0411\u041D\u041E \u043D\u0430 \u044F\u0437\u044B\u043A\u0435 ${nativeLang}.
\u0414\u043B\u044F \u041A\u0410\u0416\u0414\u041E\u0413\u041E \u0441\u043B\u043E\u0432\u0430 \u0432 \u0442\u0435\u043A\u0441\u0442\u0435 \u043E\u0431\u044A\u044F\u0441\u043D\u0438:
- \u041A\u0430\u043A\u0430\u044F \u0447\u0430\u0441\u0442\u044C \u0440\u0435\u0447\u0438 (\u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435, \u0433\u043B\u0430\u0433\u043E\u043B, \u043F\u0440\u0435\u0434\u043B\u043E\u0433 \u0438 \u0442.\u0434.)
- \u041F\u0430\u0434\u0435\u0436 \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 \u0438\u043C\u0435\u043D\u043D\u043E \u044D\u0442\u043E\u0442 \u043F\u0430\u0434\u0435\u0436
- \u0410\u0440\u0442\u0438\u043A\u043B\u044C \u0438 \u043F\u043E\u0447\u0435\u043C\u0443 (\u0435\u0441\u043B\u0438 \u0435\u0441\u0442\u044C)
- \u0412\u0440\u0435\u043C\u044F \u0433\u043B\u0430\u0433\u043E\u043B\u0430 \u0438 \u0441\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u0435
- \u041F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u043B\u043E\u0432 \u2014 \u043F\u043E\u0447\u0435\u043C\u0443 \u0441\u043B\u043E\u0432\u0430 \u0441\u0442\u043E\u044F\u0442 \u0438\u043C\u0435\u043D\u043D\u043E \u0442\u0430\u043A
- \u041F\u0440\u0435\u0434\u043B\u043E\u0433\u0438 \u2014 \u0447\u0442\u043E \u043E\u043D\u0438 \u0442\u0440\u0435\u0431\u0443\u044E\u0442 (Akkusativ/Dativ \u0438 \u0442.\u0434.)
\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u0443\u0447\u0435\u043D\u0438\u043A\u0430: ${level}.
\u041E\u0422\u0412\u0415\u0427\u0410\u0419 \u0422\u041E\u041B\u042C\u041A\u041E \u041D\u0410 \u042F\u0417\u042B\u041A\u0415: ${nativeLang}!
\u0410\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u0435\u043C\u044B\u0439 \u0442\u0435\u043A\u0441\u0442: "${text}"` : `\u041E\u0431\u044A\u044F\u0441\u043D\u0438 \u044D\u0442\u043E\u0442 \u0442\u0435\u043A\u0441\u0442 \u043D\u0430 \u044F\u0437\u044B\u043A\u0435 ${lang} \u041A\u0410\u041A \u0414\u041B\u042F \u041F\u041E\u041B\u041D\u041E\u0413\u041E \u041D\u041E\u0412\u0418\u0427\u041A\u0410. \u041E\u0442\u0432\u0435\u0447\u0430\u0439 \u041D\u0410 \u042F\u0417\u042B\u041A\u0415: ${nativeLang}.
\u041F\u0440\u043E\u0441\u0442\u044B\u043C \u044F\u0437\u044B\u043A\u043E\u043C, \u0441 \u0430\u043D\u0430\u043B\u043E\u0433\u0438\u044F\u043C\u0438, \u043F\u0440\u0438\u043C\u0435\u0440\u0430\u043C\u0438 \u0438\u0437 \u0436\u0438\u0437\u043D\u0438. \u0411\u0435\u0437 \u0441\u043B\u043E\u0436\u043D\u044B\u0445 \u043B\u0438\u043D\u0433\u0432\u0438\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432.
\u041A\u0430\u043A \u0431\u0443\u0434\u0442\u043E \u043E\u0431\u044A\u044F\u0441\u043D\u044F\u0435\u0448\u044C 10-\u043B\u0435\u0442\u043D\u0435\u043C\u0443 \u0440\u0435\u0431\u0451\u043D\u043A\u0443 \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430\u0447\u0430\u043B \u0443\u0447\u0438\u0442\u044C \u044F\u0437\u044B\u043A.
\u0420\u0430\u0437\u043B\u043E\u0436\u0438 \u043A\u0430\u0436\u0434\u043E\u0435 \u0441\u043B\u043E\u0432\u043E \u0438 \u043A\u043E\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044E. \u041F\u0440\u0438\u0432\u0435\u0434\u0438 \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043F\u0440\u0438\u043C\u0435\u0440\u044B.
\u0423\u0440\u043E\u0432\u0435\u043D\u044C \u0443\u0447\u0435\u043D\u0438\u043A\u0430: ${level}.
\u041E\u0422\u0412\u0415\u0427\u0410\u0419 \u0422\u041E\u041B\u042C\u041A\u041E \u041D\u0410 \u042F\u0417\u042B\u041A\u0415: ${nativeLang}!
\u0422\u0435\u043A\u0441\u0442 \u0434\u043B\u044F \u043E\u0431\u044A\u044F\u0441\u043D\u0435\u043D\u0438\u044F: "${text}"`;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          message,
          custom_instructions: `\u0422\u044B \u2014 \u0443\u0447\u0438\u0442\u0435\u043B\u044C \u044F\u0437\u044B\u043A\u0430 ${lang}. \u0412\u0421\u0415\u0413\u0414\u0410 \u043E\u0442\u0432\u0435\u0447\u0430\u0439 \u043D\u0430 \u044F\u0437\u044B\u043A\u0435: ${nativeLang}. \u0410\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u0439 \u0422\u041E\u041B\u042C\u041A\u041E \u0442\u043E\u0442 \u0442\u0435\u043A\u0441\u0442, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0434\u0430\u043D. \u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u043B\u0438\u0448\u043D\u0435\u0439 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438. \u0411\u0443\u0434\u044C \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u044B\u043C \u0438 \u043F\u043E\u043B\u0435\u0437\u043D\u044B\u043C.`,
          context: []
        })
      });
      if (!response.ok)
        throw new Error("API error");
      const data = await response.json();
      const body = panel.querySelector(".sel-panel-body");
      if (!body)
        return;
      let html = (data.text || "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445").replace(/### (.*)/g, "<h4>$1</h4>").replace(/## (.*)/g, "<h3>$1</h3>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/`(.*?)`/g, "<code>$1</code>").replace(/\n- /g, "\n\u2022 ").replace(/\n/g, "<br>");
      body.innerHTML = `
            <div class="sel-panel-original">"${text}"</div>
            ${html}
        `;
      try {
        const historyObj = {
          title,
          text,
          html,
          timestamp: Date.now()
        };
        const rawHist = localStorage.getItem("gemini_analysis_history");
        let historyList = rawHist ? JSON.parse(rawHist) : [];
        historyList.unshift(historyObj);
        if (historyList.length > 20)
          historyList = historyList.slice(0, 20);
        localStorage.setItem("gemini_analysis_history", JSON.stringify(historyList));
        if (typeof window !== "undefined" && window.toggleCheatsheet) {
          window.toggleCheatsheet("history");
        }
      } catch (e) {
        console.error("Failed to save analysis history", e);
      }
    } catch {
      const body = panel.querySelector(".sel-panel-body");
      if (body)
        body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red)">\u274C \u041E\u0448\u0438\u0431\u043A\u0430. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.</div>';
    }
  }
  function closeAnalysisPanel() {
    document.getElementById("sel-analysis-overlay")?.remove();
    document.getElementById("sel-analysis-panel")?.remove();
  }
  function showSelToolbar(x, y) {
    if (!selToolbar)
      selToolbar = createSelToolbar();
    selToolbar.style.display = "flex";
    selToolbar.style.left = `${Math.max(10, Math.min(x, window.innerWidth - 280))}px`;
    selToolbar.style.top = `${y - 50}px`;
  }
  function hideSelToolbar() {
    if (selToolbar)
      selToolbar.style.display = "none";
    selectedTextForTTS = "";
  }
  var _StreamingDisplayModule, StreamingDisplayModule, StreamingDisplay, selToolbar, selectedTextForTTS, selStyle, handleSelection;
  var init_streaming_display = __esm({
    "src/modules/chat/streaming-display.ts"() {
      "use strict";
      init_chat_sessions();
      init_enrichment();
      _StreamingDisplayModule = class _StreamingDisplayModule {
        constructor() {
          this.streamingUserMsg = null;
          this.streamingAiMsg = null;
          this.userAccumulatedText = "";
          this.aiAccumulatedText = "";
          this.lastTextReceivedTime = 0;
          this.messageIdCounter = 0;
          this.scheduledWordIds = /* @__PURE__ */ new Set();
          // Track which words have karaoke scheduled
          this.spokenWordCount = 0;
          // Track how many words have been spoken (survives innerHTML re-renders)
          this.spokenWords = /* @__PURE__ */ new Set();
          // Track spoken word-texts for V3 karaoke (text-based, survives DOM resets)
          this.activeDialogueBlock = null;
          // Track which dialogue block bot is currently speaking about
          this.streamingStallTimer = null;
          // Detect bot stopping mid-stream
          // Persist across continuations:
          this.lastPromisedCount = 0;
          // e.g. "Вот 10 реплик" → 10, persists across messages
          this.totalDeliveredReplicas = 0;
          // accumulates replica count across continuations
          this.autoContinueTimer = null;
          // ========== AI THINKING VISUALIZATION ==========
          this.thinkingElement = null;
          this.thinkingText = "";
          // Track fade timer to avoid multiple fades
          this.thinkingFadeTimer = null;
        }
        /**
         * Detect the active dialogue block number from the CURRENT STREAMING BUBBLE's DOM.
         * This is ONLY a fallback source when regex matching fails during streaming.
         */
        detectActiveBlockFromDOM(bubble) {
          const blocks = bubble.querySelectorAll(".dialogue-block[data-dialogue-id]");
          if (blocks.length === 0)
            return null;
          const lastBlock = blocks[blocks.length - 1];
          const dlgId = lastBlock.getAttribute("data-dialogue-id") || "";
          const numMatch = dlgId.match(/(\d+)/);
          return numMatch ? parseInt(numMatch[1], 10) : blocks.length;
        }
        /**
         * Update streaming message with new content + karaoke highlighting
         */
        update(type, partialText, container2) {
          if (!container2)
            return;
          if (typeof window.clearWelcome === "function") {
            window.clearWelcome();
          }
          if (type === "user") {
            const userChunkWords = partialText.match(_StreamingDisplayModule.WORD_PATTERN) || [];
            this.userAccumulatedText += partialText;
            this.lastTextReceivedTime = Date.now();
            if (!this.streamingUserMsg) {
              this.streamingUserMsg = this.createMessageElement("user");
              container2.appendChild(this.streamingUserMsg);
            }
            const bubble = this.streamingUserMsg.querySelector(".message-bubble");
            bubble.textContent = this.userAccumulatedText;
            if (userChunkWords.length > 0) {
              this.highlightWordsInAnswers(userChunkWords, container2);
            }
          } else {
            if (!this.streamingAiMsg) {
              const aiMessages = container2.querySelectorAll(".message.ai");
              const lastMsg = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : null;
              if (lastMsg) {
                const lastBubble = lastMsg.querySelector(".message-bubble");
                const retryCount = window._autoContinueRetryCount || 0;
                if (retryCount > 0 && lastBubble) {
                  this.streamingAiMsg = lastMsg;
                  this.streamingAiMsg.classList.add("streaming");
                  const rawTextSpan = this.streamingAiMsg.dataset.text || "";
                  if (rawTextSpan.includes("REPLICA") || this.aiAccumulatedText === "") {
                    this.aiAccumulatedText = rawTextSpan;
                    console.log("[StreamingDisplay] \u{1F517} Re-attaching to previous AI message (Auto-Continue)");
                  }
                }
              }
            }
            if (!this.streamingAiMsg) {
              this.streamingAiMsg = this.createMessageElement("ai");
              container2.appendChild(this.streamingAiMsg);
              this.scheduledWordIds.clear();
              this.spokenWordCount = 0;
              this.spokenWords.clear();
              this.activeDialogueBlock = null;
            }
            const aiChunkWords = partialText.match(_StreamingDisplayModule.WORD_PATTERN) || [];
            const fullText = this.aiAccumulatedText + partialText;
            const replicaNumMatch = fullText.match(/(?:REPLICA|Реплика|Replik|Replica|вопрос|блок|диалог|block|question|pregunta|domanda|質問|문제)\s*(\d+)/i);
            if (replicaNumMatch) {
              this.activeDialogueBlock = parseInt(replicaNumMatch[1], 10);
            }
            if (this.activeDialogueBlock === null) {
              const standaloneNumMatch = fullText.match(/(?:^|\n)\s*\[?(\d{1,2})\]?\s*[.:)]\s/m);
              if (standaloneNumMatch) {
                const num = parseInt(standaloneNumMatch[1], 10);
                if (num >= 1 && num <= 20) {
                  this.activeDialogueBlock = num;
                }
              }
            }
            if (this.activeDialogueBlock === null) {
              const prefixMatch = fullText.match(/\[REPLICA\s+(\d+)\]/i);
              if (prefixMatch) {
                this.activeDialogueBlock = parseInt(prefixMatch[1], 10);
              }
            }
            if (this.activeDialogueBlock === null) {
              const streamBubble = this.streamingAiMsg.querySelector(".message-bubble");
              if (streamBubble) {
                const domBlock = this.detectActiveBlockFromDOM(streamBubble);
                if (domBlock !== null) {
                  this.activeDialogueBlock = domBlock;
                }
              }
            }
            if (this.activeDialogueBlock === null) {
              const ordinalMatch = fullText.match(/(ersten|zweiten|dritten|vierten|fünften|sechsten|siebten|achten|neunten|zehnten)\s+(?:Replik|Frage|Dialog)/i);
              if (ordinalMatch) {
                const ordinalMap = {
                  "ersten": 1,
                  "zweiten": 2,
                  "dritten": 3,
                  "vierten": 4,
                  "f\xFCnften": 5,
                  "sechsten": 6,
                  "siebten": 7,
                  "achten": 8,
                  "neunten": 9,
                  "zehnten": 10
                };
                this.activeDialogueBlock = ordinalMap[ordinalMatch[1].toLowerCase()] || null;
              }
            }
            if (this.activeDialogueBlock === null) {
              const ruOrdinalMatch = fullText.match(/(первый|первая|второй|вторая|третий|третья|четвёртый|четвертый|пятый|шестой|седьмой|восьмой|девятый|десятый)\s+(?:вопрос|реплика|блок)/i);
              if (ruOrdinalMatch) {
                const ruOrdinalMap = {
                  "\u043F\u0435\u0440\u0432\u044B\u0439": 1,
                  "\u043F\u0435\u0440\u0432\u0430\u044F": 1,
                  "\u0432\u0442\u043E\u0440\u043E\u0439": 2,
                  "\u0432\u0442\u043E\u0440\u0430\u044F": 2,
                  "\u0442\u0440\u0435\u0442\u0438\u0439": 3,
                  "\u0442\u0440\u0435\u0442\u044C\u044F": 3,
                  "\u0447\u0435\u0442\u0432\u0451\u0440\u0442\u044B\u0439": 4,
                  "\u0447\u0435\u0442\u0432\u0435\u0440\u0442\u044B\u0439": 4,
                  "\u043F\u044F\u0442\u044B\u0439": 5,
                  "\u0448\u0435\u0441\u0442\u043E\u0439": 6,
                  "\u0441\u0435\u0434\u044C\u043C\u043E\u0439": 7,
                  "\u0432\u043E\u0441\u044C\u043C\u043E\u0439": 8,
                  "\u0434\u0435\u0432\u044F\u0442\u044B\u0439": 9,
                  "\u0434\u0435\u0441\u044F\u0442\u044B\u0439": 10
                };
                this.activeDialogueBlock = ruOrdinalMap[ruOrdinalMatch[1].toLowerCase()] || null;
              }
            }
            if (this.activeDialogueBlock === null) {
              const quotedMatch = fullText.match(/(?:Реплика|вопрос|Replik|Frage|replica|question)\s+(?:был[аи]?|was|war)[:\s]*[\"„'«]([^\"„'»]+)/i);
              if (quotedMatch) {
                const quotedText = quotedMatch[1].trim().substring(0, 30);
                this.activeDialogueBlock = this.findBlockByContent(quotedText, container2);
              }
            }
            if (this.activeDialogueBlock === null) {
              const answerMatch = fullText.match(/(?:Вы\s+ответили|You\s+answered|Sie\s+antworteten)[:\s]*[\"„'«]([^\"„'»]+)/i);
              if (answerMatch) {
                const answerText = answerMatch[1].trim().substring(0, 30);
                this.activeDialogueBlock = this.findBlockByAnswerContent(answerText, container2);
              }
            }
            if (aiChunkWords.length > 0) {
              this.highlightBotSpeechInExistingContent(aiChunkWords, container2, this.activeDialogueBlock);
            }
            this.aiAccumulatedText += partialText;
            this.lastTextReceivedTime = Date.now();
            if (this.streamingStallTimer)
              clearTimeout(this.streamingStallTimer);
            const checkStall = () => {
              if (!this.streamingAiMsg || !this.aiAccumulatedText)
                return;
              const timeSinceLastChar = Date.now() - this.lastTextReceivedTime;
              const isPlaying = window.AudioPlayback?.getIsPlaying?.() || false;
              if (timeSinceLastChar >= 45e3 && !isPlaying) {
                console.warn("[StreamingDisplay] 45s Hard Kill! Audio stopped & API Stream dead. Forcing turn completion fallback!");
                const controller = window.WebSocketController;
                if (controller?.sendMessage) {
                  try {
                    const handler = controller.messageHandlers?.get("turn_complete");
                    if (handler)
                      handler({ type: "turn_complete" });
                  } catch (e) {
                    console.error("[StreamingDisplay] Failed to trigger manual turn complete", e);
                  }
                } else {
                  this.finalize("ai", "");
                  this.triggerEnrichment(true);
                }
                return;
              }
              if (timeSinceLastChar >= 5e3) {
                this.triggerEnrichment(false);
              }
              this.streamingStallTimer = setTimeout(checkStall, 5e3);
            };
            this.streamingStallTimer = setTimeout(checkStall, 5e3);
            const loader = document.querySelector(".continue-preloader");
            if (loader)
              loader.remove();
            const bubble = this.streamingAiMsg.querySelector(".message-bubble");
            const Vocabulary2 = window.Vocabulary;
            const rawText = this.aiAccumulatedText;
            let formattedHtml = Vocabulary2?.formatMessage?.(rawText) ?? this.escapeHtml(rawText);
            const revealedHints = /* @__PURE__ */ new Set();
            const revealedAnswers = /* @__PURE__ */ new Set();
            bubble.querySelectorAll(".hint-container").forEach((c) => {
              const id = c.id;
              if (id) {
                const hint = c.querySelector('[data-type="hint"]');
                const answer = c.querySelector('[data-type="answer"]');
                if (hint && !hint.classList.contains("hidden"))
                  revealedHints.add(id);
                if (answer && !answer.classList.contains("hidden"))
                  revealedAnswers.add(id);
              }
            });
            const savedEnrichedHints = /* @__PURE__ */ new Map();
            const savedTranslations = /* @__PURE__ */ new Map();
            bubble.querySelectorAll(".dialogue-block[data-dialogue-id]").forEach((block) => {
              const blockId = block.getAttribute("data-dialogue-id") || "";
              const hintContainer = block.querySelector(".hint-container[data-enriched]");
              if (hintContainer) {
                savedEnrichedHints.set(blockId, {
                  container: hintContainer,
                  blockId
                });
                hintContainer.remove();
              }
              const transBlock = block.querySelector(".translation-block, .translation");
              if (transBlock) {
                savedTranslations.set(blockId, transBlock);
                transBlock.remove();
              }
              const germanTtsBtn = block.querySelector(".german-tts-btn");
              if (germanTtsBtn) {
                savedTranslations.germanTtsBtns = savedTranslations.germanTtsBtns || /* @__PURE__ */ new Map();
                savedTranslations.germanTtsBtns.set(blockId, germanTtsBtn);
                germanTtsBtn.remove();
              }
            });
            const thinkingRef = this.thinkingElement;
            let savedThinkingScroll = 0;
            let thinkingWasOpen = false;
            if (thinkingRef) {
              const tc = thinkingRef.querySelector(".thought-content");
              if (tc)
                savedThinkingScroll = tc.scrollTop;
              thinkingWasOpen = thinkingRef.hasAttribute("open");
              if (thinkingRef.parentNode) {
                thinkingRef.parentNode.removeChild(thinkingRef);
              }
            }
            const chatContainer = document.getElementById("chat-messages");
            const pinned = window.isPinnedToBottom;
            const savedScrollTop = chatContainer ? chatContainer.scrollTop : 0;
            bubble.innerHTML = formattedHtml || "...";
            const isAudioActive = window.AudioPlayback?.getIsPlaying?.() || false;
            if (!isAudioActive && this.aiAccumulatedText.length > 50) {
              const pulse = document.createElement("div");
              pulse.className = "silence-pulse";
              pulse.innerHTML = "<i>\u23F3 \u0418\u0418 \u0444\u043E\u0440\u043C\u0443\u043B\u0438\u0440\u0443\u0435\u0442 \u0442\u0435\u043A\u0441\u0442 (\u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044F \u0430\u0443\u0434\u0438\u043E \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430)...</i>";
              pulse.style.color = "var(--text-muted)";
              pulse.style.fontSize = "0.85em";
              pulse.style.marginTop = "12px";
              pulse.style.padding = "8px 12px";
              pulse.style.borderLeft = "3px solid var(--primary)";
              pulse.style.backgroundColor = "var(--bg-tag)";
              pulse.style.borderRadius = "4px";
              pulse.style.animation = "pulse 2s infinite opacity";
              bubble.appendChild(pulse);
            }
            if (thinkingRef) {
              bubble.prepend(thinkingRef);
              if (thinkingWasOpen) {
                thinkingRef.setAttribute("open", "");
              } else {
                thinkingRef.removeAttribute("open");
              }
              const tc = thinkingRef.querySelector(".thought-content");
              if (tc) {
                tc.scrollTop = savedThinkingScroll;
              }
            }
            if (revealedHints.size > 0 || revealedAnswers.size > 0) {
              const revealFn = window.revealHint;
              if (revealFn) {
                revealedHints.forEach((id) => revealFn(id, "hint"));
                revealedAnswers.forEach((id) => revealFn(id, "answer"));
              }
            }
            if (savedEnrichedHints.size > 0) {
              savedEnrichedHints.forEach(({ container: container3, blockId }) => {
                const block = bubble.querySelector(`.dialogue-block[data-dialogue-id="${blockId}"]`);
                if (block) {
                  const freshHint = block.querySelector(".hint-container:not([data-enriched])");
                  if (freshHint)
                    freshHint.remove();
                  block.appendChild(container3);
                }
              });
            }
            if (savedTranslations.size > 0) {
              savedTranslations.forEach((transBlock, blockId) => {
                const block = bubble.querySelector(`.dialogue-block[data-dialogue-id="${blockId}"]`);
                if (block) {
                  const content = block.querySelector(".dialogue-content");
                  if (content) {
                    content.querySelectorAll(".translation-block, .translation").forEach((el) => el.remove());
                    content.insertAdjacentElement("afterbegin", transBlock);
                  }
                }
              });
            }
            if (savedTranslations.germanTtsBtns && savedTranslations.germanTtsBtns.size > 0) {
              savedTranslations.germanTtsBtns.forEach((ttsBtn, blockId) => {
                const block = bubble.querySelector(`.dialogue-block[data-dialogue-id="${blockId}"]`);
                if (block) {
                  const content = block.querySelector(".dialogue-content");
                  if (content) {
                    content.querySelectorAll(".german-tts-btn").forEach((el) => el.remove());
                    content.appendChild(ttsBtn);
                  }
                }
              });
            }
            if (chatContainer) {
              if (pinned) {
                chatContainer.scrollTop = chatContainer.scrollHeight;
              } else {
                chatContainer.scrollTop = savedScrollTop;
              }
            }
            try {
              const SKIP_CLASSES = ["translation", "translation-block", "translation-icon", "hint-text", "answer-text", "hint-container", "answer-container", "dialogue-header", "dialogue-number", "dialogue-speaker-label", "hint-btn", "tts-play-btn", "german-tts-btn", "hint-column", "hint-panel", "answer-item", "answer-list", "answer-header", "hint-header", "hint-list", "hint-item", "thought-details", "ai-thinking-inline", "thought-title", "thought-content", "karaoke-word"];
              const wrapTextNodes = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                  const text = node.textContent || "";
                  if (text.trim()) {
                    const wrapper = document.createDocumentFragment();
                    let wordIdx = 0;
                    const parts = text.split(/(\s+)/);
                    parts.forEach((part) => {
                      if (part.trim()) {
                        const span = document.createElement("span");
                        span.className = "karaoke-word";
                        span.id = `kw-${Date.now()}-${wordIdx++}`;
                        span.textContent = part;
                        wrapper.appendChild(span);
                      } else if (part) {
                        wrapper.appendChild(document.createTextNode(part));
                      }
                    });
                    node.parentNode?.replaceChild(wrapper, node);
                  }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                  const el = node;
                  if (!SKIP_CLASSES.some((cls) => el.classList.contains(cls))) {
                    Array.from(node.childNodes).forEach((child) => wrapTextNodes(child));
                  }
                }
              };
              const dialogueContents = bubble.querySelectorAll(".dialogue-content");
              if (dialogueContents.length > 0) {
                dialogueContents.forEach((dc) => {
                  Array.from(dc.childNodes).forEach((child) => wrapTextNodes(child));
                });
              } else {
                Array.from(bubble.childNodes).forEach((child) => wrapTextNodes(child));
              }
              const allKaraokeWords = bubble.querySelectorAll(".karaoke-word");
              const totalWrappedWords = allKaraokeWords.length;
              if (totalWrappedWords > 0) {
                allKaraokeWords.forEach((span) => {
                  const wordText = (span.textContent || "").toLowerCase().replace(/[.,!?:;'"()]/g, "");
                  if (this.spokenWords.has(wordText)) {
                    span.classList.add("karaoke-spoken");
                  }
                });
                const chunkWordTexts = aiChunkWords.map((w) => w.toLowerCase().replace(/[.,!?:;'"()]/g, "")).filter((w) => w.length > 1);
                if (chunkWordTexts.length > 0) {
                  const AudioPlayback2 = window.AudioPlayback;
                  const audioBufferDelayMs = AudioPlayback2?.getAudioDelay?.() || 0;
                  const AUDIO_CHUNK_DURATION_MS = 500;
                  const msPerWord = chunkWordTexts.length > 0 ? AUDIO_CHUNK_DURATION_MS / chunkWordTexts.length : 200;
                  const baseDelayMs = Math.max(audioBufferDelayMs, 100);
                  chunkWordTexts.forEach((wordText, i) => {
                    const wordDelay = baseDelayMs + i * msPerWord;
                    const capturedWordText = wordText;
                    setTimeout(() => {
                      try {
                        this.spokenWords.add(capturedWordText);
                        if (!this.streamingAiMsg)
                          return;
                        const freshBubble = this.streamingAiMsg.querySelector(".message-bubble");
                        if (!freshBubble)
                          return;
                        const allWords = freshBubble.querySelectorAll(".karaoke-word");
                        let span = null;
                        for (const w of allWords) {
                          const wText = (w.textContent || "").toLowerCase().replace(/[.,!?:;'"()]/g, "");
                          if (wText === capturedWordText && !w.classList.contains("karaoke-active")) {
                            span = w;
                            break;
                          }
                        }
                        if (!span) {
                          for (const w of allWords) {
                            if (!w.classList.contains("karaoke-spoken") && !w.classList.contains("karaoke-active")) {
                              span = w;
                              break;
                            }
                          }
                        }
                        if (!span)
                          return;
                        span.classList.add("karaoke-active");
                        span.classList.add("karaoke-spoken");
                        this.spokenWordCount = Math.max(this.spokenWordCount, Array.from(allWords).indexOf(span) + 1);
                        const scrollFollowEnabled = window.scrollFollowMode !== false;
                        const chatContainer2 = document.getElementById("chat-messages");
                        if (scrollFollowEnabled && chatContainer2) {
                          const containerRect = chatContainer2.getBoundingClientRect();
                          const spanRect = span.getBoundingClientRect();
                          const viewportBottom = containerRect.top + containerRect.height * 0.7;
                          if (spanRect.top > viewportBottom || spanRect.bottom < containerRect.top + 50) {
                            chatContainer2.scrollTo({
                              top: chatContainer2.scrollTop + (spanRect.top - containerRect.top) - containerRect.height * 0.3,
                              behavior: "smooth"
                            });
                          }
                        }
                        setTimeout(() => {
                          span.classList.remove("karaoke-active");
                        }, 300);
                        const dialogueBlock = span.closest(".dialogue-block");
                        if (dialogueBlock) {
                          freshBubble.querySelectorAll(".dialogue-block-active").forEach((el) => el.classList.remove("dialogue-block-active"));
                          dialogueBlock.classList.add("dialogue-block-active");
                        }
                      } catch (e) {
                      }
                    }, wordDelay);
                  });
                }
              }
            } catch (karaokeErr) {
              console.warn("[StreamingDisplay] Karaoke wrapping error (non-fatal):", karaokeErr);
            }
          }
        }
        /**
         * Highlight words in existing answer blocks that match what AI is speaking
         */
        highlightWordsInAnswers(chunkWords, container2) {
          const answerElements = container2.querySelectorAll(".message:not(.streaming) .answer-german");
          const wordsToHighlight = chunkWords.map((w) => w.toLowerCase().replace(/[.,!?:;'"()]/g, "")).filter((w) => w.length > 1);
          if (wordsToHighlight.length === 0)
            return;
          answerElements.forEach((el) => {
            const htmlEl = el;
            if (!htmlEl.dataset.karaokeWrapped) {
              const text = htmlEl.textContent || "";
              const wrappedHtml = text.replace(
                /([\p{L}\p{M}]+)/gu,
                '<span class="karaoke-answer-word" data-word="$1">$1</span>'
              );
              htmlEl.innerHTML = wrappedHtml;
              htmlEl.dataset.karaokeWrapped = "true";
            }
            htmlEl.querySelectorAll(".karaoke-answer-word").forEach((span) => {
              const wordData = span.dataset.word?.toLowerCase() || "";
              if (wordsToHighlight.includes(wordData)) {
                span.classList.add("active");
                setTimeout(() => {
                  span.classList.remove("active");
                }, 600);
              }
            });
          });
        }
        /**
         * Find dialogue block number by matching content text
         * Used when bot says "Реплика была: 'Some text...'" without explicit number
         */
        findBlockByContent(searchText, container2) {
          const dialogueBlocks = container2.querySelectorAll(".message:not(.streaming) .dialogue-block");
          const normalizedSearch = searchText.toLowerCase().replace(/[.,!?:;'"()„"]/g, "");
          for (let i = 0; i < dialogueBlocks.length; i++) {
            const block = dialogueBlocks[i];
            const content = block.querySelector(".dialogue-content");
            if (content) {
              const blockText = (content.textContent || "").toLowerCase().replace(/[.,!?:;'"()„"]/g, "");
              if (blockText.includes(normalizedSearch) || normalizedSearch.includes(blockText.substring(0, 20))) {
                const numberEl = block.querySelector(".dialogue-number");
                const num = parseInt(numberEl?.textContent?.replace(/\D/g, "") || "0", 10);
                if (num > 0)
                  return num;
                return i + 1;
              }
            }
          }
          return null;
        }
        /**
         * Find dialogue block number by matching answer content
         * Used when bot says "Вы ответили: 'Some answer...'" and we need to find the block
         */
        findBlockByAnswerContent(searchText, container2) {
          const dialogueBlocks = container2.querySelectorAll(".message:not(.streaming) .dialogue-block");
          const normalizedSearch = searchText.toLowerCase().replace(/[.,!?:;'"()„"]/g, "");
          for (let i = 0; i < dialogueBlocks.length; i++) {
            const block = dialogueBlocks[i];
            const answerElements = block.querySelectorAll(".answer-german");
            for (const answerEl of answerElements) {
              const answerText = (answerEl.textContent || "").toLowerCase().replace(/[.,!?:;'"()„"]/g, "");
              if (answerText.includes(normalizedSearch) || normalizedSearch.includes(answerText.substring(0, 20))) {
                const numberEl = block.querySelector(".dialogue-number");
                const num = parseInt(numberEl?.textContent?.replace(/\D/g, "") || "0", 10);
                if (num > 0)
                  return num;
                return i + 1;
              }
            }
          }
          return null;
        }
        /**
         * Highlight words in EXISTING content when bot speaks (repeats question or says answer)
         * This handles the "response phase" when bot is not streaming NEW text, but speaking existing content
         * @param targetBlockNumber - If provided, only highlight in this specific dialogue block (1-indexed)
         */
        highlightBotSpeechInExistingContent(chunkWords, container2, targetBlockNumber = null) {
          const wordsToHighlight = chunkWords.map((w) => w.toLowerCase().replace(/[.,!?:;'"()„"]/g, "")).filter((w) => w.length > 1);
          if (wordsToHighlight.length === 0)
            return;
          const previousDialogueContents = container2.querySelectorAll(".message:not(.streaming) .dialogue-content");
          previousDialogueContents.forEach((dc) => {
            if (targetBlockNumber !== null) {
              const dialogueBlock = dc.closest(".dialogue-block");
              if (dialogueBlock) {
                const numberEl = dialogueBlock.querySelector(".dialogue-number");
                const blockNum = parseInt(numberEl?.textContent?.replace(/\D/g, "") || "0", 10);
                if (blockNum !== targetBlockNumber) {
                  return;
                }
              }
            }
            const karaokeWords = dc.querySelectorAll(".karaoke-word");
            karaokeWords.forEach((span) => {
              const wordText = (span.textContent || "").toLowerCase().replace(/[.,!?:;'"()„"]/g, "");
              if (wordsToHighlight.includes(wordText)) {
                span.classList.add("karaoke-active");
                span.classList.add("karaoke-spoken");
                setTimeout(() => {
                  span.classList.remove("karaoke-active");
                }, 400);
                const dialogueBlock = span.closest(".dialogue-block");
                if (dialogueBlock) {
                  dialogueBlock.classList.add("dialogue-block-active");
                  setTimeout(() => {
                    dialogueBlock.classList.remove("dialogue-block-active");
                  }, 600);
                }
              }
            });
          });
          const answerElements = container2.querySelectorAll(".message:not(.streaming) .answer-german");
          answerElements.forEach((el) => {
            const htmlEl = el;
            if (!htmlEl.dataset.karaokeWrapped) {
              const text = htmlEl.textContent || "";
              const wrappedHtml = text.replace(
                /([\p{L}\p{M}]+)/gu,
                '<span class="karaoke-answer-word" data-word="$1">$1</span>'
              );
              htmlEl.innerHTML = wrappedHtml;
              htmlEl.dataset.karaokeWrapped = "true";
            }
            htmlEl.querySelectorAll(".karaoke-answer-word").forEach((span) => {
              const wordData = span.dataset.word?.toLowerCase() || "";
              if (wordsToHighlight.includes(wordData)) {
                span.classList.add("active");
                span.classList.add("karaoke-bot-speaking");
                setTimeout(() => {
                  span.classList.remove("active");
                  span.classList.remove("karaoke-bot-speaking");
                }, 400);
              }
            });
          });
        }
        /**
         * Finalize streaming message
         */
        finalize(type, finalText) {
          const msgId = `msg_${++this.messageIdCounter}`;
          const chatId = getCurrentChatId();
          if (type === "user" && this.streamingUserMsg) {
            const text = finalText.trim() || this.userAccumulatedText.trim();
            this.finalizeElement(this.streamingUserMsg, msgId, this.escapeHtml(text));
            this.streamingUserMsg = null;
            this.userAccumulatedText = "";
            if (chatId && text) {
              saveMessage(chatId, "user", text);
            }
          } else if (type === "ai" && this.streamingAiMsg) {
            if (finalText === "__METADATA_APPLIED__") {
              console.log("[StreamingDisplay] \u{1F6E1}\uFE0F Finalizing with DOM preservation \u2014 metadata already applied");
              const msgId2 = `msg_${this.messageIdCounter}`;
              this.streamingAiMsg.classList.remove("streaming");
              this.streamingAiMsg.id = msgId2;
              this.fadeOutThinking();
              this.streamingAiMsg = null;
              this._lastFinalizedAiText = this.aiAccumulatedText;
              this.aiAccumulatedText = "";
              return;
            }
            const text = finalText.trim() || this.aiAccumulatedText.trim();
            const AudioPlayback2 = window.AudioPlayback;
            const chunksPlayed = AudioPlayback2?.chunksPlayed || 0;
            const isMissingAudio = text.length > 500 && chunksPlayed < 20;
            if (isMissingAudio) {
              console.warn(`[StreamingDisplay] \u{1F507} Voice AI Mute detected! Text: ${text.length} chars, Audio Chunks: ${chunksPlayed}. Forcing Auto-TTS Fallback...`);
              setTimeout(() => {
                const Vocabulary3 = window.Vocabulary;
                if (Vocabulary3?.speakText) {
                  const cleanText = Vocabulary3.cleanForTTS ? Vocabulary3.cleanForTTS(text) : text;
                  if (cleanText.length > 10)
                    Vocabulary3.speakText(cleanText);
                }
              }, 800);
            }
            const Vocabulary2 = window.Vocabulary;
            const formatted = Vocabulary2?.formatMessage?.(text) ?? text;
            this.fadeOutThinking();
            this.finalizeElement(this.streamingAiMsg, msgId, formatted);
            if (chatId) {
              const bubble = this.streamingAiMsg?.querySelector(".message-bubble");
              if (bubble)
                saveMessage(chatId, "ai", bubble.innerHTML);
            }
            Vocabulary2?.extractAndLog?.(text);
            if (typeof window.checkSceneCompletion === "function") {
              window.checkSceneCompletion(text);
            }
            if (this.streamingStallTimer) {
              clearTimeout(this.streamingStallTimer);
              this.streamingStallTimer = null;
            }
            this.checkIncompleteReplicas(this.streamingAiMsg, text);
            this.streamingAiMsg = null;
            this._lastFinalizedAiText = this.aiAccumulatedText;
            this.aiAccumulatedText = "";
          } else if (typeof window.addMessage === "function") {
            window.addMessage(type, finalText);
          }
        }
        createMessageElement(type) {
          const el = document.createElement("div");
          el.className = `message ${type} streaming`;
          el.innerHTML = type === "user" ? _StreamingDisplayModule.MSG_TEMPLATE_USER : _StreamingDisplayModule.MSG_TEMPLATE_AI;
          return el;
        }
        finalizeElement(el, msgId, content) {
          el.classList.remove("streaming");
          el.id = msgId;
          el.dataset.text = content;
          const bubble = el.querySelector(".message-bubble");
          if (bubble && content) {
            const thinkingEl = bubble.querySelector(".thought-details");
            if (thinkingEl && thinkingEl.parentNode) {
              thinkingEl.parentNode.removeChild(thinkingEl);
            }
            const savedEnhancements = /* @__PURE__ */ new Map();
            bubble.querySelectorAll(".dialogue-block").forEach((block) => {
              const id = block.getAttribute("data-dialogue-id");
              if (!id)
                return;
              const enhancements = [];
              block.querySelectorAll(".hint-container, .enrichment-loader, .translation-block, .translation, .german-tts-btn").forEach((enhancedNode) => {
                enhancements.push(enhancedNode);
                if (enhancedNode.parentNode)
                  enhancedNode.parentNode.removeChild(enhancedNode);
              });
              if (enhancements.length > 0) {
                savedEnhancements.set(id, enhancements);
              }
            });
            bubble.innerHTML = content + `<div class="message-actions-inline"><button class="tts-btn" onclick="StreamingDisplay.speak('${msgId}')" title="Read aloud">\u{1F508}</button></div>`;
            savedEnhancements.forEach((enhancements, id) => {
              const newBlock = bubble.querySelector(`.dialogue-block[data-dialogue-id="${id}"]`);
              if (newBlock) {
                enhancements.forEach((node) => {
                  if (node.classList.contains("translation-block") || node.classList.contains("translation")) {
                    const contentDiv = newBlock.querySelector(".dialogue-content");
                    if (contentDiv) {
                      contentDiv.querySelectorAll(".translation-block, .translation").forEach((el2) => el2.remove());
                      contentDiv.insertAdjacentElement("afterbegin", node);
                    }
                  } else if (node.classList.contains("german-tts-btn")) {
                    const contentDiv = newBlock.querySelector(".dialogue-content");
                    if (contentDiv) {
                      contentDiv.querySelectorAll(".german-tts-btn").forEach((el2) => el2.remove());
                      const transNode = contentDiv.querySelector(".translation-block, .translation");
                      if (transNode) {
                        contentDiv.insertBefore(node, transNode);
                      } else {
                        contentDiv.appendChild(node);
                      }
                    }
                  } else {
                    if (node.classList.contains("hint-container")) {
                      const alreadyHasHint = newBlock.querySelector(".hint-container") !== null;
                      if (alreadyHasHint) {
                        console.log(`[StreamingDisplay] \u{1F6E1}\uFE0F Dropped duplicate rescued hint for block ${id} because a new one was just parsed.`);
                        return;
                      }
                    }
                    newBlock.appendChild(node);
                  }
                });
              }
            });
            if (thinkingEl) {
              bubble.prepend(thinkingEl);
            }
            this.wrapDialogueWordsForKaraoke(bubble);
          } else if (bubble && !content) {
            el.style.display = "none";
          }
        }
        /**
         * Wrap words in .dialogue-content elements with .karaoke-word spans
         * Used both during streaming and after finalize to enable karaoke highlighting
         */
        wrapDialogueWordsForKaraoke(bubble) {
          const SKIP_CLASSES = ["translation", "translation-block", "translation-icon", "hint-text", "answer-text", "hint-container", "answer-container", "dialogue-header", "dialogue-number", "dialogue-speaker-label", "hint-btn", "tts-play-btn", "german-tts-btn", "hint-column", "hint-panel", "answer-item", "answer-list", "answer-header", "hint-header", "hint-list", "hint-item", "karaoke-word"];
          const wrapTextNodes = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent || "";
              if (text.trim()) {
                const wrapper = document.createDocumentFragment();
                let wordIdx = 0;
                const parts = text.split(/(\s+)/);
                parts.forEach((part) => {
                  if (part.trim()) {
                    const span = document.createElement("span");
                    span.className = "karaoke-word";
                    span.id = `kw-${Date.now()}-${wordIdx++}`;
                    span.textContent = part;
                    wrapper.appendChild(span);
                  } else if (part) {
                    wrapper.appendChild(document.createTextNode(part));
                  }
                });
                node.parentNode?.replaceChild(wrapper, node);
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;
              if (!SKIP_CLASSES.some((cls) => el.classList.contains(cls))) {
                Array.from(node.childNodes).forEach((child) => wrapTextNodes(child));
              }
            }
          };
          const dialogueContents = bubble.querySelectorAll(".dialogue-content");
          if (dialogueContents.length > 0) {
            dialogueContents.forEach((dc) => {
              Array.from(dc.childNodes).forEach((child) => wrapTextNodes(child));
            });
          }
        }
        /**
         * TTS Playback with karaoke word highlighting
         */
        async speak(msgId) {
          const el = document.getElementById(msgId);
          if (!el)
            return;
          const rawText = el.dataset.text || el.textContent || "";
          if (!rawText)
            return;
          const voice = document.getElementById("voice-select")?.value || "Zephyr";
          const Vocabulary2 = window.Vocabulary;
          const button = el.querySelector(".tts-btn");
          if (button)
            button.textContent = "\u23F3";
          const bubble = el.querySelector(".message-bubble");
          if (bubble) {
            this.wrapDialogueWordsForKaraoke(bubble);
            const words = [];
            bubble.querySelectorAll(".dialogue-content .karaoke-word").forEach((span) => {
              const w = (span.textContent || "").trim();
              if (w.length > 1)
                words.push(w);
            });
            if (words.length > 0) {
              const MS_PER_WORD = 380;
              words.forEach((word, i) => {
                setTimeout(() => {
                  const freshBubble = el.querySelector(".message-bubble");
                  if (!freshBubble)
                    return;
                  for (const span of freshBubble.querySelectorAll(".dialogue-content .karaoke-word")) {
                    if ((span.textContent || "").trim() === word && !span.classList.contains("karaoke-tts-done")) {
                      span.classList.add("karaoke-active", "karaoke-tts-done");
                      const dBlock = span.closest(".dialogue-block");
                      if (dBlock) {
                        freshBubble.querySelectorAll(".dialogue-block-active").forEach((b) => b.classList.remove("dialogue-block-active"));
                        dBlock.classList.add("dialogue-block-active");
                      }
                      setTimeout(() => span.classList.remove("karaoke-active"), 350);
                      break;
                    }
                  }
                }, i * MS_PER_WORD);
              });
              setTimeout(() => {
                el.querySelectorAll(".dialogue-block-active").forEach((b) => b.classList.remove("dialogue-block-active"));
                el.querySelectorAll(".karaoke-tts-done").forEach((b) => b.classList.remove("karaoke-tts-done"));
              }, words.length * MS_PER_WORD + 500);
            }
          }
          try {
            await Vocabulary2?.speakText?.(rawText, voice);
            if (button)
              button.textContent = "\u{1F508}";
          } catch (e) {
            console.error("[StreamingDisplay] TTS failed:", e);
            if (button)
              button.textContent = "\u274C";
            setTimeout(() => {
              if (button)
                button.textContent = "\u{1F508}";
            }, 2e3);
          }
        }
        /**
         * Display AI thinking/reasoning process inline inside the current AI message
         * Creates a collapsible <details> block above the response text
         */
        updateThinking(text, container2) {
          if (!container2)
            return;
          this.thinkingText += text;
          if (!this.streamingAiMsg) {
            if (this.thinkingElement) {
              this.fadeOutThinking();
            }
            const aiMessages = container2.querySelectorAll(".message.ai");
            const lastMsg = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : null;
            if (lastMsg) {
              const retryCount = window._autoContinueRetryCount || 0;
              if (retryCount > 0 && lastMsg.querySelector(".message-bubble")) {
                this.streamingAiMsg = lastMsg;
                this.streamingAiMsg.classList.add("streaming");
                const rawTextSpan = this.streamingAiMsg.dataset.text || "";
                if (rawTextSpan.includes("REPLICA") || this.aiAccumulatedText === "") {
                  this.aiAccumulatedText = rawTextSpan;
                  console.log("[StreamingDisplay] \u{1F517} Re-attaching to previous AI message via Thoughts (Auto-Continue)");
                }
              }
            }
            if (!this.streamingAiMsg) {
              this.streamingAiMsg = this.createMessageElement("ai");
              container2.appendChild(this.streamingAiMsg);
            }
          }
          const bubble = this.streamingAiMsg.querySelector(".message-bubble");
          if (!bubble)
            return;
          if (!this.thinkingElement) {
            this.thinkingElement = document.createElement("details");
            this.thinkingElement.className = "thought-details ai-thinking-inline";
            this.thinkingElement.innerHTML = `
                <summary class="thought-title" style="cursor: pointer; font-size: 0.85em; opacity: 0.7; margin-bottom: 8px; user-select: none;">\u{1F914} Gemini \u0434\u0443\u043C\u0430\u0435\u0442 (\u0440\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C/\u0441\u0432\u0435\u0440\u043D\u0443\u0442\u044C)...</summary>
                <div class="thought-content" style="white-space: pre-wrap; font-family: monospace; font-size: 0.8em; opacity: 0.75; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-bottom: 15px; max-height: 200px; overflow-y: auto;"></div>
            `;
            this.thinkingElement.addEventListener("toggle", () => {
              if (this.thinkingElement?.classList.contains("thinking-complete"))
                return;
              const summary = this.thinkingElement?.querySelector(".thought-title");
              if (summary) {
                if (this.thinkingElement?.hasAttribute("open")) {
                  summary.textContent = `\u{1F914} Gemini \u0434\u0443\u043C\u0430\u0435\u0442 (\u0441\u0432\u0435\u0440\u043D\u0443\u0442\u044C)...`;
                } else {
                  const lines = this.thinkingText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
                  let latestLine = lines.length > 0 ? lines[lines.length - 1] : "Gemini \u0434\u0443\u043C\u0430\u0435\u0442...";
                  latestLine = latestLine.replace(/\*\*/g, "");
                  if (latestLine.length > 50)
                    latestLine = latestLine.substring(0, 47) + "...";
                  summary.textContent = `\u{1F914} ${latestLine}`;
                }
              }
            });
            bubble.prepend(this.thinkingElement);
          }
          const content = this.thinkingElement.querySelector(".thought-content");
          if (content) {
            const wasAtBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 30;
            content.appendChild(document.createTextNode(text));
            if (wasAtBottom) {
              content.scrollTop = content.scrollHeight;
            }
            const summary = this.thinkingElement.querySelector(".thought-title");
            if (summary && !this.thinkingElement.hasAttribute("open")) {
              const lines = this.thinkingText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
              let latestLine = lines.length > 0 ? lines[lines.length - 1] : "Gemini \u0434\u0443\u043C\u0430\u0435\u0442...";
              latestLine = latestLine.replace(/\*\*/g, "");
              if (latestLine.length > 50)
                latestLine = latestLine.substring(0, 47) + "...";
              summary.textContent = `\u{1F914} ${latestLine}`;
            } else if (summary && this.thinkingElement.hasAttribute("open") && summary.textContent !== "\u{1F914} Gemini \u0434\u0443\u043C\u0430\u0435\u0442 (\u0441\u0432\u0435\u0440\u043D\u0443\u0442\u044C)...") {
              summary.textContent = `\u{1F914} Gemini \u0434\u0443\u043C\u0430\u0435\u0442 (\u0441\u0432\u0435\u0440\u043D\u0443\u0442\u044C)...`;
            }
          }
        }
        /**
         * Clear thinking state (reset reference but keep collapsed element in message)
         */
        clearThinking() {
          if (this.thinkingElement && !this.thinkingElement.closest(".message:not(.streaming)")) {
            this.thinkingElement.remove();
          }
          this.thinkingElement = null;
          this.thinkingText = "";
        }
        /**
         * Mark thinking as complete — collapse the details and update summary
         */
        fadeOutThinking() {
          if (!this.thinkingElement)
            return;
          if (this.thinkingElement.classList.contains("thinking-complete"))
            return;
          this.thinkingElement.classList.add("thinking-complete");
          this.thinkingElement.removeAttribute("open");
          const summary = this.thinkingElement.querySelector(".thought-title");
          if (summary)
            summary.textContent = "\u{1F9E0} \u041C\u044B\u0441\u043B\u0438";
          this.thinkingElement.style.opacity = "0.7";
          this.thinkingElement = null;
          this.thinkingText = "";
        }
        /**
         * Check if bot promised N replicas but delivered fewer.
         * Shows a warning banner if incomplete.
         * Uses HIGHEST replica number found (not accumulation) to avoid double-counting.
         */
        checkIncompleteReplicas(msgElement, rawText) {
          if (!msgElement)
            return;
          const wordToNum = {
            "drei": 3,
            "vier": 4,
            "f\xFCnf": 5,
            "sechs": 6,
            "sieben": 7,
            "acht": 8,
            "neun": 9,
            "zehn": 10,
            "elf": 11,
            "zw\xF6lf": 12,
            "\u0442\u0440\u0438": 3,
            "\u0447\u0435\u0442\u044B\u0440\u0435": 4,
            "\u043F\u044F\u0442\u044C": 5,
            "\u0448\u0435\u0441\u0442\u044C": 6,
            "\u0441\u0435\u043C\u044C": 7,
            "\u0432\u043E\u0441\u0435\u043C\u044C": 8,
            "\u0434\u0435\u0432\u044F\u0442\u044C": 9,
            "\u0434\u0435\u0441\u044F\u0442\u044C": 10,
            "\u043E\u0434\u0438\u043D\u043D\u0430\u0434\u0446\u0430\u0442\u044C": 11,
            "\u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C": 12,
            "three": 3,
            "four": 4,
            "five": 5,
            "six": 6,
            "seven": 7,
            "eight": 8,
            "nine": 9,
            "ten": 10,
            "eleven": 11,
            "twelve": 12
          };
          const wordNumPattern = Object.keys(wordToNum).join("|");
          const keywords = "\u0440\u0435\u043F\u043B\u0438\u043A|\u0432\u043E\u043F\u0440\u043E\u0441|Repliken|Replik|Fragen|Frage|questions|replies|replicas|Kontexte|Kontexten|Situationen|\u0441\u0438\u0442\u0443\u0430\u0446\u0438\u0439|\u0441\u0438\u0442\u0443\u0430\u0446\u0438\u0438|scenarios|situations";
          let promisedInThisMessage = 0;
          const digitMatch = rawText.match(new RegExp(`(\\d+)\\s+(?:\\S+\\s+){0,3}(?:${keywords})`, "i"));
          if (digitMatch) {
            promisedInThisMessage = parseInt(digitMatch[1], 10);
          }
          if (!promisedInThisMessage) {
            const wordMatch = rawText.match(new RegExp(`(${wordNumPattern})\\s+(?:\\S+\\s+){0,3}(?:${keywords})`, "i"));
            if (wordMatch) {
              promisedInThisMessage = wordToNum[wordMatch[1].toLowerCase()] || 0;
            }
          }
          if (promisedInThisMessage >= 3 && promisedInThisMessage !== this.lastPromisedCount) {
            this.lastPromisedCount = promisedInThisMessage;
            this.totalDeliveredReplicas = 0;
          } else if (promisedInThisMessage >= 3) {
            this.lastPromisedCount = promisedInThisMessage;
          }
          if (this.lastPromisedCount < 3)
            return;
          const chatContainer = document.getElementById("chat-messages");
          let highestReplicaNum = 0;
          if (chatContainer) {
            const allMsgs = Array.from(chatContainer.querySelectorAll(".message"));
            let lastUserIdx = -1;
            allMsgs.forEach((msg, i) => {
              if (msg.classList.contains("user"))
                lastUserIdx = i;
            });
            const currentBatchAI = allMsgs.slice(lastUserIdx + 1).filter((msg) => msg.classList.contains("ai"));
            let totalBlocks = 0;
            currentBatchAI.forEach((msg) => {
              const blocks = msg.querySelectorAll(".dialogue-block[data-dialogue-id]");
              blocks.forEach((block) => {
                totalBlocks++;
                const dialogueId = block.getAttribute("data-dialogue-id") || "";
                const numMatch = dialogueId.match(/(\d+)/);
                if (numMatch) {
                  const num = parseInt(numMatch[1], 10);
                  if (num > highestReplicaNum)
                    highestReplicaNum = num;
                }
              });
            });
            console.log(`[IncompleteReplicas] DEBUG: totalMsgs=${allMsgs.length}, lastUserIdx=${lastUserIdx}, currentBatchAI=${currentBatchAI.length}, dialogueBlocks=${totalBlocks}, highestId=${highestReplicaNum}`);
          }
          this.totalDeliveredReplicas = Math.max(this.totalDeliveredReplicas, highestReplicaNum);
          console.log(`[IncompleteReplicas] Promised=${this.lastPromisedCount}, HighestNum=${highestReplicaNum}, Total=${this.totalDeliveredReplicas}`);
          if (this.totalDeliveredReplicas >= this.lastPromisedCount && this.lastPromisedCount > 0) {
            console.log(`[IncompleteReplicas] All ${this.lastPromisedCount} replicas delivered!`);
          }
        }
        triggerEnrichment(isTurnComplete = false) {
          setTimeout(() => {
            if (typeof window.enrichDialogueBlocks === "function") {
              window.enrichDialogueBlocks(isTurnComplete);
            } else {
              Promise.resolve().then(() => (init_enrichment(), enrichment_exports)).then((m) => m.enrichDialogueBlocks(isTurnComplete));
            }
          }, 500);
        }
        checkAutoContinue(ws, text) {
          if (!ws || ws.readyState !== WebSocket.OPEN)
            return;
          const cleanText = text.trim();
          if (!cleanText)
            return;
          const isDialogue = cleanText.includes("REPLICA") || cleanText.includes("dialogue-content");
          const endsWithPunctuation = /[.!?»"'](\s*<\/div>)*$/.test(cleanText);
          const isTooShort = cleanText.length < 50 && isDialogue;
          const missedMetadata = isDialogue && window._didReceiveMetadataForCurrentTurn === false;
          if (isDialogue && (!endsWithPunctuation || isTooShort || missedMetadata)) {
            let reason = missedMetadata ? "Missing translation/metadata" : isTooShort ? "Abnormally short" : "Cut-off text";
            console.warn(`[AutoContinue] \u26A0\uFE0F Detected incomplete response (${reason})! Requesting continuation...`);
            if (typeof window.addSystemMessage === "function") {
              window.addSystemMessage("\u26A0\uFE0F \u041E\u0442\u0432\u0435\u0442 \u043F\u0440\u0435\u0440\u0432\u0430\u043D \u0438\u043B\u0438 \u043D\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D (\u043D\u0435\u0442 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430). \u0417\u0430\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u044E \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435 \u043C\u044B\u0441\u043B\u0435\u0439...");
            }
            ws.send(JSON.stringify({
              type: "text",
              data: "\u0422\u044B \u043F\u0440\u0435\u0440\u0432\u0430\u043B\u0441\u044F \u0438 \u043D\u0435 \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u043B \u0441\u0432\u043E\u044E \u043C\u044B\u0441\u043B\u044C (\u0418\u041B\u0418 \u0442\u044B \u0437\u0430\u0431\u044B\u043B \u0432\u044B\u0437\u0432\u0430\u0442\u044C \u0444\u0443\u043D\u043A\u0446\u0438\u044E send_replica_metadata)! \u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438 \u0441\u0432\u043E\u044E \u043C\u044B\u0441\u043B\u044C, \u0441\u043A\u0430\u0436\u0438 \u043C\u0438\u043D\u0438\u043C\u0443\u043C 3-6 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0439, \u043A\u0430\u043A \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0434\u043B\u044F \u0443\u0440\u043E\u0432\u043D\u044F C2, \u0438 \u0412 \u041A\u041E\u041D\u0426\u0415 \u041E\u0411\u042F\u0417\u0410\u0422\u0415\u041B\u042C\u041D\u041E \u0441\u0434\u0435\u043B\u0430\u0439 \u0432\u044B\u0437\u043E\u0432 \u0444\u0443\u043D\u043A\u0446\u0438\u0438 send_replica_metadata!"
            }));
          }
        }
        reset() {
          if (this.thinkingElement) {
            this.fadeOutThinking();
          }
          if (this.streamingStallTimer) {
            clearTimeout(this.streamingStallTimer);
            this.streamingStallTimer = null;
          }
          if (this.autoContinueTimer) {
            clearTimeout(this.autoContinueTimer);
            this.autoContinueTimer = null;
          }
          this.streamingUserMsg = null;
          this.streamingAiMsg = null;
          this.userAccumulatedText = "";
          this.aiAccumulatedText = "";
          this.scheduledWordIds.clear();
        }
        /**
         * Full reset including thinking - only call on session stop
         */
        hardReset() {
          this.reset();
          this.lastPromisedCount = 0;
          this.totalDeliveredReplicas = 0;
          resetEnrichment();
          if (this.thinkingFadeTimer) {
            clearTimeout(this.thinkingFadeTimer);
            this.thinkingFadeTimer = null;
          }
          this.clearThinking();
        }
        escapeHtml(text) {
          const div = document.createElement("div");
          div.textContent = text;
          return div.innerHTML;
        }
      };
      // Auto-continue countdown
      // Cached DOM template (performance optimization)
      _StreamingDisplayModule.MSG_TEMPLATE_USER = '<div class="msg-label">You</div><div class="message-bubble"></div>';
      _StreamingDisplayModule.MSG_TEMPLATE_AI = '<div class="msg-label">Gemini</div><div class="message-bubble karaoke-text"></div>';
      // Universal word characters pattern (any script — for karaoke highlighting)
      _StreamingDisplayModule.WORD_PATTERN = /[\p{L}\p{M}]+/gu;
      StreamingDisplayModule = _StreamingDisplayModule;
      StreamingDisplay = new StreamingDisplayModule();
      window.StreamingDisplay = StreamingDisplay;
      if (typeof window !== "undefined") {
        window.StreamingDisplay = StreamingDisplay;
        window.updateStreamingMessage = (type, partialText) => {
          const container2 = document.getElementById("chat-messages");
          if (container2)
            StreamingDisplay.update(type, partialText, container2);
        };
        window.finalizeStreamingMessage = (type, finalText) => {
          StreamingDisplay.finalize(type, finalText);
        };
      }
      selToolbar = null;
      selectedTextForTTS = "";
      selStyle = document.createElement("style");
      selStyle.textContent = `
    #sel-toolbar {
        position: absolute;
        display: none;
        background: var(--bg3, #1a1a26);
        border: 1px solid var(--border, #2a2a3a);
        border-radius: 12px;
        padding: 4px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.4);
        z-index: 10001;
        gap: 3px;
        align-items: center;
        animation: selTbIn 0.15s ease;
    }
    @keyframes selTbIn {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .sel-btn {
        padding: 6px 12px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        color: #fff;
        transition: all 0.15s;
        white-space: nowrap;
    }
    .sel-btn:hover { filter: brightness(1.15); transform: scale(1.05); }
    .sel-btn:active { transform: scale(0.97); }
    .sel-btn-tts { background: var(--accent, #6366f1); }
    .sel-btn-analyze { background: linear-gradient(135deg, #f59e0b, #d97706); }
    .sel-btn-explain { background: linear-gradient(135deg, #10b981, #059669); }

    #sel-analysis-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90vw;
        max-width: 520px;
        max-height: 75vh;
        background: var(--bg2, #12121a);
        border: 1px solid var(--border, #2a2a3a);
        border-radius: 14px;
        box-shadow: 0 12px 48px rgba(0,0,0,0.5);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: panelIn 0.2s ease;
    }
    @keyframes panelIn {
        from { opacity: 0; transform: translate(-50%, -48%); }
        to { opacity: 1; transform: translate(-50%, -50%); }
    }
    .sel-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: var(--bg3, #1a1a26);
        font-weight: 600;
        font-size: 14px;
        color: var(--text, #fff);
    }
    .sel-panel-close {
        background: none; border: none; color: var(--text2, #aaa);
        font-size: 18px; cursor: pointer; padding: 4px 8px;
    }
    .sel-panel-close:hover { color: var(--text, #fff); }
    .sel-panel-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
        color: var(--text, #fff);
        font-size: 14px;
        line-height: 1.6;
    }
    .sel-panel-body h3 { color: var(--accent, #6366f1); font-size: 16px; margin: 14px 0 6px; }
    .sel-panel-body h4 { color: var(--accent-hover, #818cf8); font-size: 14px; margin: 10px 0 4px; }
    .sel-panel-body b, .sel-panel-body strong { color: var(--accent, #6366f1); }
    .sel-panel-body code {
        background: var(--bg4, #242434);
        padding: 2px 6px; border-radius: 4px; font-size: 13px;
    }
    .sel-panel-body .grammar-highlight {
        background: rgba(99, 102, 241, 0.1);
        border-left: 3px solid var(--accent, #6366f1);
        padding: 8px 12px; margin: 8px 0; border-radius: 6px;
    }
    .sel-panel-original {
        background: var(--bg4, #242434);
        padding: 10px 14px;
        border-radius: 8px;
        margin-bottom: 12px;
        font-style: italic;
        color: var(--text2, #aaa);
        border-left: 3px solid var(--accent, #6366f1);
    }
    .sel-panel-loading {
        text-align: center; padding: 40px; color: var(--text3, #71717a);
    }
    #sel-analysis-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
    }
`;
      document.head.appendChild(selStyle);
      handleSelection = (e) => {
        setTimeout(() => {
          const selection = window.getSelection();
          const text = selection?.toString().trim();
          if (text && text.length > 0) {
            selectedTextForTTS = text;
            const range = selection?.getRangeAt(0);
            if (range) {
              const rect = range.getBoundingClientRect();
              showSelToolbar(rect.left + rect.width / 2 - 130, Math.max(10, rect.top + window.scrollY));
            }
          } else {
            if (selToolbar && !e.target?.closest("#sel-toolbar")) {
              hideSelToolbar();
            }
          }
        }, 10);
      };
      document.addEventListener("mouseup", handleSelection);
      document.addEventListener("touchend", handleSelection);
      document.addEventListener("keyup", (e) => {
        if (e.key === "Shift" || e.key.startsWith("Arrow"))
          handleSelection(e);
      });
      document.addEventListener("scroll", hideSelToolbar);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          hideSelToolbar();
          closeAnalysisPanel();
        } else
          hideSelToolbar();
      });
      console.log("[StreamingDisplay] Module loaded (TS)");
      console.log("[Selection Toolbar] 3-button toolbar enabled");
      if ("ontouchstart" in window) {
        let lastTapTime = 0;
        document.addEventListener("click", (e) => {
          const target = e.target;
          if (!target)
            return;
          const bubble = target.closest(".message-bubble");
          if (!bubble)
            return;
          if (target.closest("button, a, .hint-btn, .tts-play-btn, .warning-continue-btn"))
            return;
          const now = Date.now();
          if (now - lastTapTime < 300)
            return;
          lastTapTime = now;
          document.querySelectorAll(".sentence-selected").forEach((el) => {
            el.classList.remove("sentence-selected");
          });
          const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
          if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE)
            return;
          const textNode = range.startContainer;
          const fullText = textNode.textContent || "";
          const pos = range.startOffset;
          const sentenceEnders = /[.!?。？！\n]/;
          let start = pos;
          let end = pos;
          while (start > 0 && !sentenceEnders.test(fullText[start - 1])) {
            start--;
          }
          while (end < fullText.length && !sentenceEnders.test(fullText[end])) {
            end++;
          }
          if (end < fullText.length && sentenceEnders.test(fullText[end])) {
            end++;
          }
          const sentence = fullText.substring(start, end).trim();
          if (!sentence || sentence.length < 3)
            return;
          try {
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              const selectRange = document.createRange();
              selectRange.setStart(textNode, start);
              selectRange.setEnd(textNode, end);
              selection.addRange(selectRange);
            }
          } catch (err) {
          }
          const parentEl = textNode.parentElement;
          if (parentEl) {
            parentEl.classList.add("sentence-selected");
            setTimeout(() => {
              parentEl.classList.remove("sentence-selected");
            }, 5e3);
          }
        });
        console.log("[Mobile] Tap-to-select-sentence enabled");
      }
    }
  });

  // src/modules/chat/chat.ts
  function autoScrollIfPinned() {
    if (isPinnedToBottom) {
      const container2 = document.getElementById("chat-messages");
      if (container2) {
        requestAnimationFrame(() => {
          container2.scrollTop = container2.scrollHeight;
        });
      }
    }
  }
  function incrementNewMessageCount() {
    newMessageCount++;
    updateScrollButton();
  }
  function updateScrollButton() {
    const container2 = document.getElementById("chat-messages");
    const btn = document.getElementById("scroll-to-bottom-btn");
    const counter = document.getElementById("new-message-count");
    if (!container2 || !btn)
      return;
    if (isPinnedToBottom) {
      btn.classList.add("hidden");
      newMessageCount = 0;
      requestAnimationFrame(() => {
        container2.scrollTop = container2.scrollHeight;
      });
    } else if (newMessageCount > 0) {
      btn.classList.remove("hidden");
      if (counter) {
        counter.textContent = newMessageCount.toString();
        counter.style.display = newMessageCount > 0 ? "flex" : "none";
      }
    }
  }
  function handleUserScroll() {
    const container2 = document.getElementById("chat-messages");
    if (!container2)
      return;
    const distanceFromBottom = container2.scrollHeight - container2.scrollTop - container2.clientHeight;
    const threshold = 100;
    if (distanceFromBottom > threshold) {
      isPinnedToBottom = false;
      window.isPinnedToBottom = false;
    }
    if (distanceFromBottom < 20) {
      isPinnedToBottom = true;
      window.isPinnedToBottom = true;
      newMessageCount = 0;
      const btn = document.getElementById("scroll-to-bottom-btn");
      if (btn)
        btn.classList.add("hidden");
    }
  }
  function scrollToBottom() {
    const container2 = document.getElementById("chat-messages");
    if (container2) {
      container2.scrollTo({
        top: container2.scrollHeight,
        behavior: "smooth"
      });
      isPinnedToBottom = true;
      newMessageCount = 0;
      const btn = document.getElementById("scroll-to-bottom-btn");
      if (btn)
        btn.classList.add("hidden");
    }
  }
  function initScrollListener() {
    const container2 = document.getElementById("chat-messages");
    if (container2) {
      container2.addEventListener("scroll", handleUserScroll);
    }
    if (!document.getElementById("scroll-to-bottom-btn")) {
      const btn = document.createElement("button");
      btn.id = "scroll-to-bottom-btn";
      btn.className = "scroll-to-bottom-btn hidden";
      btn.innerHTML = `
            <span id="new-message-count" class="new-message-count">0</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 14l-7 7m0 0l-7-7m7 7V3"/>
            </svg>
        `;
      btn.onclick = scrollToBottom;
      const chatSection = document.querySelector(".chat-section");
      if (chatSection) {
        chatSection.appendChild(btn);
      }
    }
  }
  function addMessage(role, text, _audioUrl, imageUrl) {
    const elements2 = getElements();
    const container2 = elements2.chatContainer;
    if (!container2)
      return;
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role}`;
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.className = "message-image";
      msgDiv.appendChild(img);
    }
    const textDiv = document.createElement("div");
    textDiv.className = "message-text";
    let displayText = text;
    if (role === "ai") {
      displayText = Vocabulary.formatMessage(text);
    }
    textDiv.innerHTML = displayText;
    msgDiv.appendChild(textDiv);
    const timeDiv = document.createElement("div");
    timeDiv.className = "message-time";
    timeDiv.textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString();
    msgDiv.appendChild(timeDiv);
    container2.appendChild(msgDiv);
    incrementNewMessageCount();
    const chatId = getCurrentChatId() || getState().currentChatId;
    if (chatId) {
      saveMessage(chatId, role, displayText);
    }
  }
  function addSystemMessage(text) {
    const elements2 = getElements();
    const container2 = elements2.chatContainer;
    if (!container2)
      return;
    const msgDiv = document.createElement("div");
    msgDiv.className = "message system";
    msgDiv.textContent = text;
    container2.appendChild(msgDiv);
    incrementNewMessageCount();
  }
  function clearMessages() {
    const elements2 = getElements();
    if (elements2.chatContainer) {
      elements2.chatContainer.innerHTML = "";
    }
  }
  async function sendTextMessage() {
    const elements2 = getElements();
    const state2 = getState();
    const text = elements2.textInput?.value?.trim() || "";
    if (!text && state2.pendingAttachments.length === 0)
      return;
    if (!state2.isConnected) {
      await sendViaHttp(text);
    } else {
      await sendViaWebSocket(text);
    }
    if (elements2.textInput) {
      elements2.textInput.value = "";
    }
  }
  async function sendViaHttp(text) {
    const state2 = getState();
    const apiKey = localStorage.getItem("gemini_api_key");
    if (!apiKey) {
      addSystemMessage("\u274C Set API key first");
      return;
    }
    const imagePreview = state2.pendingAttachments.find((a) => a.type.startsWith("image/"))?.preview || null;
    addMessage("user", text || "[Image]", null, imagePreview);
    addToHistory({ role: "user", parts: [{ text: text || "[Image]" }] });
    const customInstructions = localStorage.getItem("gemini_system_instruction") || "";
    const context = state2.conversationHistory.map((m) => ({
      role: m.role,
      text: m.parts?.[0]?.text || m.text || ""
    }));
    const body = {
      api_key: apiKey,
      message: text || "",
      context: context.slice(-10),
      custom_instructions: customInstructions
    };
    const imageAtt = state2.pendingAttachments.find((a) => a.type.startsWith("image/"));
    if (imageAtt?.data) {
      body.image = imageAtt.data.includes(",") ? imageAtt.data.split(",")[1] : imageAtt.data;
    }
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (data.error) {
        addSystemMessage("\u274C " + data.error);
      } else if (data.text) {
        addMessage("ai", data.text);
        addToHistory({ role: "model", parts: [{ text: data.text }] });
      }
    } catch (e) {
      addSystemMessage("\u274C Request failed: " + e.message);
    }
  }
  async function sendViaWebSocket(text) {
    const state2 = getState();
    addMessage("user", text);
    addToHistory({ role: "user", parts: [{ text }] });
    setState({ lastUserInput: text });
    const msg = { type: "text", data: text };
    if (state2.pendingAttachments.length > 0) {
      msg.attachments = state2.pendingAttachments.map((a) => ({
        type: a.type,
        data: a.data
      }));
    }
    state2.ws?.send(JSON.stringify(msg));
  }
  function initChatListeners() {
    window.addEventListener("system-message", (e) => {
      addSystemMessage(e.detail.text);
    });
    window.addEventListener("chat-message", (e) => {
      addMessage(e.detail.role, e.detail.text);
    });
    window.addEventListener("streaming-finalize", (e) => {
      if (e.detail.text) {
        addMessage("ai", e.detail.text);
        addToHistory({ role: "model", parts: [{ text: e.detail.text }] });
      }
    });
  }
  function showAIWaiting() {
    const indicator = document.getElementById("ai-waiting");
    if (indicator) {
      indicator.classList.remove("hidden");
    }
  }
  function hideAIWaiting() {
    const indicator = document.getElementById("ai-waiting");
    if (indicator) {
      indicator.classList.add("hidden");
    }
  }
  var newMessageCount, isPinnedToBottom, Chat;
  var init_chat = __esm({
    "src/modules/chat/chat.ts"() {
      "use strict";
      init_elements();
      init_state();
      init_vocabulary();
      init_chat_sessions();
      newMessageCount = 0;
      isPinnedToBottom = true;
      window.isPinnedToBottom = isPinnedToBottom;
      window.autoScrollIfPinned = autoScrollIfPinned;
      Chat = {
        addMessage,
        addSystemMessage,
        clearMessages,
        sendTextMessage,
        initListeners: initChatListeners,
        initScrollListener,
        scrollToBottom,
        showAIWaiting,
        hideAIWaiting
      };
    }
  });

  // src/modules/api/orchestrator.ts
  var OrchestratorModule, Orchestrator;
  var init_orchestrator = __esm({
    "src/modules/api/orchestrator.ts"() {
      "use strict";
      OrchestratorModule = class {
        constructor() {
          this.isActive = false;
          this.mode = "standard";
          this.expectedCount = 5;
          this.isBatch = true;
          this.phase = "greeting";
        }
        startMonitoring() {
          const radio = document.querySelector('input[name="teacher-mode"]:checked');
          this.mode = radio?.value || "standard";
          const deliveryMode = window.getDeliveryMode?.() || "interactive";
          this.isBatch = deliveryMode === "fast_text";
          switch (this.mode) {
            case "active":
              this.expectedCount = 10;
              break;
            case "standard":
              this.expectedCount = 5;
              break;
            case "grammar":
              this.expectedCount = 5;
              break;
            default:
              this.expectedCount = 0;
          }
          this.isActive = true;
          this.phase = "greeting";
          console.log(`[Orchestrator] Started: mode=${this.mode}, expect=${this.expectedCount}, batch=${this.isBatch}`);
        }
        onStreamUpdate(partialText) {
          if (!this.isActive)
            return;
          if (this.phase === "greeting" && /\d+\.\s*(Граммини|Grammini|СОБЕСЕДНИК)/i.test(partialText)) {
            this.phase = "content";
            console.log(`[Orchestrator] Phase: content`);
          }
        }
        onAudioReceived() {
        }
        onStreamFinished(_fullText) {
        }
        stopMonitoring() {
          this.isActive = false;
          console.log("[Orchestrator] Stopped");
        }
        get isContinuing() {
          return false;
        }
        get expectedItemCount() {
          return this.expectedCount;
        }
      };
      Orchestrator = new OrchestratorModule();
      if (typeof window !== "undefined") {
        window.Orchestrator = Orchestrator;
      }
      console.log("[Orchestrator] v5 loaded (simplified backup)");
    }
  });

  // src/modules/api/websocket-controller.ts
  async function startConversation(mode) {
    const rawKey = localStorage.getItem("gemini_api_key") || "";
    const apiKey = rawKey.split(",")[0].trim();
    const voice = localStorage.getItem("gemini_voice") || "Puck";
    const systemInstruction = localStorage.getItem("gemini_system_instruction") || "";
    const elements2 = getElements();
    const state2 = getState();
    if (!apiKey) {
      console.log("[WebSocket] No API key provided locally, server will use environment variable fallback");
    }
    let chatId = getCurrentChatId() || state2.currentChatId;
    if (!chatId) {
      chatId = crypto.randomUUID();
      setState({ currentChatId: chatId });
      setCurrentChatId(chatId);
      const modeLabel = mode === "voice" ? "\u{1F3A4} \u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 \u0447\u0430\u0442" : mode === "camera" ? "\u{1F4F7} \u041A\u0430\u043C\u0435\u0440\u0430" : "\u{1F5A5}\uFE0F \u042D\u043A\u0440\u0430\u043D";
      saveSession(chatId, modeLabel);
    }
    setStatus("Connecting...", false);
    elements2.stopRow?.classList.remove("hidden");
    let videoStream = null;
    try {
      if (mode === "voice") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        setState({ mediaStream: stream });
        addSystemMessage2("\u{1F3A4} Microphone active");
      } else if (mode === "camera") {
        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: state2.currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        setupVideoPreview(videoStream);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setState({ mediaStream: audioStream });
          addSystemMessage2("\u{1F3A4} Microphone active");
        } catch {
          addSystemMessage2("\u26A0\uFE0F No microphone - video only");
        }
        addSystemMessage2("\u{1F4F7} Camera active");
        showVideoSection();
      } else if (mode === "screen") {
        videoStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        setupVideoPreview(videoStream);
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setState({ mediaStream: audioStream });
          addSystemMessage2("\u{1F3A4} Microphone active");
        } catch {
          addSystemMessage2("\u26A0\uFE0F No microphone - screen only");
        }
        addSystemMessage2("\u{1F5A5}\uFE0F Screen sharing active");
        showVideoSection();
      }
    } catch (e) {
      addSystemMessage2(`\u274C ${mode === "voice" ? "Microphone" : mode === "camera" ? "Camera" : "Screen share"} denied`);
      setStatus("Ready", false);
      return;
    }
    const wsUrl = buildWebSocketUrl(apiKey, voice, systemInstruction);
    const ws = new WebSocket(wsUrl);
    setWebSocket(ws);
    ws.onopen = () => handleWsOpen(ws, mode, systemInstruction);
    ws.onmessage = (e) => handleWsMessage(e);
    ws.onerror = () => {
      addSystemMessage2("\u274C Connection error");
      stopConversation(false);
    };
    ws.onclose = () => {
      if (getState().isConnected) {
        addSystemMessage2("\u{1F4E1} Disconnected");
        const shouldSoftStop = reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
        stopConversation(!shouldSoftStop);
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = 2e3 * Math.pow(2, reconnectAttempts - 1);
          addSystemMessage2(`\u{1F504} \u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u043F\u043E\u043F\u044B\u0442\u043A\u0430 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) \u0447\u0435\u0440\u0435\u0437 ${delay / 1e3} \u0441\u0435\u043A...`);
          setTimeout(() => {
            if (!getState().isConnected) {
              addSystemMessage2("\u{1F504} \u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u043C\u0441\u044F...");
              startConversation("voice");
            }
          }, delay);
        } else {
          addSystemMessage2("\u26A0\uFE0F \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 Voice.");
          reconnectAttempts = 0;
        }
      }
    };
  }
  function stopConversation(isHardStop = true) {
    console.log(`[Stop] Stopping conversation (hardStop=${isHardStop})...`);
    const state2 = getState();
    const elements2 = getElements();
    setConnected(false);
    setStatus("Ready", false);
    AudioCapture.stop();
    AudioPlayback.stop();
    ScreenCapture.stop();
    if (isHardStop) {
      StreamingDisplay.hardReset();
    } else {
      StreamingDisplay.finalize("ai", "");
      StreamingDisplay.reset();
      StreamingDisplay.triggerEnrichment(true);
    }
    Orchestrator.stopMonitoring();
    if (state2.ws) {
      state2.ws.close();
      setWebSocket(null);
    }
    if (elements2.videoPreview?.srcObject) {
      elements2.videoPreview.srcObject.getTracks().forEach((t2) => t2.stop());
      elements2.videoPreview.srcObject = null;
    }
    if (state2.mediaStream) {
      state2.mediaStream.getTracks().forEach((t2) => t2.stop());
      setState({ mediaStream: null });
    }
    if (state2.keepaliveInterval) {
      clearInterval(state2.keepaliveInterval);
      setState({ keepaliveInterval: null });
    }
    elements2.stopRow?.classList.add("hidden");
    hideVideoSection();
  }
  function buildWebSocketUrl(apiKey, voice, systemInstruction) {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${location.host}/ws?gemini_api_key=${encodeURIComponent(apiKey)}&voice=${encodeURIComponent(voice)}&system_instruction=${encodeURIComponent(systemInstruction)}`;
  }
  function handleWsOpen(ws, mode, systemInstruction) {
    const elements2 = getElements();
    const state2 = getState();
    const teacherModeRadio = document.querySelector('input[name="teacher-mode"]:checked');
    const teacherMode = teacherModeRadio?.value || "standard";
    const germanOnlyMode = localStorage.getItem("germanOnlyMode") === "true";
    const config = {
      api_key: localStorage.getItem("gemini_api_key") || "",
      voice: localStorage.getItem("gemini_voice") || "Puck",
      has_video: mode === "camera" || mode === "screen",
      teacher_mode: teacherMode,
      german_only_mode: germanOnlyMode,
      // Don't speak Russian translations
      native_language: localStorage.getItem("gemini_native_language") || "Russian",
      delivery_mode: window.getDeliveryMode?.() || "interactive",
      // Delivery: interactive / fast_text / auto_10
      custom_instructions: systemInstruction,
      context: state2.conversationHistory.slice(-10).map((m) => ({
        type: m.role === "user" ? "user" : "model",
        text: m.parts?.[0]?.text || m.text || ""
      }))
    };
    ws.send(JSON.stringify(config));
    console.log("[WebSocket] Config sent:", { voice: config.voice, has_video: config.has_video, teacher_mode: teacherMode, german_only_mode: germanOnlyMode, native_language: config.native_language });
    setConnected(true);
    setStatus("Connected!", true);
    Orchestrator.startMonitoring();
    SessionLogger.startSession(teacherMode || "standard", "C2");
    SessionLogger.wsConfig(config);
    addSystemMessage2("\u2705 Connected to Gemini");
    reconnectAttempts = 0;
    if (!autoStartFired) {
      autoStartFired = true;
      window._deliveredReplicaCount = 0;
      setTimeout(() => {
        if (getState().isConnected && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "text", data: "\u041D\u0430\u0447\u0438\u043D\u0430\u0439!" }));
          console.log("[WebSocket] \u2705 Auto-start greeting sent (one-time)");
        }
      }, 1500);
    }
    if (state2.mediaStream) {
      AudioCapture.start(state2.mediaStream, ws, {
        micLevelEl: elements2.micLevel,
        isPlaying: () => getState().isPlaying || AudioPlayback.getIsPlaying(),
        isConnected: () => getState().isConnected
      });
    }
    if (elements2.videoPreview?.srcObject) {
      ScreenCapture.start(elements2.videoPreview, ws, {
        isConnected: () => getState().isConnected,
        interval: 1e3
      });
    }
    const keepaliveInterval = window.setInterval(() => {
      if (getState().ws?.readyState === WebSocket.OPEN) {
        getState().ws.send(JSON.stringify({ type: "keepalive" }));
      }
    }, 25e3);
    setState({ keepaliveInterval });
  }
  function handleWsMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      console.log("[WS] Received:", msg.type, msg.data?.substring?.(0, 50) ?? "");
      switch (msg.type) {
        case "audio":
          if (msg.data) {
            AudioPlayback.playChunk(msg.data);
            Orchestrator.onAudioReceived();
            const activityBar = document.getElementById("widget-activity-bar");
            if (activityBar) {
              activityBar.classList.add("speaking");
              clearTimeout(window._activityTimeout);
              window._activityTimeout = setTimeout(() => {
                activityBar.classList.remove("speaking");
              }, 500);
            }
          }
          break;
        case "text":
          handleTextMessage(msg);
          break;
        case "transcript":
          handleTranscript(msg);
          break;
        case "ai_thinking":
          window._didReceiveMetadataForCurrentTurn = false;
          window._deliveredReplicaCount = 0;
          setPlaying(true);
          if (msg.data) {
            const container2 = getElements().chatContainer;
            if (container2)
              StreamingDisplay.updateThinking(msg.data, container2);
            SessionLogger.aiThinking(msg.data);
          }
          break;
        case "user_transcript_partial":
          if (msg.data) {
            const container2 = getElements().chatContainer;
            if (container2)
              StreamingDisplay.update("user", msg.data, container2);
          }
          break;
        case "user_transcript":
          if (msg.data) {
            StreamingDisplay.finalize("user", msg.data);
            addToHistory({ role: "user", parts: [{ text: msg.data }] });
            setState({ lastUserInput: msg.data });
            Chat.showAIWaiting();
            SessionLogger.userMessage(msg.data);
          }
          break;
        case "ai_transcript_partial":
          setPlaying(true);
          if (msg.data) {
            if (msg.data && msg.data.match(/REPLICA\s*\d+\s*:?/i)) {
              console.log("[WS] \u{1F504} New REPLICA detected in stream \u2014 reset metadata tracking");
              window._didReceiveMetadataForCurrentTurn = false;
              window._autoContinueRetryCount = 0;
            }
            const deliveryMode = window.getDeliveryMode?.() || "interactive";
            const shouldFilterPostMetadata = deliveryMode !== "fast_text";
            if (shouldFilterPostMetadata && window._didReceiveMetadataForCurrentTurn === true) {
              break;
            }
            Chat.hideAIWaiting();
            const container2 = getElements().chatContainer;
            if (container2)
              StreamingDisplay.update("ai", msg.data, container2);
            Orchestrator.onStreamUpdate(msg.data);
          }
          break;
        case "ai_transcript":
          if (msg.data) {
            if (window._didReceiveMetadataForCurrentTurn === true) {
              console.log("[WS] \u{1F6E1}\uFE0F ai_transcript received but metadata already applied \u2014 finalizing with DOM preservation");
              StreamingDisplay.finalize("ai", "__METADATA_APPLIED__");
              addToHistory({ role: "model", parts: [{ text: msg.data }] });
              Orchestrator.onStreamFinished(msg.data);
              SessionLogger.aiMessage(msg.data);
              StreamingDisplay.triggerEnrichment(false);
              break;
            }
            StreamingDisplay.finalize("ai", msg.data);
            addToHistory({ role: "model", parts: [{ text: msg.data }] });
            Orchestrator.onStreamFinished(msg.data);
            SessionLogger.aiMessage(msg.data);
            StreamingDisplay.triggerEnrichment(false);
          }
          break;
        case "turn_complete": {
          setPlaying(false);
          const lastAiText = StreamingDisplay.aiAccumulatedText || StreamingDisplay._lastFinalizedAiText || "";
          StreamingDisplay.finalize("ai", "");
          Orchestrator.onStreamFinished();
          StreamingDisplay.triggerEnrichment(true);
          const isActiveMode = document.querySelector('input[name="teacher-mode"]:checked')?.value === "active";
          const missedMeta = window._didReceiveMetadataForCurrentTurn === false;
          const currentWs = getState().ws;
          const hasDialogueContent = lastAiText.includes("REPLICA") || window._autoContinueRetryCount > 0;
          const retryCount = window._autoContinueRetryCount || 0;
          const MAX_RETRIES = 3;
          const currentDeliveryMode = window.getDeliveryMode?.() || "interactive";
          const delivered = window._deliveredReplicaCount || 0;
          const isIllegalExtraReplica = (currentDeliveryMode === "interactive" || currentDeliveryMode === "fast_text") && delivered >= 1;
          if (!isIllegalExtraReplica && isActiveMode && hasDialogueContent && missedMeta && currentWs && currentWs.readyState === WebSocket.OPEN && retryCount < MAX_RETRIES) {
            window._autoContinueRetryCount = retryCount + 1;
            const cleanForContext = lastAiText.replace(/<[^>]+>/g, "").replace(/REPLICA\s*\d+\s*:?/gi, "").trim();
            window._interruptedAiTextClean = cleanForContext;
            const words = cleanForContext.split(/\s+/);
            const lastWords = words.slice(-10).join(" ");
            const textEndsWithPunctuation = /[.?!»")\]]\s*$/.test(cleanForContext);
            console.warn(`[AutoContinue] \u26A0\uFE0F Repair retry ${retryCount + 1}/${MAX_RETRIES}. Text complete: ${textEndsWithPunctuation}. Last words: "${lastWords}"`);
            addSystemMessage2(`\u26A0\uFE0F \u0420\u0435\u043F\u043B\u0438\u043A\u0430 \u043F\u0440\u0435\u0440\u0432\u0430\u043D\u0430. \u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 ${retryCount + 1}/${MAX_RETRIES}...`);
            if (textEndsWithPunctuation) {
              console.warn(`[AutoContinue] \u{1F916} Text is complete but Tool Call is missing. Prompting Voice AI to repeat...`);
              const chatContainer = document.getElementById("chat-messages");
              const aiMessages = chatContainer?.querySelectorAll(".message.ai");
              if (aiMessages && aiMessages.length > 0) {
                aiMessages[aiMessages.length - 1].remove();
              }
              const chatId = window.ChatSessions?.getCurrentChatId?.() || "";
              if (chatId && typeof window.ChatSessions?.removeLastMessage === "function") {
                window.ChatSessions.removeLastMessage(chatId);
              }
              currentWs.send(JSON.stringify({
                type: "text",
                data: "\u0412\u043D\u0438\u043C\u0430\u043D\u0438\u0435: \u0432\u044B \u043D\u0435 \u0432\u044B\u0437\u0432\u0430\u043B\u0438 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u0443\u044E \u0444\u0443\u043D\u043A\u0446\u0438\u044E send_replica_metadata \u0434\u043B\u044F \u0432\u0430\u0448\u0435\u0439 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0440\u0435\u043F\u043B\u0438\u043A\u0438! \u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u041F\u041E\u0412\u0422\u041E\u0420\u0418\u0422\u0415 \u0432\u0430\u0448\u0443 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044E\u044E \u0440\u0435\u043F\u043B\u0438\u043A\u0443 \u0415\u0429\u0415 \u0420\u0410\u0417 (\u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u0442\u0435\u043A\u0441\u0442\u043E\u043C) \u0438 \u041E\u0411\u042F\u0417\u0410\u0422\u0415\u041B\u042C\u041D\u041E \u0432\u044B\u0437\u043E\u0432\u0438\u0442\u0435 \u0444\u0443\u043D\u043A\u0446\u0438\u044E \u0441\u043E \u0412\u0421\u0415\u041C\u0418 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u0430\u043C\u0438 (original_text, translation, hint_grammar, answer_options)."
              }));
            } else {
              currentWs.send(JSON.stringify({
                type: "text",
                data: `\u0422\u044B \u043F\u0440\u0435\u0440\u0432\u0430\u043B\u0441\u044F \u043D\u0430 \u043F\u043E\u043B\u0443\u0441\u043B\u043E\u0432\u0435! \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043B\u043E\u0432\u0430: "...${lastWords}". \u041F\u0420\u041E\u0414\u041E\u041B\u0416\u0418 \u0420\u041E\u0412\u041D\u041E \u0421 \u042D\u0422\u041E\u0413\u041E \u041C\u0415\u0421\u0422\u0410. \u0417\u0410\u041F\u0420\u0415\u0429\u0415\u041D\u041E: \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C \u043D\u043E\u0432\u0443\u044E \u0440\u0435\u043F\u043B\u0438\u043A\u0443, \u043F\u0438\u0441\u0430\u0442\u044C "REPLICA N:", \u043D\u0430\u0447\u0438\u043D\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E. \u0420\u0410\u0417\u0420\u0415\u0428\u0415\u041D\u041E: \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0438\u0441\u0442\u044B\u0439 \u0442\u0435\u043A\u0441\u0442-\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0435\u043D\u0438\u0435 \u043D\u0430 \u043D\u0435\u043C\u0435\u0446\u043A\u043E\u043C, \u0437\u0430\u043A\u043E\u043D\u0447\u0438 \u043C\u044B\u0441\u043B\u044C \u0442\u043E\u0447\u043A\u043E\u0439. \u041D\u0438\u043A\u0430\u043A\u0438\u0445 \u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0435\u0432. \u041F\u043E\u0441\u043B\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F \u0442\u0435\u043A\u0441\u0442\u0430 \u2014 \u0432\u044B\u0437\u043E\u0432\u0438 send_replica_metadata.`
              }));
            }
          } else if (isActiveMode && hasDialogueContent && missedMeta && retryCount >= MAX_RETRIES) {
            console.warn(`[AutoContinue] \u274C Max retries (${MAX_RETRIES}) reached. Triggering Text Bot fallback.`);
            addSystemMessage2("\u26A0\uFE0F \u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 \u0431\u043E\u0442 \u043D\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B \u0440\u0435\u043F\u043B\u0438\u043A\u0443. \u0422\u0435\u043A\u0441\u0442\u043E\u0432\u044B\u0439 \u0418\u0418 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442...");
            window._autoContinueRetryCount = 0;
            StreamingDisplay.triggerEnrichment(true);
          }
          if (isActiveMode && currentWs && currentWs.readyState === WebSocket.OPEN) {
            const expected = Orchestrator.expectedItemCount || 10;
            if (currentDeliveryMode === "fast_text") {
              if (delivered >= 1 && window._didReceiveMetadataForCurrentTurn === true) {
                console.log(`[AutoContinue] \u26A1 Fast Text mode: ${delivered} delivered. Text Bot will fill remaining.`);
              }
            } else if (currentDeliveryMode === "auto_10") {
              if (delivered > 0 && delivered < expected && window._didReceiveMetadataForCurrentTurn === true) {
                console.log(`[AutoContinue] \u{1F504} Auto-10: Delivered ${delivered}/${expected} \u2014 requesting next replica`);
                setTimeout(() => {
                  if (currentWs.readyState === WebSocket.OPEN) {
                    currentWs.send(JSON.stringify({
                      type: "text",
                      data: `\u0422\u044B \u0432\u044B\u0434\u0430\u043B ${delivered} \u0438\u0437 ${expected} \u0440\u0435\u043F\u043B\u0438\u043A. \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0439! \u0412\u044B\u0434\u0430\u0439 REPLICA ${delivered + 1}. \u041F\u043E\u043C\u043D\u0438: \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0439 \u0440\u0435\u043F\u043B\u0438\u043A\u0438 \u043D\u0443\u0436\u0435\u043D \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 \u0442\u0435\u043A\u0441\u0442 + \u0432\u044B\u0437\u043E\u0432 send_replica_metadata.`
                    }));
                  }
                }, 2e3);
              } else if (delivered >= expected) {
                console.log(`[AutoContinue] \u{1F389} All ${expected} replicas delivered! Dialogue complete.`);
                window._deliveredReplicaCount = 0;
              }
            }
          }
          break;
        }
        case "tool_call":
          if (msg.name === "send_replica_metadata" && msg.args) {
            const hasTranslation = msg.args.translation && msg.args.translation.trim().length > 3;
            const hasAnswers = Array.isArray(msg.args.answer_options) && msg.args.answer_options.length >= 3;
            if (!hasTranslation || !hasAnswers) {
              console.warn(`[WS] \u26A0\uFE0F INCOMPLETE Tool Call! AI omitted required fields (translation or answers). Rejecting delivery so AutoContinue can fix it.`);
              handleReplicaMetadata(msg.args);
              break;
            }
            window._didReceiveMetadataForCurrentTurn = true;
            const deliveredCount = (window._deliveredReplicaCount || 0) + 1;
            window._deliveredReplicaCount = deliveredCount;
            console.log(`[WS] \u2705 Replica ${deliveredCount} metadata delivered`);
            const rc = window._autoContinueRetryCount || 0;
            if (rc > 0 && window._interruptedAiTextClean) {
              const oldClean = window._interruptedAiTextClean;
              if (msg.args.original_text && oldClean.length > 10) {
                const checkStr = oldClean.substring(0, 10);
                if (!msg.args.original_text.includes(checkStr)) {
                  msg.args.original_text = oldClean + " " + msg.args.original_text;
                }
              }
              const chatOutput = document.getElementById("chat-output");
              if (chatOutput) {
                chatOutput.querySelectorAll(".system-message").forEach((el) => {
                  if (el.textContent && el.textContent.includes("\u0411\u043E\u0442 \u043F\u0440\u0435\u0440\u0432\u0430\u043B\u0441\u044F") && el.textContent.includes("\u041F\u043E\u043F\u044B\u0442\u043A\u0430")) {
                    el.remove();
                  }
                });
              }
            }
            window._autoContinueRetryCount = 0;
            window._interruptedAiTextClean = "";
            console.log("[WS] \u{1F6E0}\uFE0F Tool Call Received:", msg.name, msg.args);
            handleReplicaMetadata(msg.args);
          } else if (msg.name === "log_learning_item" && msg.args) {
            console.log("[WS] \u{1F4DD} Learning item logged:", msg.args);
            addSystemMessage2(`\u{1F4DD} \u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E \u0432 \u0441\u043B\u043E\u0432\u0430\u0440\u044C: ${msg.args.term}`);
          }
          break;
        case "interrupted":
          setPlaying(false);
          AudioPlayback.skipPlayback();
          StreamingDisplay.finalize("ai", "");
          StreamingDisplay.reset();
          StreamingDisplay.triggerEnrichment(true);
          break;
        case "error":
          setPlaying(false);
          const errorMessage = msg.message || "";
          addSystemMessage2("\u274C " + errorMessage);
          if ((errorMessage.includes("Internal error") || errorMessage.includes("unavailable") || errorMessage.includes("Session ended")) && !errorMessage.includes("invalid argument") && !errorMessage.includes("INVALID_ARGUMENT") && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = 2e3 * Math.pow(2, reconnectAttempts - 1);
            console.log(`[WebSocket] Gemini API error, auto-reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1e3}s...`);
            addSystemMessage2(`\u{1F504} \u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 (\u043F\u043E\u043F\u044B\u0442\u043A\u0430 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) \u0447\u0435\u0440\u0435\u0437 ${delay / 1e3} \u0441\u0435\u043A...`);
            setTimeout(() => {
              const state2 = getState();
              if (!state2.isConnected) {
                addSystemMessage2("\u{1F504} \u041F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0430\u0435\u043C\u0441\u044F...");
                startConversation("voice");
              }
            }, delay);
          } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            addSystemMessage2("\u26A0\uFE0F \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 Voice \u0434\u043B\u044F \u0440\u0443\u0447\u043D\u043E\u0433\u043E \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F.");
            reconnectAttempts = 0;
          }
          break;
      }
    } catch (e) {
      console.error("[WebSocket] Parse error:", e);
    }
  }
  function handleTextMessage(msg) {
    const text = msg.data || msg.text;
    if (!text)
      return;
    const container2 = getElements().chatContainer;
    if (!container2)
      return;
    StreamingDisplay.update("ai", text, container2);
  }
  function handleTranscript(msg) {
    const text = msg.data || msg.text;
    if (!text)
      return;
    if (msg.role === "user") {
      addMessage2("user", text);
      addToHistory({ role: "user", parts: [{ text }] });
    } else if (msg.role === "model") {
    }
  }
  function setStatus(text, connected) {
    const elements2 = getElements();
    if (elements2.statusText)
      elements2.statusText.textContent = text;
    if (elements2.statusDot) {
      elements2.statusDot.classList.toggle("connected", connected);
    }
  }
  function addSystemMessage2(text) {
    console.log("[System]", text);
    const event = new CustomEvent("system-message", { detail: { text } });
    window.dispatchEvent(event);
  }
  function addMessage2(role, text) {
    const event = new CustomEvent("chat-message", { detail: { role, text } });
    window.dispatchEvent(event);
  }
  function setupVideoPreview(stream) {
    const elements2 = getElements();
    if (elements2.videoPreview) {
      elements2.videoPreview.srcObject = stream;
      elements2.videoPreview.onloadedmetadata = () => {
        elements2.videoPreview?.play().catch(() => {
        });
      };
    }
  }
  function showVideoSection() {
    const elements2 = getElements();
    elements2.videoSection?.classList.remove("hidden", "video-hidden");
    elements2.videoPlaceholder?.classList.add("hidden");
  }
  function hideVideoSection() {
    const elements2 = getElements();
    elements2.videoSection?.classList.add("hidden");
  }
  var MAX_RECONNECT_ATTEMPTS, reconnectAttempts, autoStartFired, WebSocketController;
  var init_websocket_controller = __esm({
    "src/modules/api/websocket-controller.ts"() {
      "use strict";
      init_elements();
      init_state();
      init_audio_capture();
      init_audio_playback();
      init_screen_capture();
      init_streaming_display();
      init_chat_sessions();
      init_chat();
      init_orchestrator();
      init_session_logger();
      init_enrichment();
      MAX_RECONNECT_ATTEMPTS = 3;
      reconnectAttempts = 0;
      autoStartFired = false;
      WebSocketController = {
        start: startConversation,
        stop: stopConversation
      };
    }
  });

  // src/modules/ui/language-picker.ts
  function positionDropdown(btn, dropdown) {
    const appContainer = document.querySelector(".app") || document.body;
    if (dropdown.parentElement !== appContainer) {
      dropdown.__originalParent = dropdown.parentElement;
      appContainer.appendChild(dropdown);
    }
    requestAnimationFrame(() => {
      const rect = btn.getBoundingClientRect();
      const dropW = Math.max(220, rect.width);
      let left = rect.left;
      if (left + dropW > window.innerWidth - 8) {
        left = window.innerWidth - dropW - 8;
      }
      if (left < 8)
        left = 8;
      const dropH = dropdown.scrollHeight || 300;
      let top = rect.bottom + 4;
      if (top + dropH > window.innerHeight - 8) {
        top = rect.top - dropH - 4;
        if (top < 8)
          top = 8;
      }
      dropdown.style.position = "fixed";
      dropdown.style.left = `${left}px`;
      dropdown.style.top = `${top}px`;
      dropdown.style.width = `${dropW}px`;
      dropdown.style.zIndex = "99999";
    });
  }
  function getTargetLanguage() {
    return localStorage.getItem(STORAGE_KEY2) || "German";
  }
  function findLanguage(code) {
    return LANGUAGES.find((l) => l.code === code);
  }
  function setupLanguagePicker() {
    const btn = document.getElementById("language-picker-btn");
    const dropdown = document.getElementById("language-picker-dropdown");
    const searchInput = document.getElementById("language-search");
    const list = document.getElementById("language-list");
    const hiddenInput = document.getElementById("target-language");
    if (!btn || !dropdown || !searchInput || !list || !hiddenInput)
      return;
    const saved = getTargetLanguage();
    const savedLang = findLanguage(saved);
    if (savedLang) {
      updateButton(btn, savedLang);
      hiddenInput.value = savedLang.code;
    }
    renderLanguageList(list, LANGUAGES, hiddenInput, btn, dropdown);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      isOpen = !isOpen;
      dropdown.classList.toggle("open", isOpen);
      if (isOpen) {
        positionDropdown(btn, dropdown);
        searchInput.value = "";
        renderLanguageList(list, LANGUAGES, hiddenInput, btn, dropdown);
        setTimeout(() => searchInput.focus(), 50);
      }
    });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      const filtered = query ? LANGUAGES.filter(
        (l) => l.name.toLowerCase().includes(query) || l.nameEn.toLowerCase().includes(query) || l.code.toLowerCase().includes(query)
      ) : LANGUAGES;
      renderLanguageList(list, filtered, hiddenInput, btn, dropdown);
    });
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => {
      if (isOpen) {
        isOpen = false;
        dropdown.classList.remove("open");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) {
        isOpen = false;
        dropdown.classList.remove("open");
      }
    });
  }
  function updateButton(btn, lang) {
    const flag = btn.querySelector(".lang-flag");
    const name = btn.querySelector(".lang-name");
    if (flag)
      flag.textContent = lang.flag;
    if (name)
      name.textContent = lang.name;
  }
  function renderLanguageList(list, languages, hiddenInput, btn, dropdown) {
    const current = getTargetLanguage();
    const sorted = [...languages].sort((a, b) => {
      if (a.available && !b.available)
        return -1;
      if (!a.available && b.available)
        return 1;
      return 0;
    });
    list.innerHTML = sorted.map((lang) => `
        <div class="language-item ${lang.code === current ? "selected" : ""} ${!lang.available ? "disabled" : ""}" data-code="${lang.code}" ${!lang.available ? 'title="Coming soon \u2014 curriculum in development"' : ""}>
            <span class="lang-item-flag">${lang.flag}</span>
            <span class="lang-item-name">${lang.name}</span>
            <span class="lang-item-en">${lang.nameEn}</span>
            ${!lang.available ? '<span class="lang-coming-soon">Coming soon</span>' : ""}
        </div>
    `).join("");
    list.querySelectorAll(".language-item:not(.disabled)").forEach((item) => {
      item.addEventListener("click", async (e) => {
        e.stopPropagation();
        const code = item.dataset.code;
        const lang = findLanguage(code);
        if (!lang)
          return;
        updateButton(btn, lang);
        hiddenInput.value = lang.code;
        localStorage.setItem(STORAGE_KEY2, lang.code);
        isOpen = false;
        dropdown.classList.remove("open");
        try {
          await fetch("/api/profile?user_id=default", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_language: lang.code })
          });
          console.log("[Language] Updated DB target_language to:", lang.code);
        } catch (err) {
          console.error("[Language] Failed to update profile:", err);
        }
        const existingChat = findSessionByLanguage(lang.code);
        if (existingChat) {
          console.log(`[Language] Found existing chat for ${lang.code}:`, existingChat.id);
          loadSession(existingChat.id);
        } else {
          const chatId = `${lang.code.toLowerCase()}_${Date.now()}`;
          const modeSelect = document.getElementById("teacher-mode");
          const levelSelect = document.getElementById("level");
          const currentMode = modeSelect?.value || "standard";
          const currentLevel = levelSelect?.value || "A1";
          saveSession(chatId, `${lang.flag} ${lang.name}`, lang.code, currentMode, currentLevel);
          setCurrentChatId(chatId);
          console.log(`[Language] Created new chat for ${lang.code}: ${chatId} (${currentMode}/${currentLevel})`);
          const chatMessages2 = document.getElementById("chat-messages");
          if (chatMessages2)
            chatMessages2.innerHTML = "";
        }
        renderSessionList();
        try {
          await fetch("/api/clear-session", { method: "POST" });
          console.log("[Language] Cleared backend session");
        } catch (_) {
        }
        StreamingDisplay.hardReset();
        const chatMessages = document.getElementById("chat-messages");
        if (chatMessages) {
          const notif = document.createElement("div");
          notif.className = "system-message mode-change-notice";
          notif.innerHTML = `\u{1F30D} Switching to <strong>${lang.flag} ${lang.name}</strong>...`;
          notif.style.cssText = "background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; padding: 10px; margin: 10px 0; border-radius: 8px; text-align: center;";
          chatMessages.appendChild(notif);
        }
        const state2 = getState();
        if (state2.isConnected || state2.ws && state2.ws.readyState !== WebSocket.CLOSED) {
          stopConversation();
        }
        console.log("[Language] Reconnecting in 1.2s with", lang.code);
        setTimeout(() => startConversation("voice"), 1200);
      });
    });
  }
  function getNativeLanguage() {
    return localStorage.getItem(NATIVE_STORAGE_KEY) || "Russian";
  }
  function setupNativeLanguagePicker() {
    const btn = document.getElementById("native-language-picker-btn");
    const dropdown = document.getElementById("native-language-picker-dropdown");
    const searchInput = document.getElementById("native-language-search");
    const list = document.getElementById("native-language-list");
    const hiddenInput = document.getElementById("native-language");
    if (!btn || !dropdown || !searchInput || !list || !hiddenInput)
      return;
    const saved = getNativeLanguage();
    const savedLang = findLanguage(saved);
    if (savedLang) {
      updateButton(btn, savedLang);
      hiddenInput.value = savedLang.code;
    }
    const renderNativeList = (langs) => {
      const current = getNativeLanguage();
      list.innerHTML = langs.map((lang) => `
            <div class="language-item ${lang.code === current ? "selected" : ""}" data-code="${lang.code}">
                <span class="lang-item-flag">${lang.flag}</span>
                <span class="lang-item-name">${lang.name}</span>
                <span class="lang-item-en">${lang.nameEn}</span>
            </div>
        `).join("");
      list.querySelectorAll(".language-item").forEach((item) => {
        item.addEventListener("click", async (e) => {
          e.stopPropagation();
          const code = item.dataset.code;
          const lang = findLanguage(code);
          if (!lang)
            return;
          updateButton(btn, lang);
          hiddenInput.value = lang.code;
          localStorage.setItem(NATIVE_STORAGE_KEY, lang.code);
          isNativeOpen = false;
          dropdown.classList.remove("open");
          console.log("[NativeLang] Set to:", lang.code);
          try {
            await fetch("/api/profile?user_id=default", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ native_language: lang.code })
            });
            console.log("[NativeLang] Updated DB native_language to:", lang.code);
          } catch (err) {
            console.error("[NativeLang] Failed to update profile:", err);
          }
          const state2 = getState();
          if (state2.isConnected || state2.ws && state2.ws.readyState !== WebSocket.CLOSED) {
            const reconnectMode = "voice";
            stopConversation();
            StreamingDisplay.hardReset();
            console.log("[NativeLang] Reconnecting with new native language:", lang.code);
            setTimeout(() => startConversation(reconnectMode), 1200);
          } else {
            console.log("[NativeLang] Not connected, skipping reconnect");
          }
        });
      });
    };
    renderNativeList(LANGUAGES);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      isNativeOpen = !isNativeOpen;
      dropdown.classList.toggle("open", isNativeOpen);
      if (isNativeOpen) {
        positionDropdown(btn, dropdown);
        searchInput.value = "";
        renderNativeList(LANGUAGES);
        setTimeout(() => searchInput.focus(), 50);
      }
    });
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase().trim();
      const filtered = query ? LANGUAGES.filter(
        (l) => l.name.toLowerCase().includes(query) || l.nameEn.toLowerCase().includes(query) || l.code.toLowerCase().includes(query)
      ) : LANGUAGES;
      renderNativeList(filtered);
    });
    searchInput.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => {
      if (isNativeOpen) {
        isNativeOpen = false;
        dropdown.classList.remove("open");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isNativeOpen) {
        isNativeOpen = false;
        dropdown.classList.remove("open");
      }
    });
  }
  var LANGUAGES, STORAGE_KEY2, isOpen, NATIVE_STORAGE_KEY, isNativeOpen, LanguagePicker;
  var init_language_picker = __esm({
    "src/modules/ui/language-picker.ts"() {
      "use strict";
      init_state();
      init_websocket_controller();
      init_streaming_display();
      init_chat_sessions();
      LANGUAGES = [
        { code: "German", flag: "\u{1F1E9}\u{1F1EA}", name: "Deutsch", nameEn: "German", available: true },
        { code: "English", flag: "\u{1F1EC}\u{1F1E7}", name: "English", nameEn: "English", available: true },
        { code: "Japanese", flag: "\u{1F1EF}\u{1F1F5}", name: "\u65E5\u672C\u8A9E", nameEn: "Japanese", available: true },
        { code: "Spanish", flag: "\u{1F1EA}\u{1F1F8}", name: "Espa\xF1ol", nameEn: "Spanish", available: false },
        { code: "French", flag: "\u{1F1EB}\u{1F1F7}", name: "Fran\xE7ais", nameEn: "French", available: false },
        { code: "Italian", flag: "\u{1F1EE}\u{1F1F9}", name: "Italiano", nameEn: "Italian", available: false },
        { code: "Portuguese", flag: "\u{1F1F5}\u{1F1F9}", name: "Portugu\xEAs", nameEn: "Portuguese", available: false },
        { code: "Russian", flag: "\u{1F1F7}\u{1F1FA}", name: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", nameEn: "Russian", available: false },
        { code: "Ukrainian", flag: "\u{1F1FA}\u{1F1E6}", name: "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430", nameEn: "Ukrainian", available: false },
        { code: "Polish", flag: "\u{1F1F5}\u{1F1F1}", name: "Polski", nameEn: "Polish", available: false },
        { code: "Czech", flag: "\u{1F1E8}\u{1F1FF}", name: "\u010Ce\u0161tina", nameEn: "Czech", available: false },
        { code: "Dutch", flag: "\u{1F1F3}\u{1F1F1}", name: "Nederlands", nameEn: "Dutch", available: false },
        { code: "Swedish", flag: "\u{1F1F8}\u{1F1EA}", name: "Svenska", nameEn: "Swedish", available: false },
        { code: "Norwegian", flag: "\u{1F1F3}\u{1F1F4}", name: "Norsk", nameEn: "Norwegian", available: false },
        { code: "Danish", flag: "\u{1F1E9}\u{1F1F0}", name: "Dansk", nameEn: "Danish", available: false },
        { code: "Finnish", flag: "\u{1F1EB}\u{1F1EE}", name: "Suomi", nameEn: "Finnish", available: false },
        { code: "Greek", flag: "\u{1F1EC}\u{1F1F7}", name: "\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC", nameEn: "Greek", available: false },
        { code: "Turkish", flag: "\u{1F1F9}\u{1F1F7}", name: "T\xFCrk\xE7e", nameEn: "Turkish", available: false },
        { code: "Arabic", flag: "\u{1F1F8}\u{1F1E6}", name: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", nameEn: "Arabic", available: false },
        { code: "Hebrew", flag: "\u{1F1EE}\u{1F1F1}", name: "\u05E2\u05D1\u05E8\u05D9\u05EA", nameEn: "Hebrew", available: false },
        { code: "Persian", flag: "\u{1F1EE}\u{1F1F7}", name: "\u0641\u0627\u0631\u0633\u06CC", nameEn: "Persian", available: false },
        { code: "Hindi", flag: "\u{1F1EE}\u{1F1F3}", name: "\u0939\u093F\u0928\u094D\u0926\u0940", nameEn: "Hindi", available: false },
        { code: "Bengali", flag: "\u{1F1E7}\u{1F1E9}", name: "\u09AC\u09BE\u0982\u09B2\u09BE", nameEn: "Bengali", available: false },
        { code: "Urdu", flag: "\u{1F1F5}\u{1F1F0}", name: "\u0627\u0631\u062F\u0648", nameEn: "Urdu", available: false },
        { code: "Chinese", flag: "\u{1F1E8}\u{1F1F3}", name: "\u4E2D\u6587", nameEn: "Chinese (Mandarin)", available: false },
        { code: "Korean", flag: "\u{1F1F0}\u{1F1F7}", name: "\uD55C\uAD6D\uC5B4", nameEn: "Korean", available: false },
        { code: "Thai", flag: "\u{1F1F9}\u{1F1ED}", name: "\u0E44\u0E17\u0E22", nameEn: "Thai", available: false },
        { code: "Vietnamese", flag: "\u{1F1FB}\u{1F1F3}", name: "Ti\u1EBFng Vi\u1EC7t", nameEn: "Vietnamese", available: false },
        { code: "Indonesian", flag: "\u{1F1EE}\u{1F1E9}", name: "Bahasa Indonesia", nameEn: "Indonesian", available: false },
        { code: "Malay", flag: "\u{1F1F2}\u{1F1FE}", name: "Bahasa Melayu", nameEn: "Malay", available: false },
        { code: "Filipino", flag: "\u{1F1F5}\u{1F1ED}", name: "Filipino", nameEn: "Filipino", available: false },
        { code: "Romanian", flag: "\u{1F1F7}\u{1F1F4}", name: "Rom\xE2n\u0103", nameEn: "Romanian", available: false },
        { code: "Hungarian", flag: "\u{1F1ED}\u{1F1FA}", name: "Magyar", nameEn: "Hungarian", available: false },
        { code: "Bulgarian", flag: "\u{1F1E7}\u{1F1EC}", name: "\u0411\u044A\u043B\u0433\u0430\u0440\u0441\u043A\u0438", nameEn: "Bulgarian", available: false },
        { code: "Croatian", flag: "\u{1F1ED}\u{1F1F7}", name: "Hrvatski", nameEn: "Croatian", available: false },
        { code: "Serbian", flag: "\u{1F1F7}\u{1F1F8}", name: "\u0421\u0440\u043F\u0441\u043A\u0438", nameEn: "Serbian", available: false },
        { code: "Slovak", flag: "\u{1F1F8}\u{1F1F0}", name: "Sloven\u010Dina", nameEn: "Slovak", available: false },
        { code: "Slovenian", flag: "\u{1F1F8}\u{1F1EE}", name: "Sloven\u0161\u010Dina", nameEn: "Slovenian", available: false },
        { code: "Lithuanian", flag: "\u{1F1F1}\u{1F1F9}", name: "Lietuvi\u0173", nameEn: "Lithuanian", available: false },
        { code: "Latvian", flag: "\u{1F1F1}\u{1F1FB}", name: "Latvie\u0161u", nameEn: "Latvian", available: false },
        { code: "Estonian", flag: "\u{1F1EA}\u{1F1EA}", name: "Eesti", nameEn: "Estonian", available: false },
        { code: "Georgian", flag: "\u{1F1EC}\u{1F1EA}", name: "\u10E5\u10D0\u10E0\u10D7\u10E3\u10DA\u10D8", nameEn: "Georgian", available: false },
        { code: "Armenian", flag: "\u{1F1E6}\u{1F1F2}", name: "\u0540\u0561\u0575\u0565\u0580\u0565\u0576", nameEn: "Armenian", available: false },
        { code: "Swahili", flag: "\u{1F1F0}\u{1F1EA}", name: "Kiswahili", nameEn: "Swahili", available: false },
        { code: "Afrikaans", flag: "\u{1F1FF}\u{1F1E6}", name: "Afrikaans", nameEn: "Afrikaans", available: false },
        { code: "Catalan", flag: "\u{1F3F4}", name: "Catal\xE0", nameEn: "Catalan", available: false },
        { code: "Basque", flag: "\u{1F3F4}", name: "Euskara", nameEn: "Basque", available: false },
        { code: "Welsh", flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}", name: "Cymraeg", nameEn: "Welsh", available: false },
        { code: "Irish", flag: "\u{1F1EE}\u{1F1EA}", name: "Gaeilge", nameEn: "Irish", available: false },
        { code: "Icelandic", flag: "\u{1F1EE}\u{1F1F8}", name: "\xCDslenska", nameEn: "Icelandic", available: false },
        { code: "Maltese", flag: "\u{1F1F2}\u{1F1F9}", name: "Malti", nameEn: "Maltese", available: false },
        { code: "Albanian", flag: "\u{1F1E6}\u{1F1F1}", name: "Shqip", nameEn: "Albanian", available: false },
        { code: "Macedonian", flag: "\u{1F1F2}\u{1F1F0}", name: "\u041C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438", nameEn: "Macedonian", available: false },
        { code: "Bosnian", flag: "\u{1F1E7}\u{1F1E6}", name: "Bosanski", nameEn: "Bosnian", available: false },
        { code: "Mongolian", flag: "\u{1F1F2}\u{1F1F3}", name: "\u041C\u043E\u043D\u0433\u043E\u043B", nameEn: "Mongolian", available: false },
        { code: "Kazakh", flag: "\u{1F1F0}\u{1F1FF}", name: "\u049A\u0430\u0437\u0430\u049B\u0448\u0430", nameEn: "Kazakh", available: false },
        { code: "Uzbek", flag: "\u{1F1FA}\u{1F1FF}", name: "O\u02BBzbekcha", nameEn: "Uzbek", available: false },
        { code: "Azerbaijani", flag: "\u{1F1E6}\u{1F1FF}", name: "Az\u0259rbaycan", nameEn: "Azerbaijani", available: false },
        { code: "Tamil", flag: "\u{1F1F1}\u{1F1F0}", name: "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD", nameEn: "Tamil", available: false },
        { code: "Telugu", flag: "\u{1F1EE}\u{1F1F3}", name: "\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41", nameEn: "Telugu", available: false },
        { code: "Nepali", flag: "\u{1F1F3}\u{1F1F5}", name: "\u0928\u0947\u092A\u093E\u0932\u0940", nameEn: "Nepali", available: false },
        { code: "Sinhala", flag: "\u{1F1F1}\u{1F1F0}", name: "\u0DC3\u0DD2\u0D82\u0DC4\u0DBD", nameEn: "Sinhala", available: false }
      ];
      STORAGE_KEY2 = "gemini_target_language";
      isOpen = false;
      NATIVE_STORAGE_KEY = "gemini_native_language";
      isNativeOpen = false;
      LanguagePicker = {
        setup: setupLanguagePicker,
        setupNative: setupNativeLanguagePicker,
        getTargetLanguage,
        getNativeLanguage,
        LANGUAGES
      };
    }
  });

  // src/modules/api/vocabulary.ts
  function getNativeLangFlag2() {
    const code = getNativeLanguage();
    const lang = LANGUAGES.find((l) => l.code === code);
    return lang?.flag || "\u{1F1F7}\u{1F1FA}";
  }
  var _VocabularyModule, VocabularyModule, Vocabulary;
  var init_vocabulary = __esm({
    "src/modules/api/vocabulary.ts"() {
      "use strict";
      init_language_picker();
      _VocabularyModule = class _VocabularyModule {
        constructor() {
          // Track words seen in current session
          this.seenWords = /* @__PURE__ */ new Set();
          // Track words already logged (avoid duplicates)  
          this.loggedWords = /* @__PURE__ */ new Set();
          /**
           * Format AI message with vocabulary highlighting
           */
          // Sequential counter for stable hint IDs (reset per formatMessage call)
          this.hintCounter = 0;
        }
        /**
         * Build hint/answer HTML from extracted hint and answer text content.
         * Used by both XML tag parser and plain-text fallback parser.
         */
        buildHintAnswerHtml(hint, answer) {
          const hintId = "hint_" + ++this.hintCounter;
          let hintContentHtml = "";
          let hintParts = hint.split("\u25B8");
          if (hintParts.length <= 1) {
            if (hint.includes("\u2022")) {
              hintParts = hint.split("\u2022");
            } else {
              const cleanHint = hint.replace(/\n\s*(\([А-Яа-яЁё][^)]*?\))/g, " $1");
              if (cleanHint.includes("\n")) {
                hintParts = cleanHint.split(/\n/);
              }
            }
          }
          hintParts = hintParts.map((p) => p.trim()).filter((p) => p.length > 0);
          if (hintParts.length > 1) {
            const title = hintParts[0];
            const items = hintParts.slice(1).filter((item) => {
              const p = item.toLowerCase();
              return !p.startsWith("\u043E\u0442\u0432\u0435\u0442:") && !p.startsWith("answer:") && !p.startsWith("antwort:");
            }).map(
              (item) => `<div class="hint-item">${this.escapeHtml(item)}</div>`
            ).join("");
            hintContentHtml = `
                <div class="hint-header">${this.escapeHtml(title)}</div>
                <div class="hint-list">${items}</div>
            `;
          } else {
            const finalHintText = hintParts.length > 0 ? hintParts[0] : hint;
            hintContentHtml = this.escapeHtml(finalHintText.trim());
          }
          const cleanAnswer = answer.replace(/\n\s*(\([А-Яа-яЁё][^)]*?\))/g, " $1");
          const answerLines = cleanAnswer.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0).filter((l) => !/^(ОТВЕТ\s*\/?\s*ANSWER|ОТВЕТ|ANSWER)$/i.test(l));
          const answerItems = answerLines.map((line) => {
            line = line.trim();
            let className = "answer-item-neutral";
            if (line.startsWith("+")) {
              className = "answer-item-positive";
              line = line.substring(1).trim();
            } else if (line.startsWith("-")) {
              className = "answer-item-negative";
              line = line.substring(1).trim();
            } else if (line.startsWith("~")) {
              className = "answer-item-variant";
              line = line.substring(1).trim();
            }
            const match = line.match(/^(.*?)(\s*\([^)]*[А-Яа-яЁё][^)]*\))\s*$/);
            let germanPart = line;
            let translationPart = "";
            if (match) {
              germanPart = match[1];
              translationPart = match[2];
            }
            return `
                <div class="answer-item ${className}">
                    <div class="answer-content">
                        <span class="answer-german">${this.escapeHtml(germanPart.trim())}</span><button class="tts-inline-btn" onclick="speakThisText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C">\u{1F50A}</button>
                        ${translationPart ? `<br><span class="answer-translation">${this.escapeHtml(translationPart.trim())}&nbsp;<button class="tts-inline-btn" onclick="speakThisText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C">\u{1F50A}</button></span>` : ""}
                    </div>
                </div>
            `;
          }).join("");
          const answerContentHtml = `
            <div class="answer-list">${answerItems}</div>
        `;
          const answerContainerHtml = answer.trim() ? `
                <div class="hint-column">
                    <button class="hint-btn hint-btn-answer hidden" onclick="revealHint('${hintId}', 'answer', event)" title="\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442">\u041E\u0422\u0412\u0415\u0422</button>
                    <div class="hint-panel hint-text hidden" data-type="answer">${answerContentHtml}</div>
                </div>
        ` : "";
          return `
            <div class="hint-container expanded" id="${hintId}">
                <div class="hint-column">
                    <button class="hint-btn hint-btn-hint" onclick="revealHint('${hintId}', 'hint', event)" title="\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0443">\u0413\u0420\u0410\u041C\u041C\u0410\u0422\u0418\u041A\u0410</button>
                    <div class="hint-panel hint-text hidden" data-type="hint">${hintContentHtml}</div>
                </div>
                ${answerContainerHtml}
            </div>
        `.replace(/\s+/g, " ").trim();
        }
        formatMessage(text) {
          if (!text)
            return "";
          text = text.replace(/🔊/g, "");
          this.hintCounter = 0;
          const teacherModeRadio = document.querySelector('input[name="teacher-mode"]:checked');
          const isActiveMode = teacherModeRadio?.value === "active";
          const vocabClassNew = isActiveMode ? "vocab-word-active" : "vocab-word";
          const vocabClassLearned = "vocab-word-learned";
          let formatted = text.replace(_VocabularyModule.LOG_PATTERN, "");
          formatted = this.fixMalformedTags(formatted);
          formatted = formatted.replace(/(?:Ende\s+der\s+Replik|End\s+der\s+Replik|Nächste\s+bitte)[\s.,!?]*/gi, "");
          formatted = formatted.replace(/(?:конец\s+реплики|следующая\s+пожалуйста)[\s.,!?]*/gi, "");
          formatted = formatted.replace(/(?:\[?REPLICA\s+(\d+)\]?:?\s*)+/gi, "REPLICA $1:\n");
          const hintAnswerPlaceholders = /* @__PURE__ */ new Map();
          let placeholderIdx = 0;
          formatted = formatted.replace(/<hint>([\s\S]*?)<\/hint>\s*<answer>([\s\S]*?)<\/answer>/gi, (match) => {
            const key = `__HA_PH_${placeholderIdx++}__`;
            hintAnswerPlaceholders.set(key, match);
            return key;
          });
          formatted = formatted.replace(/<hint>([\s\S]*?)<\/hint>/gi, (match) => {
            const key = `__HA_PH_${placeholderIdx++}__`;
            hintAnswerPlaceholders.set(key, match);
            return key;
          });
          let blockCount = 0;
          const speakerPattern = /(^|\n|<br>)\s*(?:\[?REPLICA\s+(\d+)\]?:?\s*|(\d+)?(?:\]|\.)?\s*(?:Граммини|Grammini|Гrammini|Gраммини|Грамmini|Грамм[а-яА-Яa-zA-Z]*mini|СОБЕСЕДНИК|COБЕСЕДНИК|СОБЕСНИК|COGESPRECHER|COSESPRECHER|SPRECHER|INTERLOCUTOR|Собеседник|ПОЛЬЗОВАТЕЛЬ|УЧЕНИК|УЧИТЕЛЬ|USER|STUDENT|TEACHER|PARTICIPANT|BOT|БОТ|AI|ИИ|ASSISTANT|АССИСТЕНТ)\s*:?\s*)/gi;
          formatted = formatted.replace(
            speakerPattern,
            (_match, p1, p2, p3) => {
              blockCount++;
              const num = p2 || p3;
              const blockNum = num ? num : blockCount.toString();
              const prefix = p1 && p1.trim() ? p1 : "";
              return prefix + `</div></div><div class="dialogue-block" data-dialogue-id="dlg-${blockNum}"><div class="dialogue-header"><span class="dialogue-number">${blockNum}</span><span class="dialogue-speaker-label">\u0413\u0420\u0410\u041C\u041C\u0418\u041D\u0418</span></div><div class="dialogue-content"><span class="translation-icon translation" style="margin-right: 8px;">\u{1F1E9}\u{1F1EA}</span> `;
            }
          );
          formatted = formatted.replace(/^<\/div><\/div>/, "");
          if (formatted.includes("dialogue-block")) {
            formatted += "</div></div>";
          }
          formatted = formatted.replace(
            _VocabularyModule.FLAG_WITH_TRANSLATION_TAG,
            (_m, word, pron, trans) => {
              const clean = word.replace(/[\\*?!]+/g, "").trim().toUpperCase();
              const css = this.seenWords.has(clean) ? vocabClassLearned : vocabClassNew;
              this.seenWords.add(clean);
              const pronPart = pron ? ` ${pron}` : "";
              return `<br><span class="${css}">\u{1F1E9}\u{1F1EA} <strong>${word.trim()}</strong>${pronPart}</span> <span class="translation translation-block">${trans.trim()}</span>`;
            }
          );
          formatted = formatted.replace(
            _VocabularyModule.FLAG_WITH_TRANSLATION,
            (_m, word, pron, trans) => {
              const clean = word.replace(/[\*?!]+/g, "").trim().toUpperCase();
              const css = this.seenWords.has(clean) ? vocabClassLearned : vocabClassNew;
              this.seenWords.add(clean);
              return `<br><span class="${css}">\u{1F1E9}\u{1F1EA} <strong>${word.replace(/\*/g, "")}</strong> ${pron ?? ""} ${trans}</span>`;
            }
          );
          formatted = formatted.replace(
            _VocabularyModule.FLAG_WITH_NUMBER,
            (_m, word, pron, num) => {
              const clean = word.replace(/[\*?!]+/g, "").trim().toUpperCase();
              const css = this.seenWords.has(clean) ? vocabClassLearned : vocabClassNew;
              this.seenWords.add(clean);
              return `<br><span class="${css}">\u{1F1E9}\u{1F1EA} <strong>${word.trim()}</strong> ${pron ?? ""} ${num}</span>`;
            }
          );
          formatted = formatted.replace(
            _VocabularyModule.FLAG_WITH_PRON,
            (_m, word, pron) => {
              const clean = word.replace(/[?!]+$/, "").trim().toUpperCase();
              const css = this.seenWords.has(clean) ? vocabClassLearned : vocabClassNew;
              this.seenWords.add(clean);
              return `<br><span class="${css}">\u{1F1E9}\u{1F1EA} <strong>${word.trim()}</strong> ${pron}</span>`;
            }
          );
          formatted = formatted.replace(
            _VocabularyModule.FLAG_SIMPLE,
            (match, word) => {
              if (match.includes("<span"))
                return match;
              const clean = word.replace(/[?!]+$/, "").trim().toUpperCase();
              const css = this.seenWords.has(clean) ? vocabClassLearned : vocabClassNew;
              this.seenWords.add(clean);
              return `<br><span class="${css}">\u{1F1E9}\u{1F1EA} <strong>${word.trim()}</strong></span>`;
            }
          );
          formatted = formatted.replace(_VocabularyModule.BOLD_PATTERN, '<strong class="german-word">$1</strong>');
          formatted = formatted.replace(/\]\s*<div class="hint-container"/g, '<div class="hint-container"');
          formatted = formatted.replace(/^\s*\]\s*/gm, "");
          formatted = formatted.replace(/\](?=\s*[А-Яа-яA-Za-z])/g, "");
          formatted = formatted.replace(/\]\s*(<br>|$)/gi, "$1");
          const buildTranslationBlock = (trans) => {
            let formattedTrans = trans.replace(/([.!?])\s{1,3}([A-ZÄÖÜА-ЯЁ])/g, "$1<br>$2");
            return `<button class="tts-inline-btn german-tts-btn" onclick="playDialogueText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 (Gemini)">\u{1F50A}</button><div class="translation-block translation selected-theme"><div class="translation-text-section" style="display: flex; flex-direction: row; align-items: flex-start; gap: 6px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1);"><span class="translation-icon" style="flex-shrink: 0;">${getNativeLangFlag2()}</span><span class="translation-text" style="flex-grow: 1;">${formattedTrans}</span><button class="tts-inline-btn translation-tts-btn" style="flex-shrink: 0;" onclick="playTranslationText(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C \u043F\u0435\u0440\u0435\u0432\u043E\u0434">\u{1F50A}</button></div></div>`;
          };
          formatted = formatted.replace(
            /\[TRANSLATION:([^\]]+)\]/gi,
            (_m, trans) => buildTranslationBlock(trans)
          );
          formatted = formatted.replace(
            /\[TRANSLATION:([^\[\n]+?)(?=\[|$|\n)/gi,
            (_m, trans) => buildTranslationBlock(trans)
          );
          formatted = formatted.replace(
            /\[ПЕРЕВОД:([^\]]+)\]/gi,
            (_m, trans) => buildTranslationBlock(trans)
          );
          formatted = formatted.replace(
            /\[RU:\s*([А-Яа-яёЁ][А-Яа-яёЁ\s,\.\/\-\?!\:\;\"\'«»\d]*)\]/g,
            (_m, trans) => buildTranslationBlock(trans)
          );
          formatted = formatted.replace(
            /(?:<\/p>)?\s*(?:<p>|<br>)?\s*\(([А-Яа-яёЁ][А-Яа-яёЁ\s,\.\/\-\—\–\?\!\:\;\"\'\«\»\d\wÄÖÜäöüß]*)\)/g,
            (_m, trans) => buildTranslationBlock(trans)
          );
          formatted = formatted.replace(
            /(?:<\/p>)?\s*(?:<p>|<br>)?\s*\(([А-Яа-яёЁ][А-Яа-яёЁ\s,\.\/\-\—\–\?\!\:\;\"\'\«\»\d\wÄÖÜäöüß]{10,})(?=\s*(?:<\/div>|$))/g,
            ' <button class="tts-inline-btn" onclick="speakDialogueGerman(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439">\u{1F50A}</button> <span class="translation translation-block">($1)&nbsp;<button class="tts-inline-btn" onclick="speakDialogueTranslation(this)" title="\u041F\u0440\u043E\u0441\u043B\u0443\u0448\u0430\u0442\u044C \u043F\u0435\u0440\u0435\u0432\u043E\u0434">\u{1F50A}</button></span>'
          );
          hintAnswerPlaceholders.forEach((originalMatch, placeholderKey) => {
            const combinedMatch = originalMatch.match(/<hint>([\s\S]*?)<\/hint>\s*<answer>([\s\S]*?)<\/answer>/i);
            if (combinedMatch && combinedMatch.length >= 3) {
              const hintContent = combinedMatch[1];
              const answerContent = combinedMatch[2];
              formatted = formatted.replace(placeholderKey, this.buildHintAnswerHtml(hintContent, answerContent));
              return;
            }
            const hintMatch = originalMatch.match(/<hint>([\s\S]*?)<\/hint>/i);
            if (hintMatch && hintMatch.length >= 2) {
              const hintContent = hintMatch[1];
              formatted = formatted.replace(placeholderKey, this.buildHintAnswerHtml(hintContent, ""));
              return;
            }
          });
          if (!formatted.includes("hint-container")) {
            const plainTextPattern = /📜\s*(?:ГРАММ(?:АТИКА|АР|УАР)|GRAMMAR)[\s/]*(?:GRAMMAR)?\s*\n([\s\S]*?)(?:(?:ОТВЕТ\s*\/?\s*ANSWER|ANSWER\s*\/?\s*ОТВЕТ)\s*\n([\s\S]*?))?(?=(?:\n\n(?:\[?REPLICA\s+)?\d+(?:\]?|\.)\s*(?::|Грам[а-яА-Яa-zA-Z]*|Gram[a-zA-Z]*|СОБЕСЕДНИК|COБЕСЕДНИК|СОБЕСНИК|COGESPRECHER|COSESPRECHER|SPRECHER|INTERLOCUTOR|[A-Z]{8,}))|\n\n📜|$)/gi;
            formatted = formatted.replace(plainTextPattern, (_match, hint, answer) => {
              return this.buildHintAnswerHtml(hint, answer || "");
            });
          }
          if (!formatted.includes("hint-container")) {
            formatted = formatted.replace(/([.!?])\s{1,3}([A-ZÄÖÜА-ЯЁ])/g, "$1<br>$2");
          } else {
            formatted = formatted.replace(
              /(<div class="dialogue-content">)(.*?)(<div class="hint-container)/gs,
              (_m, pre, content, post) => {
                const beautified = content.replace(/([.!?])\s{1,3}([A-ZÄÖÜА-ЯЁ])/g, "$1<br>$2");
                return pre + beautified + post;
              }
            );
          }
          return formatted.replace(/(\s*<br>\s*){3,}/gi, "<br><br>").replace(/^(\s*<br>)+/, "");
        }
        /**
         * Clean text for TTS (remove hints, logs, etc)
         */
        cleanForTTS(text) {
          if (!text)
            return "";
          let clean = text.replace(/<hint>[\s\S]*?<\/hint>(\s*<answer>[\s\S]*?<\/answer>)?/gi, "");
          clean = clean.replace(/<hint>[\s\S]*?<\/hint>/gi, "");
          clean = clean.replace(_VocabularyModule.LOG_PATTERN, "");
          clean = clean.replace(/\*\*|__/g, "");
          return clean.trim();
        }
        /**
         * Pre-populate seen words from history
         */
        populateFromHistory(messages) {
          this.seenWords.clear();
          const pattern = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s']+)/g;
          for (const msg of messages) {
            if (msg.role !== "model")
              continue;
            const text = msg.parts?.[0]?.text ?? msg.text ?? "";
            let match;
            while ((match = pattern.exec(text)) !== null) {
              this.seenWords.add(match[1].trim().toUpperCase());
            }
          }
          console.log("[Vocabulary] Loaded", this.seenWords.size, "words from history");
        }
        /**
         * Load learned words from server
         */
        async loadLearnedWords() {
          try {
            console.log("[Vocabulary] Loading learned words...");
            const res = await fetch("/api/export-words");
            if (res.ok) {
              const words = await res.json();
              words.forEach((w) => {
                if (w.term) {
                  const clean = w.term.trim().toUpperCase();
                  this.seenWords.add(clean);
                  this.loggedWords.add(clean);
                }
              });
              console.log(`[Vocabulary] Loaded ${words.length} learned words from server`);
            }
          } catch (e) {
            console.error("[Vocabulary] Failed to load learned words:", e);
          }
        }
        /**
         * Extract and log vocabulary to backend
         */
        async extractAndLog(text) {
          if (!text)
            return;
          console.log("[Vocabulary] extractAndLog called, text length:", text.length);
          let clean = text.replace(_VocabularyModule.LOG_PATTERN, "");
          clean = clean.replace(/(?:повтори|скажи|запомни)[^:]*:\s*[A-ZÄÖÜ](?:[A-ZÄÖÜa-zäöüß,\s]+)(?=\.|$|\n)/gi, "");
          const found = [];
          this.extractWithPattern(clean, _VocabularyModule.EXTRACT_FLAG, found, true);
          this.extractWithPattern(clean, _VocabularyModule.EXTRACT_SIMPLE, found, false);
          this.extractWithPattern(clean, _VocabularyModule.EXTRACT_PRON_ONLY, found, false);
          this.extractWithPattern(clean, _VocabularyModule.EXTRACT_EQUALS, found, false);
          this.extractWithPattern(text, _VocabularyModule.EXTRACT_LOG_TAG, found, false);
          console.log("[Vocabulary] Found words:", found.length, found.map((w) => w.term));
          if (found.length === 0)
            return;
          let successCount = 0;
          const baseLevel = document.getElementById("language-level")?.value ?? "A1";
          const teacherModeRadio = document.querySelector('input[name="teacher-mode"]:checked');
          const isActive = teacherModeRadio?.value === "active";
          const category = isActive ? `${baseLevel} -S` : baseLevel;
          for (const word of found) {
            try {
              console.log("[Vocabulary] Saving:", word.term, "->", word.definition);
              const res = await fetch("/api/notebook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  category,
                  term: word.term,
                  definition: word.definition,
                  context: "Auto-extracted from conversation"
                })
              });
              console.log("[Vocabulary] API response:", res.status);
              if (res.ok) {
                const result = await res.json();
                console.log("[Vocabulary] Saved ID:", result.id);
                if (result.id)
                  successCount++;
              }
            } catch (e) {
              console.error("[Vocabulary] Failed to log:", word.term, e);
            }
          }
          if (successCount > 0) {
            this.showProgressAnimation(successCount);
            this.refreshProgress();
          }
          await this.extractGrammarTopics(text);
        }
        /**
         * Extract and save grammar topics to backend
         */
        async extractGrammarTopics(text) {
          const baseLevel = document.getElementById("language-level")?.value ?? "A1";
          const grammarCategory = `GRAMMAR-${baseLevel}`;
          let match;
          _VocabularyModule.GRAMMAR_LOG_PATTERN.lastIndex = 0;
          while ((match = _VocabularyModule.GRAMMAR_LOG_PATTERN.exec(text)) !== null) {
            const topic = match[1].trim();
            if (!topic || this.loggedWords.has(`GRAMMAR:${topic}`))
              continue;
            try {
              console.log("[Vocabulary] Saving grammar topic:", topic);
              const res = await fetch("/api/notebook", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  category: grammarCategory,
                  term: topic,
                  definition: `\u0413\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0442\u0435\u043C\u0430 ${baseLevel}`,
                  context: "Grammar topic completed in grammar mode"
                })
              });
              if (res.ok) {
                const result = await res.json();
                if (result.id) {
                  this.loggedWords.add(`GRAMMAR:${topic}`);
                  console.log("[Vocabulary] Grammar topic saved:", topic, "ID:", result.id);
                  const Notifications2 = window.Notifications;
                  Notifications2?.showToast?.(`\u{1F4DA} \u0422\u0435\u043C\u0430 \u0443\u0441\u0432\u043E\u0435\u043D\u0430: ${topic}`);
                }
              }
            } catch (e) {
              console.error("[Vocabulary] Failed to save grammar topic:", topic, e);
            }
          }
        }
        extractWithPattern(text, pattern, found, hasPron) {
          let match;
          pattern.lastIndex = 0;
          while ((match = pattern.exec(text)) !== null) {
            const term = match[1].trim().replace(/[?!]+$/, "").toUpperCase();
            const definition = (hasPron ? match[3] : match[2])?.trim().replace(/[.!?,;]+$/, "").trim();
            if (term && definition && term.length > 1 && definition.length > 1 && !this.loggedWords.has(term)) {
              found.push({ term, definition });
              this.loggedWords.add(term);
            }
          }
        }
        showProgressAnimation(count) {
          const widget = document.getElementById("progress-widget");
          if (!widget)
            return;
          const anim = document.createElement("div");
          anim.className = "progress-anim";
          anim.textContent = `+ ${count} \u{1F4DA}`;
          anim.style.cssText = `
            position: absolute; top: 50 %; left: 50 %;
            transform: translate(-50 %, -50 %) scale(1);
            font - size: 32px; font - weight: bold; color: #22c55e;
            text - shadow: 0 0 20px rgba(34, 197, 94, 0.8);
            animation: progressPop 2s ease - out forwards;
            pointer - events: none; z - index: 100;
            `;
          widget.style.position = "relative";
          widget.appendChild(anim);
          widget.style.boxShadow = "0 0 20px rgba(34, 197, 94, 0.6)";
          const Notifications2 = window.Notifications;
          Notifications2?.showToast?.(`+ ${count} \u0441\u043B\u043E\u0432 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E! \u{1F4DA}`);
          setTimeout(() => {
            anim.remove();
            widget.style.boxShadow = "";
          }, 2e3);
        }
        async refreshProgress() {
          const widget = document.getElementById("progress-widget");
          if (!widget)
            return;
          const teacherMode = localStorage.getItem("teacherMode") || "standard";
          if (teacherMode !== "standard") {
            try {
              const res = await fetch("/api/progress");
              const data = await res.json();
              widget.innerHTML = `
                    <div class="progress-mode-info">
                        <div class="mode-info-desc">\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0432 \u0440\u0435\u0436\u0438\u043C\u0435 \u{1F4D6} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442</div>
                        <div class="total-words">\u0412\u0441\u0435\u0433\u043E \u0441\u043B\u043E\u0432: <strong>${data.total_words || 0}</strong></div>
                    </div>
                `;
            } catch {
              widget.innerHTML = '<div class="progress-mode-info"><div class="mode-info-desc">\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0432 \u0440\u0435\u0436\u0438\u043C\u0435 \u{1F4D6} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442</div></div>';
            }
            return;
          }
          try {
            const res = await fetch("/api/progress");
            const data = await res.json();
            if (data.levels) {
              const currentLevel = document.getElementById("language-level")?.value ?? "A2";
              let html = "";
              for (const level of data.levels) {
                const isSpeaker = level.level.endsWith("-S");
                const baseLevel = isSpeaker ? level.level.slice(0, -2) : level.level;
                const isCurrent = baseLevel === currentLevel;
                let badgeClass = "";
                if (isSpeaker)
                  badgeClass = "speaker";
                else if (level.is_certified)
                  badgeClass = "certified";
                else if (isCurrent)
                  badgeClass = "current";
                html += `
                        <div class="progress-level" title="${level.completed_modules} \u0441\u043B\u043E\u0432">
                            <span class="level-badge ${badgeClass}">${level.level}</span>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill${isSpeaker ? " speaker" : ""}" style="width: ${level.percent}%"></div>
                            </div>
                            <span class="progress-percent">${level.completed_modules}</span>
                            <button class="btn-reset-level" onclick="Vocabulary.resetLevel('${level.level}')" title="\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C ${level.level}">\u{1F5D1}\uFE0F</button>
                        </div>
                    `;
              }
              html += `<div class="total-words">\u0412\u0441\u0435\u0433\u043E \u0441\u043B\u043E\u0432: <strong>${data.total_words}</strong></div>`;
              widget.innerHTML = html;
            }
          } catch (e) {
            console.error("[Vocabulary] Failed to refresh:", e);
          }
        }
        async resetLevel(level) {
          const Notifications2 = window.Notifications;
          Notifications2?.confirmAction?.(`\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0443\u0440\u043E\u0432\u043D\u044F ${level}?<br><br>\u0412\u0441\u0435 \u0441\u043B\u043E\u0432\u0430 \u044D\u0442\u043E\u0433\u043E \u0443\u0440\u043E\u0432\u043D\u044F \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B!`, async () => {
            try {
              const res = await fetch(`/api/progress/reset?level=${level}`, { method: "DELETE" });
              if (res.ok) {
                this.loggedWords.clear();
                this.refreshProgress();
                Notifications2?.showToast?.(`\u2705 \u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 ${level} \u0441\u0431\u0440\u043E\u0448\u0435\u043D!`);
              }
            } catch (e) {
              console.error("[Vocabulary] Reset failed:", e);
            }
          });
        }
        clearLogged() {
          this.loggedWords.clear();
        }
        escapeHtml(text) {
          const div = document.createElement("div");
          div.textContent = text;
          return div.innerHTML;
        }
        /**
         * Fix malformed tags (unclosed XML hint/answer tags)
         */
        fixMalformedTags(text) {
          if (!text)
            return "";
          let fixed = text.replace(/<hint>([\s\S]*?)(?=<answer>|<hint>|$)/gi, (match, content) => {
            if (!match.includes("</hint>"))
              return `<hint>${content}</hint>`;
            return match;
          });
          fixed = fixed.replace(/<answer>([\s\S]*?)(?=<hint>|$)/gi, (match, content) => {
            if (!match.includes("</answer>"))
              return `<answer>${content}</answer>`;
            return match;
          });
          return fixed;
        }
        /**
         * Speak text using Gemini TTS ONLY.
         * No fallback to Web Speech API.
         */
        async speakText(text, voice = "Puck") {
          if (!text)
            return;
          const cleanText = this.cleanForTTS(text);
          if (!cleanText)
            return;
          console.log("[Vocabulary] Speaking (Gemini Only):", cleanText);
          const ttsCache = window.__ttsCache;
          if (ttsCache && ttsCache.has(cleanText)) {
            console.log("[TTS] Serving from cache");
            const audioData = ttsCache.get(cleanText);
            const AudioPlayback2 = window.AudioPlayback;
            if (AudioPlayback2?.playChunk && audioData) {
              AudioPlayback2.playChunk(audioData);
              return;
            }
          }
          try {
            const apiKeyInput = document.getElementById("api-key");
            let apiKey = apiKeyInput?.value?.trim() || localStorage.getItem("gemini_api_key") || "";
            if (document.getElementById("api-key")) {
              document.getElementById("api-key").value = apiKey;
            }
            if (!apiKey) {
              console.warn("[TTS] No API key provided");
              return;
            }
            const response = await fetch("/api/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                api_key: apiKey,
                text: cleanText,
                voice
              })
            });
            if (!response.ok) {
              const errorText = await response.text();
              if (response.status === 429 || errorText.includes("429") || errorText.includes("RESOURCE_EXHAUSTED")) {
                console.warn("[TTS] Rate limit exceeded (429). Silence (Fallback disabled).");
                const Notifications2 = window.Notifications;
                Notifications2?.showToast?.("\u26A0\uFE0F Rate Limit (Wait 1m).");
              } else {
                console.error(`[TTS] API Error: ${response.status} - ${errorText}`);
              }
              return;
            }
            const data = await response.json();
            if (data.audio) {
              if (ttsCache)
                ttsCache.set(cleanText, data.audio);
              const AudioPlayback2 = window.AudioPlayback;
              AudioPlayback2?.playChunk?.(data.audio);
            }
          } catch (e) {
            console.error("[TTS] Failed to generate speech:", e);
          }
        }
      };
      // Pre-compiled regex patterns (performance optimization)
      // More flexible lookahead - stop only at next 🇩🇪 flag or end of text
      _VocabularyModule.FLAG_WITH_TRANSLATION = /🇩🇪\s*(\*{0,2}[A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s?!'\.…]+?\*{0,2})\s*(\([^)]+\))?\s*([-–—:]\s*[А-Яа-яЁё][А-Яа-яЁё\s,\.!?…]+?)(?=\s*🇩🇪|\s*$|\n\n|\n[А-ЯA-Z])/gi;
      _VocabularyModule.FLAG_WITH_NUMBER = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s?!']{1,40}?)\s*(\([^)]+\))?\s*([-–—:]\s*\d+)(?=\s*🇩🇪|\s*$|\s*\n|\s+[А-Яа-яA-Z])/gi;
      _VocabularyModule.FLAG_WITH_PRON = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s?!'\.…]{2,50}?)\s*(\([^)]+\))(?!\s*[-–—:])/gi;
      _VocabularyModule.FLAG_SIMPLE = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s?!']{2,40}?)(?=\s*🇩🇪|\s*$|\s*[.!?,;:](?:\s|$)|\s*\n)/gi;
      // NEW: Pattern for german-only mode format: 🇩🇪 WORD (pron) - [TRANSLATION:...]
      _VocabularyModule.FLAG_WITH_TRANSLATION_TAG = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s?!'\.…]{1,50}?)\s*(\([^)]+\))?\s*[-–—:]\s*\[TRANSLATION:([^\]]+)\]/gi;
      _VocabularyModule.BOLD_PATTERN = /\*\*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s]+)\*\*/g;
      // Supports both old (LOG: ...) and new [log_learning_item:...] formats
      _VocabularyModule.LOG_PATTERN = /(?:\[\s*(?:log_learning_item|LOG)(?:[:\s]\s*|)([^\]]*)\])|(?:log_learning_item\s*\([^)]*\)\s*)|(?:\[LOG:[^\]]*\])/gi;
      // Extraction patterns - more flexible for various formats
      // Pattern for: 🇩🇪 WORD (pron) - Translation (most complete)
      // Include … and multiple dots in translation
      _VocabularyModule.EXTRACT_FLAG = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s'?!\.…]{1,50}?)\s*\(([^)]+)\)\s*[-–—:]\s*([А-Яа-яЁё][А-Яа-яЁё\s,\.!?…]+?)(?=\s*🇩🇪|\s*$|\n\n|\n[А-ЯA-Z])/g;
      // Pattern for: 🇩🇪 WORD - Translation (no pronunciation)  
      _VocabularyModule.EXTRACT_SIMPLE = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s'?!\.…]{1,50}?)\s*[-–—:]\s*([А-Яа-яЁё][А-Яа-яЁё\s,\.!?…]+?)(?=\s*🇩🇪|\s*$|\n\n|\n[А-ЯA-Z])/g;
      // Pattern for: 🇩🇪 WORD (pron) without translation - use pronunciation as definition
      _VocabularyModule.EXTRACT_PRON_ONLY = /🇩🇪\s*([A-ZÄÖÜ][A-ZÄÖÜa-zäöüß\s'?!\.…]{1,50}?)\s*\(([^)]+)\)(?!\s*[-–—:])/g;
      // Pattern for: Word = Translation
      _VocabularyModule.EXTRACT_EQUALS = /([A-ZÄÖÜa-zäöüß'][A-ZÄÖÜa-zäöüß'\s]{1,30})\s*=\s*([А-Яа-яЁё][А-Яа-яЁё\s]{2,30})/gi;
      // Pattern for extraction from [log_learning_item:TERM:DEFINITION]
      _VocabularyModule.EXTRACT_LOG_TAG = /\[\s*(?:log_learning_item|LOG)(?:[:\s]\s*)([^:\]]+):([^\]]+)\]/gi;
      // Pattern for grammar topic logging: [LOG: GRAMMAR: topic_name]
      _VocabularyModule.GRAMMAR_LOG_PATTERN = /\[LOG:\s*GRAMMAR:\s*([^\]]+)\]/gi;
      VocabularyModule = _VocabularyModule;
      Vocabulary = new VocabularyModule();
      if (typeof window !== "undefined") {
        window.Vocabulary = Vocabulary;
        window.formatVocabularyMessage = (t2) => Vocabulary.formatMessage(t2);
        window.populateSeenWordsFromHistory = (m) => Vocabulary.populateFromHistory(m);
        window.extractAndLogVocabulary = (t2) => Vocabulary.extractAndLog(t2);
        window.refreshProgress = () => Vocabulary.refreshProgress();
        window.resetLevelProgress = (l) => Vocabulary.resetLevel(l);
        window.loadLearnedWords = () => Vocabulary.loadLearnedWords();
        window.speakText = (text, voice) => Vocabulary.speakText(text, voice);
        window.revealHint = (containerId, type, event) => {
          let container2 = null;
          if (event && event.target) {
            container2 = event.target.closest(".hint-container");
          }
          if (!container2) {
            container2 = document.getElementById(containerId);
          }
          if (!container2)
            return;
          const hintBtn = container2.querySelector(".hint-btn-hint");
          const answerBtn = container2.querySelector(".hint-btn-answer");
          const hintText = container2.querySelector('[data-type="hint"]');
          const answerText = container2.querySelector('[data-type="answer"]');
          if (type === "hint") {
            if (hintText) {
              if (!hintText.classList.contains("hidden")) {
                hintText.classList.add("hidden");
                if (hintBtn) {
                  hintBtn.classList.remove("used", "hidden");
                }
                if (answerBtn) {
                  answerBtn.classList.add("hidden");
                }
              } else {
                hintText.classList.remove("hidden");
                if (hintBtn)
                  hintBtn.classList.add("used", "hidden");
                if (answerBtn)
                  answerBtn.classList.remove("hidden");
              }
            }
          } else if (type === "answer") {
            if (answerText) {
              if (!answerText.classList.contains("hidden")) {
                answerText.classList.add("hidden");
                if (answerBtn) {
                  answerBtn.classList.remove("used", "hidden");
                }
              } else {
                answerText.classList.remove("hidden");
                if (answerBtn)
                  answerBtn.classList.add("used", "hidden");
              }
            }
          }
          const chatContainer = document.getElementById("chat-messages");
          if (chatContainer) {
            requestAnimationFrame(() => {
              const blockEl = container2.closest(".dialogue-block");
              if (blockEl) {
                blockEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            });
          }
        };
        const ttsCache = window.__ttsCache || /* @__PURE__ */ new Map();
        window.__ttsCache = ttsCache;
        window.speakThisText = async (button) => {
          const btn = button;
          const prevEl = btn.previousElementSibling;
          if (!prevEl)
            return;
          const text = prevEl.textContent?.trim() || "";
          if (!text)
            return;
          const original = btn.textContent;
          btn.textContent = "\u23F3";
          btn.disabled = true;
          try {
            await Vocabulary.speakText(text);
            btn.textContent = "\u2705";
            setTimeout(() => {
              btn.textContent = original || "\u{1F50A}";
              btn.disabled = false;
            }, 1500);
          } catch (e) {
            btn.textContent = "\u274C";
            setTimeout(() => {
              btn.textContent = original || "\u{1F50A}";
              btn.disabled = false;
            }, 2e3);
          }
        };
        window.speakDialogueGerman = async (button) => {
          const btn = button;
          const dialogueContent = btn.closest(".dialogue-content") || btn.closest(".dialogue-block")?.querySelector(".dialogue-content");
          if (!dialogueContent)
            return;
          const clone = dialogueContent.cloneNode(true);
          clone.querySelectorAll(".translation, .translation-block, .tts-inline-btn, .tts-bar, .hint-container, .enrichment-loader").forEach((el) => el.remove());
          let germanText = clone.textContent?.trim() || "";
          germanText = germanText.replace(/\([^)]*[А-Яа-яЁё][^)]*\)/g, "").trim();
          if (!germanText)
            return;
          const original = btn.innerHTML;
          btn.textContent = "\u23F3";
          btn.disabled = true;
          try {
            await Vocabulary.speakText(germanText);
            btn.textContent = "\u2705";
            setTimeout(() => {
              btn.innerHTML = original;
              btn.disabled = false;
            }, 1500);
          } catch (e) {
            btn.textContent = "\u274C";
            setTimeout(() => {
              btn.innerHTML = original;
              btn.disabled = false;
            }, 2e3);
          }
        };
        window.speakDialogueTranslation = async (button) => {
          const btn = button;
          const dialogueContent = btn.closest(".dialogue-content") || btn.closest(".dialogue-block")?.querySelector(".dialogue-content");
          if (!dialogueContent)
            return;
          const fullText = dialogueContent.textContent || "";
          const matches = fullText.match(/\(([^)]*[А-Яа-яЁё][^)]*)\)/g);
          if (!matches || matches.length === 0)
            return;
          const translationText = matches.map((m) => m.replace(/^\(|\)$/g, "")).join(". ").trim();
          if (!translationText)
            return;
          const original = btn.innerHTML;
          btn.textContent = "\u23F3";
          btn.disabled = true;
          try {
            await Vocabulary.speakText(translationText);
            btn.textContent = "\u2705";
            setTimeout(() => {
              btn.innerHTML = original;
              btn.disabled = false;
            }, 1500);
          } catch (e) {
            btn.textContent = "\u274C";
            setTimeout(() => {
              btn.innerHTML = original;
              btn.disabled = false;
            }, 2e3);
          }
        };
        window.playDialogueText = async (button) => {
          const dialogueBlock = button.closest(".dialogue-block");
          if (!dialogueBlock)
            return;
          const dialogueContent = dialogueBlock.querySelector(".dialogue-content");
          if (!dialogueContent)
            return;
          const clone = dialogueContent.cloneNode(true);
          clone.querySelectorAll(".translation").forEach((el) => el.remove());
          const germanText = clone.textContent?.trim() || "";
          if (!germanText)
            return;
          const originalContent = button.textContent;
          button.textContent = "\u23F3";
          button.setAttribute("disabled", "true");
          try {
            let audioData;
            if (ttsCache.has(germanText)) {
              console.log("[TTS] Using cached audio");
              audioData = ttsCache.get(germanText);
            } else {
              const apiKey = localStorage.getItem("gemini_api_key") || "";
              if (!apiKey) {
                throw new Error("API key not found in gemini_api_key");
              }
              const selectedVoice = document.getElementById("voice-select")?.value || "Zephyr";
              const response = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  api_key: apiKey,
                  text: germanText,
                  voice: selectedVoice
                  // Use user-selected voice (not hardcoded)
                })
              });
              if (!response.ok) {
                throw new Error(`TTS API error: ${response.status}`);
              }
              const data = await response.json();
              audioData = data.audio;
              ttsCache.set(germanText, audioData);
              console.log("[TTS] Audio cached, cache size:", ttsCache.size);
            }
            const pcmBytes = Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
            const audioContext = new AudioContext({ sampleRate: 24e3 });
            const numSamples = pcmBytes.length / 2;
            const audioBuffer = audioContext.createBuffer(1, numSamples, 24e3);
            const channelData = audioBuffer.getChannelData(0);
            const dataView = new DataView(pcmBytes.buffer);
            for (let i = 0; i < numSamples; i++) {
              const sample = dataView.getInt16(i * 2, true);
              channelData[i] = sample / 32768;
            }
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            const playbackRate = window.ttsPlaybackRate || 1;
            source.playbackRate.value = playbackRate;
            const volumeStr = localStorage.getItem("app_volume");
            const volumeFloat = volumeStr ? parseInt(volumeStr, 10) / 100 : 1;
            const gainNode = audioContext.createGain();
            gainNode.gain.value = volumeFloat;
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            try {
              const karaokeWords = Array.from(
                dialogueContent.querySelectorAll(".karaoke-word")
              );
              if (karaokeWords.length > 0) {
                const durationMs = numSamples / 24e3 / playbackRate * 1e3;
                let totalChars = 0;
                karaokeWords.forEach((w) => {
                  const text = w.textContent || "";
                  totalChars += text.length;
                  if (/[.,!?:;]/.test(text))
                    totalChars += 3;
                });
                const weightPerChar = durationMs / Math.max(1, totalChars + karaokeWords.length * 1.5);
                const parentBlock = dialogueContent.closest(".dialogue-block");
                if (parentBlock) {
                  parentBlock.classList.add("dialogue-block-active");
                }
                let accumulatedDelayMs = 0;
                karaokeWords.forEach((word) => {
                  const wordDelay = accumulatedDelayMs;
                  const text = word.textContent || "";
                  let charsWeight = text.length;
                  if (/[.,!?:;]/.test(text))
                    charsWeight += 3;
                  accumulatedDelayMs += (charsWeight + 1.5) * weightPerChar;
                  setTimeout(() => {
                    try {
                      word.classList.add("karaoke-active");
                      word.classList.add("karaoke-spoken");
                      setTimeout(() => {
                        word.classList.remove("karaoke-active");
                      }, 300);
                      const chatContainer = document.getElementById("chat-messages");
                      const scrollFollowEnabled = window.scrollFollowMode !== false;
                      if (scrollFollowEnabled && chatContainer) {
                        const containerRect = chatContainer.getBoundingClientRect();
                        const wordRect = word.getBoundingClientRect();
                        const viewportBottom = containerRect.top + containerRect.height * 0.7;
                        if (wordRect.top > viewportBottom || wordRect.bottom < containerRect.top + 50) {
                          chatContainer.scrollTo({
                            top: chatContainer.scrollTop + (wordRect.top - containerRect.top) - containerRect.height * 0.3,
                            behavior: "smooth"
                          });
                        }
                      }
                    } catch (_e) {
                    }
                  }, wordDelay);
                });
              }
            } catch (_e) {
              console.warn("[TTS] Karaoke highlighting error (non-fatal):", _e);
            }
            button.textContent = "\u{1F50A}";
            source.onended = () => {
              button.textContent = originalContent || "\u{1F50A}";
              button.removeAttribute("disabled");
              audioContext.close();
              const parentBlock = dialogueContent.closest(".dialogue-block");
              if (parentBlock)
                parentBlock.classList.remove("dialogue-block-active");
            };
            source.start();
          } catch (error) {
            console.error("[TTS] Gemini TTS error:", error);
            button.textContent = "\u274C";
            button.removeAttribute("disabled");
            if ("speechSynthesis" in window) {
              console.log("[TTS] Falling back to Web Speech API");
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(germanText);
              utterance.lang = "de-DE";
              utterance.rate = 0.9;
              button.textContent = "\u{1F50A}";
              utterance.onend = () => {
                button.textContent = originalContent || "\u{1F50A}";
              };
              window.speechSynthesis.speak(utterance);
            } else {
              setTimeout(() => {
                button.textContent = originalContent || "\u{1F50A}";
              }, 2e3);
            }
          }
        };
        window.playTranslationText = (button) => {
          const transBlock = button.closest(".translation-block");
          if (!transBlock)
            return;
          const transTextNode = transBlock.querySelector(".translation-text");
          const text = transTextNode?.textContent?.trim() || "";
          if (!text)
            return;
          const originalContent = button.textContent;
          button.textContent = "\u23F3";
          button.setAttribute("disabled", "true");
          if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            const getNativeLangCode = window.LanguagePicker?.getNativeLanguageCode;
            utterance.lang = getNativeLangCode ? getNativeLangCode() : "ru-RU";
            const playbackRate = window.ttsPlaybackRate || 1;
            utterance.rate = playbackRate;
            button.textContent = "\u{1F50A}";
            utterance.onend = () => {
              button.textContent = originalContent || "\u{1F50A}";
              button.removeAttribute("disabled");
            };
            utterance.onerror = (e) => {
              console.error("[TTS] Translation playback error:", e);
              button.textContent = "\u274C";
              setTimeout(() => {
                button.textContent = originalContent || "\u{1F50A}";
                button.removeAttribute("disabled");
              }, 2e3);
            };
            window.speechSynthesis.speak(utterance);
          } else {
            console.error("[TTS] Web Speech API not supported");
            button.textContent = "\u274C";
            setTimeout(() => {
              button.textContent = originalContent || "\u{1F50A}";
              button.removeAttribute("disabled");
            }, 2e3);
          }
        };
      }
      console.log("[Vocabulary] Module loaded (TS)");
    }
  });

  // src/modules/ui/theme-effects.ts
  var theme_effects_exports = {};
  __export(theme_effects_exports, {
    applyThemeEffects: () => applyThemeEffects,
    clearThemeEffects: () => clearThemeEffects,
    toggleThemeEffects: () => toggleThemeEffects
  });
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }
  function spawnParticle(emoji, size, speed, dir) {
    const el = document.createElement("div");
    el.className = "theme-particle";
    el.textContent = emoji;
    el.style.fontSize = `${size}px`;
    el.style.left = `${rand(3, 97)}%`;
    el.style.setProperty("--duration", `${speed + rand(0, speed * 0.5)}s`);
    el.style.setProperty("--delay", `-${rand(0, speed)}s`);
    el.style.setProperty("--drift", `${rand(0, 0)}px`);
    if (dir === "fall") {
      el.classList.add("particle-fall");
      el.style.top = "-5%";
    } else if (dir === "rise") {
      el.classList.add("particle-rise");
      el.style.bottom = "-5%";
    } else {
      el.classList.add("particle-float");
      el.style.top = `${rand(10, 85)}%`;
    }
    el.style.opacity = `${rand(0.25, 0.55)}`;
    return el;
  }
  function spawnOrb(color, maxSize) {
    const el = document.createElement("div");
    el.className = "theme-orb";
    const size = rand(maxSize * 0.4, maxSize);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
    el.style.left = `${rand(5, 85)}%`;
    el.style.top = `${rand(5, 85)}%`;
    el.style.setProperty("--orb-duration", `${rand(12, 30)}s`);
    el.style.setProperty("--orb-drift-x", `${rand(-80, 80)}px`);
    el.style.setProperty("--orb-drift-y", `${rand(-50, 50)}px`);
    return el;
  }
  function spawnShaft(color, width = 60) {
    const el = document.createElement("div");
    el.className = "theme-shaft";
    el.style.left = `${rand(5, 90)}%`;
    el.style.background = `linear-gradient(180deg, ${color} 0%, transparent 100%)`;
    el.style.width = `${rand(width * 0.6, width * 1.4)}px`;
    el.style.setProperty("--shaft-duration", `${rand(6, 14)}s`);
    el.style.setProperty("--shaft-delay", `-${rand(0, 10)}s`);
    return el;
  }
  function spawnSunburst(color, x, y) {
    const el = document.createElement("div");
    el.className = "theme-sunburst";
    el.style.left = x;
    el.style.top = y;
    el.style.background = `radial-gradient(circle, ${color} 0%, transparent 60%)`;
    return el;
  }
  function spawnFirefly(color, theme) {
    const el = document.createElement("div");
    el.className = "theme-firefly";
    if (theme === "dark") {
      el.classList.add("firefly-static");
    }
    el.style.left = `${rand(5, 95)}%`;
    el.style.top = `${rand(10, 90)}%`;
    el.style.setProperty("--glow-duration", `${rand(2.5, 5.5)}s`);
    el.style.setProperty("--drift-x", `${rand(-40, 40)}px`);
    el.style.setProperty("--drift-y", `${rand(-30, 30)}px`);
    el.style.setProperty("--firefly-color", color);
    return el;
  }
  function applyThemeEffects(theme) {
    clearThemeEffects();
    const config = THEMES[theme];
    if (!config)
      return;
    if (localStorage.getItem("gemini_theme_bg") === "false")
      return;
    container = document.createElement("div");
    container.id = "theme-effects-container";
    document.body.appendChild(container);
    if (config.sunburst) {
      container.appendChild(spawnSunburst(config.sunburst.color, config.sunburst.x, config.sunburst.y));
    }
    for (const orbGroup of config.orbs) {
      for (let i = 0; i < orbGroup.count; i++) {
        container.appendChild(spawnOrb(orbGroup.color, orbGroup.maxSize));
      }
    }
    if (config.shafts) {
      for (let i = 0; i < config.shafts.count; i++) {
        container.appendChild(spawnShaft(config.shafts.color, config.shafts.width));
      }
    }
    for (const group of config.particles) {
      for (let i = 0; i < group.count; i++) {
        const size = rand(group.sizeRange[0], group.sizeRange[1]);
        const speed = rand(group.speedRange[0], group.speedRange[1]);
        let dir = "fall";
        if (theme === "ocean")
          dir = "rise";
        else if (["warm", "dark", "light"].includes(theme) && group.emoji !== "\u2604\uFE0F")
          dir = "float";
        container.appendChild(spawnParticle(group.emoji, size, speed, dir));
      }
    }
    if (config.fireflyCount && config.fireflyColor) {
      for (let i = 0; i < config.fireflyCount; i++) {
        container.appendChild(spawnFirefly(config.fireflyColor, theme));
      }
    }
  }
  function clearThemeEffects() {
    container?.remove();
    container = null;
  }
  function toggleThemeEffects(enabled) {
    if (enabled)
      applyThemeEffects(document.body.dataset.theme || "dark");
    else
      clearThemeEffects();
  }
  var THEMES, container;
  var init_theme_effects = __esm({
    "src/modules/ui/theme-effects.ts"() {
      "use strict";
      THEMES = {
        forest: {
          particles: [
            { emoji: "\u{1F343}", count: 7, sizeRange: [12, 22], speedRange: [12, 26] },
            { emoji: "\u{1F33F}", count: 4, sizeRange: [10, 18], speedRange: [16, 30] },
            { emoji: "\u{1F342}", count: 4, sizeRange: [10, 16], speedRange: [14, 28] }
          ],
          orbs: [
            { color: "rgba(74, 222, 128, 0.18)", count: 5, maxSize: 160 },
            { color: "rgba(34, 197, 94, 0.12)", count: 4, maxSize: 220 }
          ],
          shafts: { color: "rgba(200, 255, 180, 0.06)", count: 4, width: 80 },
          fireflyCount: 14,
          fireflyColor: "rgba(180, 255, 120, 0.85)",
          sunburst: { color: "rgba(200, 255, 150, 0.06)", x: "80%", y: "10%" }
        },
        sakura: {
          particles: [
            { emoji: "\u{1F338}", count: 12, sizeRange: [10, 20], speedRange: [10, 22] },
            { emoji: "\u{1F4AE}", count: 5, sizeRange: [8, 16], speedRange: [12, 26] },
            { emoji: "\u{1F380}", count: 3, sizeRange: [8, 14], speedRange: [14, 28] }
          ],
          orbs: [
            { color: "rgba(232, 121, 168, 0.16)", count: 5, maxSize: 180 },
            { color: "rgba(192, 132, 252, 0.12)", count: 4, maxSize: 200 }
          ],
          shafts: { color: "rgba(255, 180, 220, 0.05)", count: 3 }
        },
        warm: {
          particles: [
            { emoji: "\u2728", count: 8, sizeRange: [6, 14], speedRange: [8, 18] },
            { emoji: "\u{1F525}", count: 4, sizeRange: [10, 18], speedRange: [10, 22] },
            { emoji: "\u{1F4AB}", count: 5, sizeRange: [8, 16], speedRange: [12, 24] },
            { emoji: "\u{1F56F}\uFE0F", count: 3, sizeRange: [12, 20], speedRange: [18, 32] }
          ],
          orbs: [
            { color: "rgba(232, 145, 90, 0.18)", count: 6, maxSize: 170 },
            { color: "rgba(255, 160, 60, 0.1)", count: 4, maxSize: 240 }
          ],
          sunburst: { color: "rgba(255, 180, 80, 0.08)", x: "50%", y: "40%" }
        },
        twilight: {
          particles: [
            { emoji: "\u2B50", count: 10, sizeRange: [4, 12], speedRange: [16, 36] },
            { emoji: "\u{1F4AB}", count: 4, sizeRange: [8, 16], speedRange: [10, 22] },
            { emoji: "\u{1F319}", count: 1, sizeRange: [20, 30], speedRange: [40, 60] },
            { emoji: "\u2726", count: 8, sizeRange: [3, 9], speedRange: [20, 40] }
          ],
          orbs: [
            { color: "rgba(124, 127, 241, 0.15)", count: 4, maxSize: 180 },
            { color: "rgba(168, 85, 247, 0.1)", count: 5, maxSize: 220 }
          ],
          fireflyCount: 16,
          fireflyColor: "rgba(160, 170, 255, 0.75)"
        },
        ocean: {
          particles: [
            { emoji: "\u{1FAE7}", count: 10, sizeRange: [8, 18], speedRange: [10, 22] },
            { emoji: "\u{1F41F}", count: 3, sizeRange: [14, 22], speedRange: [12, 20] },
            { emoji: "\u{1F420}", count: 2, sizeRange: [12, 20], speedRange: [14, 24] },
            { emoji: "\u{1FAB8}", count: 2, sizeRange: [10, 18], speedRange: [28, 45] }
          ],
          orbs: [
            { color: "rgba(56, 189, 248, 0.15)", count: 5, maxSize: 180 },
            { color: "rgba(34, 211, 238, 0.1)", count: 4, maxSize: 240 }
          ],
          shafts: { color: "rgba(56, 189, 248, 0.04)", count: 4, width: 60 },
          sunburst: { color: "rgba(56, 220, 255, 0.05)", x: "50%", y: "0%" }
        },
        dark: {
          particles: [
            { emoji: "\u2726", count: 20, sizeRange: [1, 1], speedRange: [50, 50] },
            { emoji: "\u2B50", count: 10, sizeRange: [1, 2], speedRange: [28, 48] }
          ],
          orbs: [
            { color: "rgba(99, 102, 241, 0.12)", count: 4, maxSize: 200 },
            { color: "rgba(139, 92, 246, 0.08)", count: 4, maxSize: 260 }
          ],
          fireflyCount: 18,
          fireflyColor: "rgba(180, 200, 255, 0.65)"
        },
        light: {
          particles: [
            { emoji: "\u{1F98B}", count: 5, sizeRange: [14, 22], speedRange: [12, 25] },
            { emoji: "\u2601\uFE0F", count: 4, sizeRange: [22, 38], speedRange: [30, 50] },
            { emoji: "\u{1F324}\uFE0F", count: 1, sizeRange: [26, 34], speedRange: [45, 65] },
            { emoji: "\u{1F33B}", count: 3, sizeRange: [12, 20], speedRange: [18, 32] }
          ],
          orbs: [
            { color: "rgba(250, 204, 21, 0.1)", count: 4, maxSize: 200 },
            { color: "rgba(79, 70, 229, 0.06)", count: 3, maxSize: 180 }
          ],
          shafts: { color: "rgba(255, 255, 200, 0.06)", count: 4, width: 90 },
          sunburst: { color: "rgba(255, 240, 150, 0.1)", x: "75%", y: "5%" }
        }
      };
      container = null;
    }
  });

  // src/main.ts
  init_audio_capture();
  init_audio_playback();
  init_screen_capture();
  init_vocabulary();
  init_streaming_display();

  // src/modules/ui/notifications.ts
  var NotificationsModule = class {
    constructor() {
      this.container = null;
    }
    /**
     * Show toast notification
     */
    showToast(message, duration = 3e3) {
      const container2 = this.getContainer();
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.innerHTML = message;
      container2.appendChild(toast);
      requestAnimationFrame(() => {
        toast.classList.add("show");
      });
      setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
    getContainer() {
      if (!this.container) {
        this.container = document.getElementById("toast-container");
        if (!this.container) {
          this.container = document.createElement("div");
          this.container.id = "toast-container";
          this.container.className = "toast-container";
          document.body.appendChild(this.container);
        }
      }
      return this.container;
    }
    /**
     * Confirm action with modal
     */
    confirmAction(message, onConfirm) {
      const overlay2 = document.createElement("div");
      overlay2.className = "confirm-overlay";
      overlay2.innerHTML = `
            <div class="confirm-modal">
                <div class="confirm-message">${message}</div>
                <div class="confirm-buttons">
                    <button class="confirm-btn confirm-no">\u274C \u041D\u0435\u0442</button>
                    <button class="confirm-btn confirm-yes">\u2705 \u0414\u0430</button>
                </div>
            </div>
        `;
      const close = () => overlay2.remove();
      overlay2.querySelector(".confirm-no").addEventListener("click", close);
      overlay2.querySelector(".confirm-yes").addEventListener("click", () => {
        close();
        onConfirm();
      });
      overlay2.addEventListener("click", (e) => {
        if (e.target === overlay2)
          close();
      });
      document.body.appendChild(overlay2);
    }
    /**
     * Show log notification for vocabulary
     */
    showLogNotification(args) {
      const { term = "Unknown", definition = "" } = args;
      if (term && definition) {
        this.showToast(`\u{1F4DA} ${term}: ${definition}`, 2e3);
      }
    }
  };
  var Notifications = new NotificationsModule();
  if (typeof window !== "undefined") {
    window.Notifications = Notifications;
    window.showToast = (msg, d) => Notifications.showToast(msg, d);
    window.confirmAction = (msg, cb) => Notifications.confirmAction(msg, cb);
    window.showLogNotification = (args) => Notifications.showLogNotification(args);
  }
  console.log("[Notifications] Module loaded (TS)");

  // src/main.ts
  init_elements();
  init_state();
  init_websocket_controller();
  init_chat();

  // src/modules/ui/settings.ts
  init_elements();
  init_state();
  init_websocket_controller();
  var STORAGE_KEYS = {
    apiKey: "gemini_api_key",
    voice: "gemini_voice",
    speechRate: "gemini_speech_rate",
    theme: "gemini_theme",
    level: "gemini_level",
    teacherMode: "gemini_teacher_mode",
    nativeLanguage: "gemini_native_language",
    systemInstruction: "gemini_system_instruction"
  };
  function loadSettings() {
    const settings = {
      apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || "",
      voice: localStorage.getItem(STORAGE_KEYS.voice) || "Puck",
      speechRate: parseFloat(localStorage.getItem(STORAGE_KEYS.speechRate) || "1.0"),
      theme: localStorage.getItem(STORAGE_KEYS.theme) || "dark",
      level: localStorage.getItem(STORAGE_KEYS.level) || "A1",
      teacherMode: localStorage.getItem(STORAGE_KEYS.teacherMode) || "standard",
      nativeLanguage: localStorage.getItem(STORAGE_KEYS.nativeLanguage) || "Russian",
      systemInstruction: localStorage.getItem(STORAGE_KEYS.systemInstruction) || ""
    };
    applySettingsToUI(settings);
    applyTheme(settings.theme);
    return settings;
  }
  function saveSettings() {
    const elements2 = getElements();
    const apiKeyInput = document.getElementById("api-key");
    if (apiKeyInput) {
      localStorage.setItem(STORAGE_KEYS.apiKey, apiKeyInput.value.trim());
    }
    if (elements2.voiceSelect?.value) {
      localStorage.setItem(STORAGE_KEYS.voice, elements2.voiceSelect.value);
    }
    if (elements2.languageLevel?.value) {
      localStorage.setItem(STORAGE_KEYS.level, elements2.languageLevel.value);
    }
    const teacherModeRadio = document.querySelector('input[name="teacher-mode"]:checked');
    if (teacherModeRadio) {
      localStorage.setItem(STORAGE_KEYS.teacherMode, teacherModeRadio.value);
    }
    const nativeLangSelect = document.getElementById("native-language");
    if (nativeLangSelect?.value) {
      localStorage.setItem(STORAGE_KEYS.nativeLanguage, nativeLangSelect.value);
    }
    const speechRateInput = document.getElementById("speech-rate");
    if (speechRateInput) {
      localStorage.setItem(STORAGE_KEYS.speechRate, speechRateInput.value);
    }
    saveExtraKeys();
    console.log("[Settings] Saved");
  }
  function applyTheme(theme) {
    document.body.classList.add("theme-transitioning");
    document.body.dataset.theme = theme;
    document.documentElement.className = theme;
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    const bgEnabled = localStorage.getItem("gemini_theme_bg") !== "false";
    if (bgEnabled) {
      document.body.classList.add("themed-bg");
      Promise.resolve().then(() => (init_theme_effects(), theme_effects_exports)).then((fx) => fx.applyThemeEffects(theme));
    } else {
      document.body.classList.remove("themed-bg");
      Promise.resolve().then(() => (init_theme_effects(), theme_effects_exports)).then((fx) => fx.clearThemeEffects());
    }
    setTimeout(() => {
      document.body.classList.remove("theme-transitioning");
    }, 600);
  }
  function setupBgToggle() {
    const toggle = document.getElementById("theme-bg-toggle");
    if (!toggle)
      return;
    const saved = localStorage.getItem("gemini_theme_bg") !== "false";
    toggle.checked = saved;
    if (saved) {
      document.body.classList.add("themed-bg");
      const theme = document.body.dataset.theme || "dark";
      Promise.resolve().then(() => (init_theme_effects(), theme_effects_exports)).then((fx) => fx.applyThemeEffects(theme));
    }
    toggle.addEventListener("change", () => {
      localStorage.setItem("gemini_theme_bg", String(toggle.checked));
      if (toggle.checked) {
        document.body.classList.add("themed-bg");
        const theme = document.body.dataset.theme || "dark";
        Promise.resolve().then(() => (init_theme_effects(), theme_effects_exports)).then((fx) => fx.applyThemeEffects(theme));
      } else {
        document.body.classList.remove("themed-bg");
        Promise.resolve().then(() => (init_theme_effects(), theme_effects_exports)).then((fx) => fx.clearThemeEffects());
      }
    });
  }
  function applySettingsToUI(settings) {
    const elements2 = getElements();
    const apiKeyInput = document.getElementById("api-key");
    if (apiKeyInput && settings.apiKey) {
      apiKeyInput.value = settings.apiKey;
    }
    renderExtraKeys();
    if (elements2.voiceSelect && settings.voice) {
      elements2.voiceSelect.value = settings.voice;
    }
    if (elements2.themeSelect && settings.theme) {
      elements2.themeSelect.value = settings.theme;
    }
    if (elements2.languageLevel && settings.level) {
      elements2.languageLevel.value = settings.level;
    }
    const nativeLangSelect = document.getElementById("native-language");
    if (nativeLangSelect && settings.nativeLanguage) {
      nativeLangSelect.value = settings.nativeLanguage;
    }
    const teacherModeRadio = document.querySelector(`input[name="teacher-mode"][value="${settings.teacherMode}"]`);
    if (teacherModeRadio) {
      teacherModeRadio.checked = true;
    }
    updateA1SBlock(settings.teacherMode === "active");
    updateProgressVisibility(settings.teacherMode === "standard");
    const speechRateSlider = document.getElementById("speech-rate");
    const speechRateInput = document.getElementById("speech-rate-input");
    const rate = settings.speechRate || 1;
    if (speechRateSlider) {
      speechRateSlider.value = rate.toFixed(2);
    }
    if (speechRateInput) {
      speechRateInput.value = rate.toFixed(2);
    }
    const AudioPlayback2 = window.AudioPlayback;
    if (AudioPlayback2?.setPlaybackRate) {
      AudioPlayback2.setPlaybackRate(rate);
    }
  }
  function updateA1SBlock(_isActive) {
  }
  function updateProgressVisibility(isStandard) {
    const section = document.querySelector(".progress-section");
    if (section) {
      section.style.display = isStandard ? "" : "none";
    }
  }
  function setupTeacherModeListener() {
    const radios = document.querySelectorAll('input[name="teacher-mode"]');
    const germanOnlyBtn = document.getElementById("german-only-btn");
    const updateGermanOnlyVisibility = (isActive) => {
      if (germanOnlyBtn) {
        if (isActive) {
          germanOnlyBtn.classList.remove("hidden");
        } else {
          germanOnlyBtn.classList.add("hidden");
          localStorage.setItem("germanOnlyMode", "false");
          germanOnlyBtn.classList.remove("active");
          console.log("[Settings] German-only mode disabled (standard mode selected)");
        }
      }
    };
    radios.forEach((radio) => {
      radio.addEventListener("change", async (e) => {
        const target = e.target;
        const isActiveMode = target.value === "active" || target.value === "grammar";
        updateA1SBlock(isActiveMode);
        updateTeacherModeHint(target.value);
        updateGermanOnlyVisibility(isActiveMode);
        updateProgressVisibility(target.value === "standard");
        saveSettings();
        try {
          await fetch("/api/clear-session", { method: "POST" });
          console.log("[Settings] Session memory cleared for mode change");
        } catch (err) {
          console.error("[Settings] Failed to clear session:", err);
        }
        const state2 = getState();
        if (state2.isConnected) {
          const modeLabels = {
            "standard": "\u{1F4D6} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442",
            "active": "\u{1F680} \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439",
            "grammar": "\u{1F4DA} \u0413\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0430",
            "free_conversation": "\u{1F4AC} \u0420\u0430\u0437\u0433\u043E\u0432\u043E\u0440",
            "exam": "\u{1F4DD} \u042D\u043A\u0437\u0430\u043C\u0435\u043D",
            "pronunciation": "\u{1F399}\uFE0F \u041F\u0440\u043E\u0438\u0437\u043D\u043E\u0448\u0435\u043D\u0438\u0435",
            "vocabulary": "\u{1F524} \u041B\u0435\u043A\u0441\u0438\u043A\u0430"
          };
          const label = modeLabels[target.value] || target.value;
          const chatMessages = document.getElementById("chat-messages");
          if (chatMessages) {
            chatMessages.innerHTML = "";
            const notif = document.createElement("div");
            notif.className = "system-message mode-change-notice";
            notif.innerHTML = `\u{1F504} \u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043D\u0430 <strong>${label}</strong>...`;
            notif.style.cssText = "background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; padding: 10px; margin: 10px 0; border-radius: 8px; text-align: center;";
            chatMessages.appendChild(notif);
          }
          console.log(`[Settings] Auto-reconnecting for mode change to '${target.value}'`);
          stopConversation();
          const { setState: setStateFn } = await Promise.resolve().then(() => (init_state(), state_exports));
          setStateFn({ conversationHistory: [] });
          setTimeout(() => {
            startConversation("voice");
          }, 500);
        }
      });
    });
    const currentMode = document.querySelector('input[name="teacher-mode"]:checked')?.value;
    updateGermanOnlyVisibility(currentMode === "active" || currentMode === "grammar");
    setupScrollFollowToggle();
    const nativeLangSelect = document.getElementById("native-language");
    if (nativeLangSelect) {
      nativeLangSelect.addEventListener("change", () => {
        saveSettings();
        console.log("[Settings] Native language changed to:", nativeLangSelect.value);
      });
    }
  }
  function setupScrollFollowToggle() {
    const scrollFollowBtn = document.getElementById("scroll-follow-btn");
    const savedScrollFollow = localStorage.getItem("scrollFollowMode") !== "false";
    window.scrollFollowMode = savedScrollFollow;
    if (scrollFollowBtn) {
      if (savedScrollFollow) {
        scrollFollowBtn.classList.add("active");
        scrollFollowBtn.textContent = "\u{1F4DC}\u2713";
      } else {
        scrollFollowBtn.classList.remove("active");
        scrollFollowBtn.textContent = "\u{1F4DC}";
      }
      scrollFollowBtn.addEventListener("click", () => {
        const isActive = scrollFollowBtn.classList.toggle("active");
        scrollFollowBtn.textContent = isActive ? "\u{1F4DC}\u2713" : "\u{1F4DC}";
        scrollFollowBtn.title = isActive ? "\u0421\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u044C \u0437\u0430 \u043F\u043E\u0434\u0441\u0432\u0435\u0442\u043A\u043E\u0439 \u0412\u041A\u041B" : "\u0421\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u044C \u0437\u0430 \u043F\u043E\u0434\u0441\u0432\u0435\u0442\u043A\u043E\u0439 \u0412\u042B\u041A\u041B";
        localStorage.setItem("scrollFollowMode", String(isActive));
        window.scrollFollowMode = isActive;
        console.log("[ScrollFollow]", isActive ? "Enabled" : "Disabled");
      });
    }
  }
  function updateTeacherModeHint(mode) {
    const hint = document.getElementById("teacher-mode-hint");
    if (hint) {
      switch (mode) {
        case "active":
          hint.textContent = "\u0414\u0438\u0430\u043B\u043E\u0433\u0438 \u0438\u0437 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0439 \u0436\u0438\u0437\u043D\u0438";
          break;
        case "grammar":
          hint.textContent = "\u0413\u043B\u0443\u0431\u043E\u043A\u0438\u0439 \u0440\u0430\u0437\u0431\u043E\u0440 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438 \u043F\u043E \u0443\u0440\u043E\u0432\u043D\u044F\u043C";
          break;
        case "free_conversation":
          hint.textContent = "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0439 \u0440\u0430\u0437\u0433\u043E\u0432\u043E\u0440 \u0431\u0435\u0437 \u0443\u0440\u043E\u043A\u043E\u0432";
          break;
        case "exam":
          hint.textContent = "\u041F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0430 \u043A \u044D\u043A\u0437\u0430\u043C\u0435\u043D\u0443 (Goethe/JLPT/Cambridge)";
          break;
        case "pronunciation":
          hint.textContent = "\u0422\u0440\u0435\u043D\u0438\u0440\u043E\u0432\u043A\u0430 \u043F\u0440\u043E\u0438\u0437\u043D\u043E\u0448\u0435\u043D\u0438\u044F \u0438 \u0444\u043E\u043D\u0435\u0442\u0438\u043A\u0438";
          break;
        case "vocabulary":
          hint.textContent = "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0441\u043B\u043E\u0432\u0430\u0440\u043D\u043E\u0433\u043E \u0437\u0430\u043F\u0430\u0441\u0430 \u043F\u043E \u0442\u0435\u043C\u0430\u043C";
          break;
        default:
          hint.textContent = "\u0421\u043B\u043E\u0432\u0430 + \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u0441 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430\u043C\u0438";
      }
    }
  }
  function setupThemeListener() {
    const elements2 = getElements();
    elements2.themeSelect?.addEventListener("change", () => {
      const theme = elements2.themeSelect.value;
      applyTheme(theme);
    });
  }
  function setupSpeechRateListener() {
    const speechRateSlider = document.getElementById("speech-rate");
    const speechRateInput = document.getElementById("speech-rate-input");
    console.log("[Settings] setupSpeechRateListener called");
    const applyRate = (rate, updateInput = true) => {
      const clampedRate = Math.max(0.5, Math.min(2, rate));
      if (speechRateSlider)
        speechRateSlider.value = clampedRate.toFixed(2);
      if (updateInput && speechRateInput)
        speechRateInput.value = clampedRate.toFixed(2);
      const AudioPlayback2 = window.AudioPlayback;
      if (AudioPlayback2?.setPlaybackRate) {
        AudioPlayback2.setPlaybackRate(clampedRate);
        console.log("[Settings] Applied playback rate:", clampedRate);
      }
    };
    if (speechRateSlider) {
      speechRateSlider.addEventListener("input", () => {
        applyRate(parseFloat(speechRateSlider.value));
      });
      speechRateSlider.addEventListener("change", saveSettings);
    }
    if (speechRateInput) {
      speechRateInput.addEventListener("input", (e) => {
        const target = e.target;
        let val = target.value.replace(/[^0-9]/g, "");
        if (val.length >= 3) {
          const num = parseInt(val.slice(0, 3), 10);
          const rate = num / 100;
          applyRate(rate, false);
        } else if (val.length > 0) {
          const rate = parseInt(val, 10) / (val.length === 1 ? 10 : 100);
          if (!isNaN(rate) && rate >= 0.5 && rate <= 2) {
            applyRate(rate, false);
          }
        }
      });
      speechRateInput.addEventListener("blur", () => {
        const val = speechRateInput.value.replace(/[^0-9]/g, "");
        if (val.length >= 2) {
          const num = parseInt(val.slice(0, 3), 10);
          const rate = Math.max(50, Math.min(200, num)) / 100;
          applyRate(rate, true);
          saveSettings();
        }
      });
    }
    console.log("[Settings] Speech rate listeners attached");
  }
  function getSpeechRate() {
    const speechRateInput = document.getElementById("speech-rate");
    return speechRateInput ? parseFloat(speechRateInput.value) : 1;
  }
  var EXTRA_KEYS_STORAGE = "gemini_extra_keys";
  function getExtraKeys() {
    try {
      return JSON.parse(localStorage.getItem(EXTRA_KEYS_STORAGE) || "[]");
    } catch {
      return [];
    }
  }
  function saveExtraKeys() {
    const inputs = document.querySelectorAll("#extra-keys-list .extra-key-input");
    const keys = [];
    inputs.forEach((input) => {
      const val = input.value.trim();
      if (val)
        keys.push(val);
    });
    localStorage.setItem(EXTRA_KEYS_STORAGE, JSON.stringify(keys));
  }
  function renderExtraKeys() {
    const container2 = document.getElementById("extra-keys-list");
    if (!container2)
      return;
    container2.innerHTML = "";
    const keys = getExtraKeys();
    keys.forEach((key, i) => addExtraKeyInput(key, i));
  }
  function addExtraKeyInput(value = "", index) {
    const container2 = document.getElementById("extra-keys-list");
    if (!container2)
      return;
    const idx = index !== void 0 ? index : container2.children.length;
    const item = document.createElement("div");
    item.className = "extra-key-item";
    item.innerHTML = `
        <span class="key-index">#${idx + 2}</span>
        <input type="password" class="extra-key-input" value="${value}" placeholder="AIzaSy..." />
        <button class="btn-remove-key" title="\u0423\u0434\u0430\u043B\u0438\u0442\u044C">\u2715</button>
    `;
    const removeBtn = item.querySelector(".btn-remove-key");
    removeBtn.onclick = () => {
      item.remove();
      saveExtraKeys();
      reindexExtraKeys();
    };
    const input = item.querySelector(".extra-key-input");
    input.onchange = () => saveExtraKeys();
    container2.appendChild(item);
  }
  function reindexExtraKeys() {
    const items = document.querySelectorAll("#extra-keys-list .extra-key-item");
    items.forEach((item, i) => {
      const label = item.querySelector(".key-index");
      if (label)
        label.textContent = `#${i + 2}`;
    });
  }
  function setupApiKeyListeners() {
    const apiKeyInput = document.getElementById("api-key");
    if (apiKeyInput) {
      apiKeyInput.addEventListener("change", () => {
        saveSettings();
        console.log("[Settings] Main API key updated");
      });
      apiKeyInput.addEventListener("blur", () => {
        saveSettings();
      });
    }
    const addBtn = document.getElementById("add-key-btn");
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        addExtraKeyInput();
      };
    }
  }
  function getAllIllustrationKeys() {
    const mainKey = localStorage.getItem("gemini_api_key") || "";
    const extras = getExtraKeys();
    const allKeys = [mainKey, ...extras].filter((k) => k.trim());
    return allKeys.join(",");
  }
  if (typeof window !== "undefined") {
    window.getAllIllustrationKeys = getAllIllustrationKeys;
  }
  var Settings = {
    load: loadSettings,
    save: saveSettings,
    applyTheme,
    setupThemeListener,
    setupTeacherModeListener,
    setupSpeechRateListener,
    setupApiKeyListeners,
    setupBgToggle,
    getSpeechRate,
    updateA1SBlock,
    getAllIllustrationKeys
  };

  // src/main.ts
  init_chat_sessions();

  // src/modules/ui/i18n.ts
  var LANGS = {
    ru: { flag: "\u{1F1F7}\u{1F1FA}", name: "Russian", native: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439" },
    uk: { flag: "\u{1F1FA}\u{1F1E6}", name: "Ukrainian", native: "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430" },
    en: { flag: "\u{1F1EC}\u{1F1E7}", name: "English", native: "English" },
    de: { flag: "\u{1F1E9}\u{1F1EA}", name: "German", native: "Deutsch" },
    es: { flag: "\u{1F1EA}\u{1F1F8}", name: "Spanish", native: "Espa\xF1ol" },
    fr: { flag: "\u{1F1EB}\u{1F1F7}", name: "French", native: "Fran\xE7ais" },
    it: { flag: "\u{1F1EE}\u{1F1F9}", name: "Italian", native: "Italiano" },
    pt: { flag: "\u{1F1F5}\u{1F1F9}", name: "Portuguese", native: "Portugu\xEAs" },
    ja: { flag: "\u{1F1EF}\u{1F1F5}", name: "Japanese", native: "\u65E5\u672C\u8A9E" },
    zh: { flag: "\u{1F1E8}\u{1F1F3}", name: "Chinese", native: "\u4E2D\u6587" },
    ko: { flag: "\u{1F1F0}\u{1F1F7}", name: "Korean", native: "\uD55C\uAD6D\uC5B4" },
    pl: { flag: "\u{1F1F5}\u{1F1F1}", name: "Polish", native: "Polski" },
    tr: { flag: "\u{1F1F9}\u{1F1F7}", name: "Turkish", native: "T\xFCrk\xE7e" },
    ar: { flag: "\u{1F1F8}\u{1F1E6}", name: "Arabic", native: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" },
    hi: { flag: "\u{1F1EE}\u{1F1F3}", name: "Hindi", native: "\u0939\u093F\u0928\u094D\u0926\u0940" }
  };
  var T = {
    ru: {
      appLang: "\u{1F310} \u042F\u0437\u044B\u043A \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \u0413\u043E\u043B\u043E\u0441",
      speechRate: "\u{1F39A}\uFE0F \u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0440\u0435\u0447\u0438",
      studying: "\u{1F4DA} \u0418\u0437\u0443\u0447\u0430\u044E",
      translate: "\u{1F5E3}\uFE0F \u041F\u0435\u0440\u0435\u0432\u043E\u0434",
      level: "\u{1F4CA} \u0423\u0440\u043E\u0432\u0435\u043D\u044C",
      trainerMode: "\u{1F393} \u0420\u0435\u0436\u0438\u043C \u0442\u0440\u0435\u043D\u0435\u0440\u0430",
      myProgress: "\u{1F4C8} \u041C\u043E\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441",
      theme: "\u{1F3A8} \u0422\u0435\u043C\u0430",
      chats: "\u0427\u0430\u0442\u044B",
      background: "\u{1F5BC}\uFE0F \u0424\u043E\u043D",
      standard: "\u{1F4D6} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442",
      active: "\u{1F680} \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439",
      grammar: "\u{1F4DA} \u0413\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0430",
      conversation: "\u{1F4AC} \u0420\u0430\u0437\u0433\u043E\u0432\u043E\u0440",
      modeHint: "\u0421\u043B\u043E\u0432\u0430 + \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u0441 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430\u043C\u0438",
      management: "\u{1F4BE} \u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435",
      export: "\u{1F4E5} \u042D\u043A\u0441\u043F\u043E\u0440\u0442",
      loading: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...",
      voiceBtn: "\u{1F3A4} \u0413\u043E\u043B\u043E\u0441",
      screenBtn: "\u{1F5A5}\uFE0F \u042D\u043A\u0440\u0430\u043D",
      cameraBtn: "\u{1F4F7} \u041A\u0430\u043C\u0435\u0440\u0430",
      skipBtn: "\u23ED\uFE0F \u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C",
      continueBtn: "\u25B6\uFE0F \u041F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C",
      stopBtn: "\u2B1B \u0421\u0442\u043E\u043F",
      sendBtn: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C",
      typePlaceholder: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435...",
      searchLang: "\u{1F50D} \u041F\u043E\u0438\u0441\u043A \u044F\u0437\u044B\u043A\u0430...",
      newChat: "\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442",
      thoughts: "\u041C\u044B\u0441\u043B\u0438",
      gram_cheatsheet: "\u0428\u043F\u0430\u0440\u0433\u0430\u043B\u043A\u0430 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438",
      gram_reference: "\u{1F4CB} \u0421\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u0438\u043A",
      gram_words: "\u{1F4DD} \u0421\u043B\u043E\u0432\u0430",
      gram_history: "\u{1F570}\uFE0F \u0418\u0441\u0442\u043E\u0440\u0438\u044F",
      gram_articles: "\u0410\u0440\u0442\u0438\u043A\u043B\u0438",
      gram_pronouns: "\u041C\u0435\u0441\u0442\u043E\u0438\u043C\u0435\u043D\u0438\u044F",
      gram_tenses: "\u0412\u0440\u0435\u043C\u0435\u043D\u0430",
      gram_prepositions: "\u041F\u0440\u0435\u0434\u043B\u043E\u0433\u0438",
      gram_conjunctions: "\u0421\u043E\u044E\u0437\u044B",
      gram_passive: "\u041F\u0430\u0441\u0441\u0438\u0432",
      gram_conditionals: "\u0423\u0441\u043B\u043E\u0432\u043D\u044B\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
      gram_verbs_present: "\u0413\u043B\u0430\u0433\u043E\u043B\u044B: \u041D\u0430\u0441\u0442\u043E\u044F\u0449\u0435\u0435",
      gram_hiragana: "\u0425\u0438\u0440\u0430\u0433\u0430\u043D\u0430",
      gram_particles: "\u0427\u0430\u0441\u0442\u0438\u0446\u044B",
      gram_verb_forms: "\u0424\u043E\u0440\u043C\u044B \u0433\u043B\u0430\u0433\u043E\u043B\u043E\u0432",
      gram_close: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C",
      gram_history_empty: '\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0443\u0441\u0442\u0430. \u0412\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 "\u0420\u0430\u0437\u0431\u043E\u0440 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438".',
      gram_history_title: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0430\u043D\u0430\u043B\u0438\u0437\u043E\u0432",
      gram_load_error: "\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.",
      tip_apikey: "\u{1F511} API \u043A\u043B\u044E\u0447 Google Gemini. \u041F\u043E\u043B\u0443\u0447\u0438 \u0431\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u043E \u043D\u0430 aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F \u0413\u043E\u043B\u043E\u0441 \u0418\u0418-\u0443\u0447\u0438\u0442\u0435\u043B\u044F. Gacrux \u2014 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u043D\u044B\u0439.",
      tip_speed: "\u{1F39A}\uFE0F \u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0440\u0435\u0447\u0438. 1.0 = \u043D\u043E\u0440\u043C. 0.7 \u043C\u0435\u0434\u043B\u0435\u043D\u043D\u043E, 1.5 \u0431\u044B\u0441\u0442\u0440\u043E.",
      tip_langs: "\u{1F30D} \u0421\u043B\u0435\u0432\u0430 \u2014 \u044F\u0437\u044B\u043A \u0418\u0417\u0423\u0427\u0415\u041D\u0418\u042F. \u0421\u043F\u0440\u0430\u0432\u0430 \u2014 \u0422\u0412\u041E\u0419 \u044F\u0437\u044B\u043A \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0430.",
      tip_level: "\u{1F4CA} A1 (\u0441 \u043D\u0443\u043B\u044F) \u2192 C2 (\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0439). \u0411\u043E\u0442 \u043F\u043E\u0434\u0431\u0438\u0440\u0430\u0435\u0442 \u0441\u043B\u043E\u0436\u043D\u043E\u0441\u0442\u044C.",
      tip_trainer: "\u{1F393} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442 \u2014 \u0441\u043B\u043E\u0432\u0430\n\u{1F680} \u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u2014 \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0430\n\u{1F4DA} \u0413\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0430 \u2014 \u0442\u0435\u043C\u044B\n\u{1F4AC} \u0420\u0430\u0437\u0433\u043E\u0432\u043E\u0440 \u2014 \u043E\u0431\u0449\u0435\u043D\u0438\u0435",
      tip_theme: '\u{1F3A8} \u0422\u0435\u043C\u0430 \u043E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u0438\u044F. \u0412\u043A\u043B\u044E\u0447\u0438 "\u0424\u043E\u043D" \u0434\u043B\u044F \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438.'
    },
    uk: {
      appLang: "\u{1F310} \u041C\u043E\u0432\u0430 \u0434\u043E\u0434\u0430\u0442\u043A\u0443",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \u0413\u043E\u043B\u043E\u0441",
      speechRate: "\u{1F39A}\uFE0F \u0428\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C \u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F",
      studying: "\u{1F4DA} \u0412\u0438\u0432\u0447\u0430\u044E",
      translate: "\u{1F5E3}\uFE0F \u041F\u0435\u0440\u0435\u043A\u043B\u0430\u0434",
      level: "\u{1F4CA} \u0420\u0456\u0432\u0435\u043D\u044C",
      trainerMode: "\u{1F393} \u0420\u0435\u0436\u0438\u043C \u0442\u0440\u0435\u043D\u0435\u0440\u0430",
      myProgress: "\u{1F4C8} \u041C\u0456\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441",
      theme: "\u{1F3A8} \u0422\u0435\u043C\u0430",
      chats: "\u0427\u0430\u0442\u0438",
      background: "\u{1F5BC}\uFE0F \u0424\u043E\u043D",
      standard: "\u{1F4D6} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442",
      active: "\u{1F680} \u0410\u043A\u0442\u0438\u0432\u043D\u0438\u0439",
      grammar: "\u{1F4DA} \u0413\u0440\u0430\u043C\u0430\u0442\u0438\u043A\u0430",
      conversation: "\u{1F4AC} \u0420\u043E\u0437\u043C\u043E\u0432\u0430",
      modeHint: "\u0421\u043B\u043E\u0432\u0430 + \u043F\u0438\u0442\u0430\u043D\u043D\u044F \u0437 \u043F\u0456\u0434\u043A\u0430\u0437\u043A\u0430\u043C\u0438",
      management: "\u{1F4BE} \u0423\u043F\u0440\u0430\u0432\u043B\u0456\u043D\u043D\u044F",
      export: "\u{1F4E5} \u0415\u043A\u0441\u043F\u043E\u0440\u0442",
      loading: "\u0417\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F...",
      voiceBtn: "\u{1F3A4} \u0413\u043E\u043B\u043E\u0441",
      screenBtn: "\u{1F5A5}\uFE0F \u0415\u043A\u0440\u0430\u043D",
      cameraBtn: "\u{1F4F7} \u041A\u0430\u043C\u0435\u0440\u0430",
      skipBtn: "\u23ED\uFE0F \u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u0438",
      continueBtn: "\u25B6\uFE0F \u041F\u0440\u043E\u0434\u043E\u0432\u0436\u0438\u0442\u0438",
      stopBtn: "\u2B1B \u0421\u0442\u043E\u043F",
      sendBtn: "\u041D\u0430\u0434\u0456\u0441\u043B\u0430\u0442\u0438",
      typePlaceholder: "\u0412\u0432\u0435\u0434\u0456\u0442\u044C \u043F\u043E\u0432\u0456\u0434\u043E\u043C\u043B\u0435\u043D\u043D\u044F...",
      searchLang: "\u{1F50D} \u041F\u043E\u0448\u0443\u043A \u043C\u043E\u0432\u0438...",
      newChat: "\u041D\u043E\u0432\u0438\u0439 \u0447\u0430\u0442",
      thoughts: "\u0414\u0443\u043C\u043A\u0438",
      gram_cheatsheet: "\u0413\u0440\u0430\u043C\u0430\u0442\u0438\u0447\u043D\u0430 \u0448\u043F\u0430\u0440\u0433\u0430\u043B\u043A\u0430",
      gram_reference: "\u{1F4CB} \u0414\u043E\u0432\u0456\u0434\u043D\u0438\u043A",
      gram_words: "\u{1F4DD} \u0421\u043B\u043E\u0432\u0430",
      gram_history: "\u{1F570}\uFE0F \u0406\u0441\u0442\u043E\u0440\u0456\u044F",
      gram_articles: "\u0410\u0440\u0442\u0438\u043A\u043B\u0456",
      gram_pronouns: "\u0417\u0430\u0439\u043C\u0435\u043D\u043D\u0438\u043A\u0438",
      gram_tenses: "\u0427\u0430\u0441\u0438",
      gram_prepositions: "\u041F\u0440\u0438\u0439\u043C\u0435\u043D\u043D\u0438\u043A\u0438",
      gram_conjunctions: "\u0421\u043F\u043E\u043B\u0443\u0447\u043D\u0438\u043A\u0438",
      gram_passive: "\u041F\u0430\u0441\u0438\u0432",
      gram_conditionals: "\u0423\u043C\u043E\u0432\u043D\u0456",
      gram_verbs_present: "\u0414\u0456\u0454\u0441\u043B\u043E\u0432\u0430: \u0422\u0435\u043F\u0435\u0440\u0456\u0448\u043D\u0456\u0439",
      gram_hiragana: "\u0425\u0456\u0440\u0430\u0433\u0430\u043D\u0430",
      gram_particles: "\u0427\u0430\u0441\u0442\u043A\u0438",
      gram_verb_forms: "\u0424\u043E\u0440\u043C\u0438 \u0434\u0456\u0454\u0441\u043B\u0456\u0432",
      gram_close: "\u0417\u0430\u043A\u0440\u0438\u0442\u0438",
      gram_history_empty: '\u0406\u0441\u0442\u043E\u0440\u0456\u044F \u043F\u043E\u0440\u043E\u0436\u043D\u044F. \u0412\u0438\u0434\u0456\u043B\u0456\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u0456 \u043D\u0430\u0442\u0438\u0441\u043D\u0456\u0442\u044C "\u0420\u043E\u0437\u0431\u0456\u0440 \u0433\u0440\u0430\u043C\u0430\u0442\u0438\u043A\u0438".',
      gram_history_title: "\u0406\u0441\u0442\u043E\u0440\u0456\u044F \u0430\u043D\u0430\u043B\u0456\u0437\u0456\u0432",
      gram_load_error: "\u041F\u043E\u043C\u0438\u043B\u043A\u0430 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437.",
      tip_apikey: "\u{1F511} API \u043A\u043B\u044E\u0447 Google Gemini. \u041E\u0442\u0440\u0438\u043C\u0430\u0439 \u0431\u0435\u0437\u043A\u043E\u0448\u0442\u043E\u0432\u043D\u043E \u043D\u0430 aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F \u0413\u043E\u043B\u043E\u0441 \u0428\u0406-\u0432\u0447\u0438\u0442\u0435\u043B\u044F. Gacrux \u2014 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u043E\u0432\u0430\u043D\u0438\u0439.",
      tip_speed: "\u{1F39A}\uFE0F \u0428\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C \u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F. 1.0 = \u043D\u043E\u0440\u043C. 0.7 \u043F\u043E\u0432\u0456\u043B\u044C\u043D\u043E, 1.5 \u0448\u0432\u0438\u0434\u043A\u043E.",
      tip_langs: "\u{1F30D} \u0417\u043B\u0456\u0432\u0430 \u2014 \u043C\u043E\u0432\u0430 \u0412\u0418\u0412\u0427\u0415\u041D\u041D\u042F. \u0421\u043F\u0440\u0430\u0432\u0430 \u2014 \u0422\u0412\u041E\u042F \u043C\u043E\u0432\u0430 \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u043A\u043B\u0430\u0434\u0443.",
      tip_level: "\u{1F4CA} A1 (\u0437 \u043D\u0443\u043B\u044F) \u2192 C2 (\u0432\u0456\u043B\u044C\u043D\u0438\u0439). \u0411\u043E\u0442 \u043F\u0456\u0434\u0431\u0438\u0440\u0430\u0454 \u0441\u043A\u043B\u0430\u0434\u043D\u0456\u0441\u0442\u044C.",
      tip_trainer: "\u{1F393} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442 \u2014 \u0441\u043B\u043E\u0432\u0430\n\u{1F680} \u0410\u043A\u0442\u0438\u0432\u043D\u0438\u0439 \u2014 \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0430\n\u{1F4DA} \u0413\u0440\u0430\u043C\u0430\u0442\u0438\u043A\u0430 \u2014 \u0442\u0435\u043C\u0438\n\u{1F4AC} \u0420\u043E\u0437\u043C\u043E\u0432\u0430 \u2014 \u0441\u043F\u0456\u043B\u043A\u0443\u0432\u0430\u043D\u043D\u044F",
      tip_theme: '\u{1F3A8} \u0422\u0435\u043C\u0430 \u043E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u043D\u044F. \u0423\u0432\u0456\u043C\u043A\u043D\u0438 "\u0424\u043E\u043D" \u0434\u043B\u044F \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438.'
    },
    en: {
      appLang: "\u{1F310} App Language",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Voice",
      speechRate: "\u{1F39A}\uFE0F Speech Rate",
      studying: "\u{1F4DA} Studying",
      translate: "\u{1F5E3}\uFE0F Translation",
      level: "\u{1F4CA} Level",
      trainerMode: "\u{1F393} Trainer Mode",
      myProgress: "\u{1F4C8} My Progress",
      theme: "\u{1F3A8} Theme",
      chats: "Chats",
      background: "\u{1F5BC}\uFE0F Background",
      standard: "\u{1F4D6} Standard",
      active: "\u{1F680} Active",
      grammar: "\u{1F4DA} Grammar",
      conversation: "\u{1F4AC} Conversation",
      modeHint: "Words + quiz with hints",
      management: "\u{1F4BE} Manage",
      export: "\u{1F4E5} Export",
      loading: "Loading...",
      voiceBtn: "\u{1F3A4} Voice",
      screenBtn: "\u{1F5A5}\uFE0F Screen",
      cameraBtn: "\u{1F4F7} Camera",
      skipBtn: "\u23ED\uFE0F Skip",
      continueBtn: "\u25B6\uFE0F Continue",
      stopBtn: "\u2B1B Stop",
      sendBtn: "Send",
      typePlaceholder: "Type a message...",
      searchLang: "\u{1F50D} Search language...",
      newChat: "New Chat",
      thoughts: "Thoughts",
      gram_cheatsheet: "Grammar Cheatsheet",
      gram_reference: "\u{1F4CB} Reference",
      gram_words: "\u{1F4DD} Words",
      gram_history: "\u{1F570}\uFE0F History",
      gram_articles: "Articles",
      gram_pronouns: "Pronouns",
      gram_tenses: "Tenses",
      gram_prepositions: "Prepositions",
      gram_conjunctions: "Conjunctions",
      gram_passive: "Passive",
      gram_conditionals: "Conditionals",
      gram_verbs_present: "Verbs: Present",
      gram_hiragana: "Hiragana",
      gram_particles: "Particles",
      gram_verb_forms: "Verb Forms",
      gram_close: "Close",
      gram_history_empty: 'History is empty. Select text and click "Grammar Analysis" or "Explain".',
      gram_history_title: "Analysis History",
      gram_load_error: "Loading error. Please try again.",
      tip_apikey: "\u{1F511} Google Gemini API key. Get it free at aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F AI teacher voice. Gacrux \u2014 recommended.",
      tip_speed: "\u{1F39A}\uFE0F Speech rate. 1.0 = normal. 0.7 slow, 1.5 fast.",
      tip_langs: "\u{1F30D} Left \u2014 language to LEARN. Right \u2014 YOUR language for translation.",
      tip_level: "\u{1F4CA} A1 (beginner) \u2192 C2 (fluent). Bot adjusts difficulty.",
      tip_trainer: "\u{1F393} Standard \u2014 words\n\u{1F680} Active \u2014 practice\n\u{1F4DA} Grammar \u2014 topics\n\u{1F4AC} Conversation \u2014 chat",
      tip_theme: '\u{1F3A8} App theme. Enable "Background" for image.'
    },
    de: {
      appLang: "\u{1F310} App-Sprache",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Stimme",
      speechRate: "\u{1F39A}\uFE0F Sprechgeschwindigkeit",
      studying: "\u{1F4DA} Ich lerne",
      translate: "\u{1F5E3}\uFE0F \xDCbersetzung",
      level: "\u{1F4CA} Niveau",
      trainerMode: "\u{1F393} Trainermodus",
      myProgress: "\u{1F4C8} Mein Fortschritt",
      theme: "\u{1F3A8} Design",
      chats: "Chats",
      background: "\u{1F5BC}\uFE0F Hintergrund",
      standard: "\u{1F4D6} Standard",
      active: "\u{1F680} Aktiv",
      grammar: "\u{1F4DA} Grammatik",
      conversation: "\u{1F4AC} Gespr\xE4ch",
      modeHint: "W\xF6rter + Quiz mit Hinweisen",
      management: "\u{1F4BE} Verwalten",
      export: "\u{1F4E5} Export",
      loading: "Laden...",
      voiceBtn: "\u{1F3A4} Stimme",
      screenBtn: "\u{1F5A5}\uFE0F Bildschirm",
      cameraBtn: "\u{1F4F7} Kamera",
      skipBtn: "\u23ED\uFE0F \xDCberspringen",
      continueBtn: "\u25B6\uFE0F Weiter",
      stopBtn: "\u2B1B Stopp",
      sendBtn: "Senden",
      typePlaceholder: "Nachricht eingeben...",
      searchLang: "\u{1F50D} Sprache suchen...",
      getKey: "Schl\xFCssel holen \u2192",
      settings: "\u2699\uFE0F Einstellungen",
      newChat: "Neuer Chat",
      thoughts: "Gedanken",
      tip_apikey: "\uFFFD\uFFFD Google Gemini API-Schl\xFCssel. Kostenlos auf aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F KI-Lehrer Stimme. Gacrux \u2014 empfohlen.",
      tip_speed: "\u{1F39A}\uFE0F Geschwindigkeit. 1.0 = normal. 0.7 langsam, 1.5 schnell.",
      tip_langs: "\u{1F30D} Links \u2014 Sprache zum LERNEN. Rechts \u2014 DEINE Sprache.",
      tip_level: "\u{1F4CA} A1 (Anf\xE4nger) \u2192 C2 (flie\xDFend). Bot passt Schwierigkeit an.",
      tip_trainer: "\u{1F393} Standard \u2014 W\xF6rter\\n\u{1F680} Aktiv \u2014 \xDCbung\\n\u{1F4DA} Grammatik \u2014 Themen\\n\u{1F4AC} Gespr\xE4ch \u2014 Chat",
      tip_theme: "\u{1F3A8} App-Design. Hintergrund aktivieren."
    },
    es: {
      appLang: "\u{1F310} Idioma de la app",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Voz",
      speechRate: "\u{1F39A}\uFE0F Velocidad del habla",
      studying: "\u{1F4DA} Estudio",
      translate: "\u{1F5E3}\uFE0F Traducci\xF3n",
      level: "\u{1F4CA} Nivel",
      trainerMode: "\u{1F393} Modo entrenador",
      myProgress: "\u{1F4C8} Mi progreso",
      theme: "\u{1F3A8} Tema",
      chats: "Chats",
      background: "\u{1F5BC}\uFE0F Fondo",
      standard: "\u{1F4D6} Est\xE1ndar",
      active: "\u{1F680} Activo",
      grammar: "\u{1F4DA} Gram\xE1tica",
      conversation: "\u{1F4AC} Conversaci\xF3n",
      modeHint: "Palabras + tests con pistas",
      management: "\u{1F4BE} Gesti\xF3n",
      export: "\u{1F4E5} Exportar",
      loading: "Cargando...",
      voiceBtn: "\u{1F3A4} Voz",
      screenBtn: "\u{1F5A5}\uFE0F Pantalla",
      cameraBtn: "\u{1F4F7} C\xE1mara",
      skipBtn: "\u23ED\uFE0F Saltar",
      continueBtn: "\u25B6\uFE0F Continuar",
      stopBtn: "\u2B1B Parar",
      sendBtn: "Enviar",
      typePlaceholder: "Escribe un mensaje...",
      searchLang: "\u{1F50D} Buscar idioma...",
      getKey: "Obtener clave \u2192",
      settings: "\u2699\uFE0F Ajustes",
      newChat: "Nuevo chat",
      thoughts: "Pensamientos",
      tip_apikey: "\u{1F511} Clave API Google Gemini. Gratis en aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F Voz del profesor IA. Gacrux \u2014 recomendado.",
      tip_speed: "\u{1F39A}\uFE0F Velocidad. 1.0 = normal. 0.7 lento, 1.5 r\xE1pido.",
      tip_langs: "\u{1F30D} Izquierda \u2014 idioma a APRENDER. Derecha \u2014 TU idioma.",
      tip_level: "\u{1F4CA} A1 (principiante) \u2192 C2 (fluido). Bot ajusta dificultad.",
      tip_trainer: "\u{1F393} Est\xE1ndar \u2014 palabras\\n\u{1F680} Activo \u2014 pr\xE1ctica\\n\u{1F4DA} Gram\xE1tica \u2014 temas\\n\u{1F4AC} Conversaci\xF3n \u2014 charla",
      tip_theme: "\u{1F3A8} Tema. Activa Fondo para imagen."
    },
    fr: {
      appLang: "\u{1F310} Langue de l'app",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Voix",
      speechRate: "\u{1F39A}\uFE0F Vitesse de parole",
      studying: "\u{1F4DA} J'\xE9tudie",
      translate: "\u{1F5E3}\uFE0F Traduction",
      level: "\u{1F4CA} Niveau",
      trainerMode: "\u{1F393} Mode entra\xEEneur",
      myProgress: "\u{1F4C8} Mon progr\xE8s",
      theme: "\u{1F3A8} Th\xE8me",
      chats: "Chats",
      background: "\u{1F5BC}\uFE0F Fond",
      standard: "\u{1F4D6} Standard",
      active: "\u{1F680} Actif",
      grammar: "\u{1F4DA} Grammaire",
      conversation: "\u{1F4AC} Conversation",
      modeHint: "Mots + quiz avec indices",
      management: "\u{1F4BE} G\xE9rer",
      export: "\u{1F4E5} Exporter",
      loading: "Chargement...",
      voiceBtn: "\u{1F3A4} Voix",
      screenBtn: "\u{1F5A5}\uFE0F \xC9cran",
      cameraBtn: "\u{1F4F7} Cam\xE9ra",
      skipBtn: "\u23ED\uFE0F Passer",
      continueBtn: "\u25B6\uFE0F Continuer",
      stopBtn: "\u2B1B Arr\xEAter",
      sendBtn: "Envoyer",
      typePlaceholder: "Tapez un message...",
      searchLang: "\u{1F50D} Chercher une langue...",
      getKey: "Obtenir la cl\xE9 \u2192",
      settings: "\u2699\uFE0F Param\xE8tres",
      newChat: "Nouveau chat",
      thoughts: "Pens\xE9es",
      tip_apikey: "\u{1F511} Cl\xE9 API Google Gemini. Gratuite sur aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F Voix du professeur IA. Gacrux \u2014 recommand\xE9.",
      tip_speed: "\u{1F39A}\uFE0F Vitesse. 1.0 = normal. 0.7 lent, 1.5 rapide.",
      tip_langs: "\u{1F30D} Gauche \u2014 langue \xE0 APPRENDRE. Droite \u2014 VOTRE langue.",
      tip_level: "\u{1F4CA} A1 (d\xE9butant) \u2192 C2 (courant). Bot ajuste difficult\xE9.",
      tip_trainer: "\u{1F393} Standard \u2014 mots\\n\u{1F680} Actif \u2014 pratique\\n\u{1F4DA} Grammaire \u2014 th\xE8mes\\n\u{1F4AC} Conversation \u2014 discussion",
      tip_theme: "\uFFFD\uFFFD Th\xE8me. Activez Fond pour image."
    },
    it: {
      appLang: "\u{1F310} Lingua dell'app",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Voce",
      speechRate: "\u{1F39A}\uFE0F Velocit\xE0 parlato",
      studying: "\u{1F4DA} Studio",
      translate: "\u{1F5E3}\uFE0F Traduzione",
      level: "\u{1F4CA} Livello",
      trainerMode: "\u{1F393} Modalit\xE0 insegnante",
      myProgress: "\u{1F4C8} I miei progressi",
      theme: "\u{1F3A8} Tema",
      chats: "Chat",
      background: "\u{1F5BC}\uFE0F Sfondo",
      standard: "\u{1F4D6} Standard",
      active: "\u{1F680} Attivo",
      grammar: "\u{1F4DA} Grammatica",
      conversation: "\u{1F4AC} Conversazione",
      modeHint: "Parole + quiz con suggerimenti",
      management: "\u{1F4BE} Gestisci",
      export: "\u{1F4E5} Esporta",
      loading: "Caricamento...",
      voiceBtn: "\u{1F3A4} Voce",
      screenBtn: "\u{1F5A5}\uFE0F Schermo",
      cameraBtn: "\u{1F4F7} Fotocamera",
      skipBtn: "\u23ED\uFE0F Salta",
      continueBtn: "\u25B6\uFE0F Continua",
      stopBtn: "\u2B1B Stop",
      sendBtn: "Invia",
      typePlaceholder: "Scrivi un messaggio...",
      searchLang: "\u{1F50D} Cerca lingua...",
      getKey: "Ottieni chiave \u2192",
      settings: "\u2699\uFE0F Impostazioni",
      newChat: "Nuova chat",
      thoughts: "Pensieri",
      tip_apikey: "\u{1F511} Chiave API Google Gemini. Gratis su aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F Voce insegnante IA. Gacrux \u2014 consigliato.",
      tip_speed: "\u{1F39A}\uFE0F Velocit\xE0. 1.0 = normale. 0.7 lento, 1.5 veloce.",
      tip_langs: "\u{1F30D} Sinistra \u2014 lingua da IMPARARE. Destra \u2014 LA TUA lingua.",
      tip_level: "\u{1F4CA} A1 (principiante) \u2192 C2 (fluente). Bot adatta difficolt\xE0.",
      tip_trainer: "\u{1F393} Standard \u2014 parole\\n\u{1F680} Attivo \u2014 pratica\\n\u{1F4DA} Grammatica \u2014 argomenti\\n\u{1F4AC} Conversazione \u2014 chat",
      tip_theme: "\u{1F3A8} Tema. Attiva Sfondo per immagine."
    },
    pt: {
      appLang: "\u{1F310} Idioma do app",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Voz",
      speechRate: "\u{1F39A}\uFE0F Velocidade da fala",
      studying: "\u{1F4DA} Estudando",
      translate: "\u{1F5E3}\uFE0F Tradu\xE7\xE3o",
      level: "\u{1F4CA} N\xEDvel",
      trainerMode: "\u{1F393} Modo treinador",
      myProgress: "\u{1F4C8} Meu progresso",
      theme: "\u{1F3A8} Tema",
      chats: "Chats",
      background: "\u{1F5BC}\uFE0F Fundo",
      standard: "\u{1F4D6} Padr\xE3o",
      active: "\u{1F680} Ativo",
      grammar: "\u{1F4DA} Gram\xE1tica",
      conversation: "\u{1F4AC} Conversa",
      modeHint: "Palavras + quiz com dicas",
      management: "\u{1F4BE} Gest\xE3o",
      export: "\u{1F4E5} Exportar",
      loading: "Carregando...",
      voiceBtn: "\u{1F3A4} Voz",
      screenBtn: "\u{1F5A5}\uFE0F Tela",
      cameraBtn: "\u{1F4F7} C\xE2mera",
      skipBtn: "\u23ED\uFE0F Pular",
      continueBtn: "\u25B6\uFE0F Continuar",
      stopBtn: "\u2B1B Parar",
      sendBtn: "Enviar",
      typePlaceholder: "Digite uma mensagem...",
      searchLang: "\u{1F50D} Buscar idioma...",
      getKey: "Obter chave \u2192",
      settings: "\u2699\uFE0F Configura\xE7\xF5es",
      newChat: "Novo chat",
      thoughts: "Pensamentos",
      tip_apikey: "\u{1F511} Chave API Google Gemini. Gr\xE1tis em aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F Voz do professor IA. Gacrux \u2014 recomendado.",
      tip_speed: "\u{1F39A}\uFE0F Velocidade. 1.0 = normal. 0.7 lento, 1.5 r\xE1pido.",
      tip_langs: "\u{1F30D} Esquerda \u2014 idioma a APRENDER. Direita \u2014 SEU idioma.",
      tip_level: "\u{1F4CA} A1 (iniciante) \u2192 C2 (fluente). Bot ajusta dificuldade.",
      tip_trainer: "\u{1F393} Padr\xE3o \u2014 palavras\\n\u{1F680} Ativo \u2014 pr\xE1tica\\n\u{1F4DA} Gram\xE1tica \u2014 temas\\n\uFFFD\uFFFD Conversa \u2014 bate-papo",
      tip_theme: "\u{1F3A8} Tema. Ative Fundo para imagem."
    },
    ja: {
      appLang: "\u{1F310} \u30A2\u30D7\u30EA\u8A00\u8A9E",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \u58F0",
      speechRate: "\u{1F39A}\uFE0F \u8A71\u3059\u901F\u5EA6",
      studying: "\u{1F4DA} \u5B66\u7FD2\u4E2D",
      translate: "\u{1F5E3}\uFE0F \u7FFB\u8A33",
      level: "\u{1F4CA} \u30EC\u30D9\u30EB",
      trainerMode: "\u{1F393} \u30C8\u30EC\u30FC\u30CA\u30FC\u30E2\u30FC\u30C9",
      myProgress: "\u{1F4C8} \u9032\u6357",
      theme: "\u{1F3A8} \u30C6\u30FC\u30DE",
      chats: "\u30C1\u30E3\u30C3\u30C8",
      background: "\u{1F5BC}\uFE0F \u80CC\u666F",
      standard: "\u{1F4D6} \u30B9\u30BF\u30F3\u30C0\u30FC\u30C9",
      active: "\u{1F680} \u30A2\u30AF\u30C6\u30A3\u30D6",
      grammar: "\u{1F4DA} \u6587\u6CD5",
      conversation: "\u{1F4AC} \u4F1A\u8A71",
      modeHint: "\u5358\u8A9E\uFF0B\u30D2\u30F3\u30C8\u4ED8\u304D\u30AF\u30A4\u30BA",
      management: "\u{1F4BE} \u7BA1\u7406",
      export: "\u{1F4E5} \u30A8\u30AF\u30B9\u30DD\u30FC\u30C8",
      loading: "\u8AAD\u307F\u8FBC\u307F\u4E2D...",
      voiceBtn: "\u{1F3A4} \u97F3\u58F0",
      screenBtn: "\u{1F5A5}\uFE0F \u753B\u9762",
      cameraBtn: "\u{1F4F7} \u30AB\u30E1\u30E9",
      skipBtn: "\u23ED\uFE0F \u30B9\u30AD\u30C3\u30D7",
      continueBtn: "\u25B6\uFE0F \u7D9A\u3051\u308B",
      stopBtn: "\u2B1B \u505C\u6B62",
      sendBtn: "\u9001\u4FE1",
      typePlaceholder: "\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u5165\u529B...",
      searchLang: "\u{1F50D} \u8A00\u8A9E\u3092\u691C\u7D22...",
      getKey: "\u30AD\u30FC\u3092\u53D6\u5F97 \u2192",
      settings: "\u2699\uFE0F \u8A2D\u5B9A",
      newChat: "\u65B0\u3057\u3044\u30C1\u30E3\u30C3\u30C8",
      thoughts: "\u601D\u8003",
      tip_apikey: "\u{1F511} Google Gemini API\u30AD\u30FC\u3002aistudio.google.com\u3067\u7121\u6599\u53D6\u5F97\u3002",
      tip_voice: "\u{1F399}\uFE0F AI\u6559\u5E2B\u306E\u58F0\u3002Gacrux \u2014 \u304A\u3059\u3059\u3081\u3002",
      tip_speed: "\u{1F39A}\uFE0F \u901F\u5EA6\u30021.0 = \u6A19\u6E96\u30020.7 \u9045\u3044\u30011.5 \u901F\u3044\u3002",
      tip_langs: "\u{1F30D} \u5DE6 \u2014 \u5B66\u7FD2\u8A00\u8A9E\u3002\u53F3 \u2014 \u7FFB\u8A33\u8A00\u8A9E\u3002",
      tip_level: "\u{1F4CA} A1\uFF08\u521D\u7D1A\uFF09\u2192 C2\uFF08\u4E0A\u7D1A\uFF09\u3002\u30DC\u30C3\u30C8\u304C\u96E3\u6613\u5EA6\u8ABF\u6574\u3002",
      tip_trainer: "\u{1F393} \u30B9\u30BF\u30F3\u30C0\u30FC\u30C9 \u2014 \u5358\u8A9E\\n\u{1F680} \u30A2\u30AF\u30C6\u30A3\u30D6 \u2014 \u7DF4\u7FD2\\n\u{1F4DA} \u6587\u6CD5 \u2014 \u30C6\u30FC\u30DE\\n\u{1F4AC} \u4F1A\u8A71 \u2014 \u30C1\u30E3\u30C3\u30C8",
      tip_theme: "\u{1F3A8} \u30C6\u30FC\u30DE\u3002\u80CC\u666F\u30AA\u30F3\u3067\u753B\u50CF\u8868\u793A\u3002"
    },
    zh: {
      appLang: "\u{1F310} \u5E94\u7528\u8BED\u8A00",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \u58F0\u97F3",
      speechRate: "\u{1F39A}\uFE0F \u8BED\u901F",
      studying: "\u{1F4DA} \u6B63\u5728\u5B66",
      translate: "\u{1F5E3}\uFE0F \u7FFB\u8BD1",
      level: "\u{1F4CA} \u7B49\u7EA7",
      trainerMode: "\u{1F393} \u6559\u7EC3\u6A21\u5F0F",
      myProgress: "\u{1F4C8} \u6211\u7684\u8FDB\u5EA6",
      theme: "\u{1F3A8} \u4E3B\u9898",
      chats: "\u804A\u5929",
      background: "\u{1F5BC}\uFE0F \u80CC\u666F",
      standard: "\u{1F4D6} \u6807\u51C6",
      active: "\u{1F680} \u4E3B\u52A8",
      grammar: "\u{1F4DA} \u8BED\u6CD5",
      conversation: "\u{1F4AC} \u5BF9\u8BDD",
      modeHint: "\u5355\u8BCD + \u63D0\u793A\u6D4B\u9A8C",
      management: "\u{1F4BE} \u7BA1\u7406",
      export: "\u{1F4E5} \u5BFC\u51FA",
      loading: "\u52A0\u8F7D\u4E2D...",
      voiceBtn: "\u{1F3A4} \u8BED\u97F3",
      screenBtn: "\u{1F5A5}\uFE0F \u5C4F\u5E55",
      cameraBtn: "\u{1F4F7} \u6444\u50CF\u5934",
      skipBtn: "\u23ED\uFE0F \u8DF3\u8FC7",
      continueBtn: "\u25B6\uFE0F \u7EE7\u7EED",
      stopBtn: "\u2B1B \u505C\u6B62",
      sendBtn: "\u53D1\u9001",
      typePlaceholder: "\u8F93\u5165\u6D88\u606F...",
      searchLang: "\u{1F50D} \u641C\u7D22\u8BED\u8A00...",
      getKey: "\u83B7\u53D6\u5BC6\u94A5 \u2192",
      settings: "\u2699\uFE0F \u8BBE\u7F6E",
      newChat: "\u65B0\u804A\u5929",
      thoughts: "\u60F3\u6CD5",
      tip_apikey: "\u{1F511} Google Gemini API\u5BC6\u94A5\u3002aistudio.google.com\u514D\u8D39\u83B7\u53D6\u3002",
      tip_voice: "\u{1F399}\uFE0F AI\u6559\u5E08\u58F0\u97F3\u3002Gacrux \u2014 \u63A8\u8350\u3002",
      tip_speed: "\u{1F39A}\uFE0F \u8BED\u901F\u30021.0 = \u6B63\u5E38\u30020.7 \u6162\uFF0C1.5 \u5FEB\u3002",
      tip_langs: "\u{1F30D} \u5DE6\u8FB9 \u2014 \u5B66\u4E60\u8BED\u8A00\u3002\u53F3\u8FB9 \u2014 \u7FFB\u8BD1\u8BED\u8A00\u3002",
      tip_level: "\u{1F4CA} A1\uFF08\u96F6\u57FA\u7840\uFF09\u2192 C2\uFF08\u6D41\u5229\uFF09\u3002\u673A\u5668\u4EBA\u8C03\u6574\u96BE\u5EA6\u3002",
      tip_trainer: "\u{1F393} \u6807\u51C6 \u2014 \u5355\u8BCD\\n\u{1F680} \u4E3B\u52A8 \u2014 \u7EC3\u4E60\\n\uFFFD\uFFFD \u8BED\u6CD5 \u2014 \u4E3B\u9898\\n\u{1F4AC} \u5BF9\u8BDD \u2014 \u804A\u5929",
      tip_theme: "\u{1F3A8} \u4E3B\u9898\u3002\u542F\u7528\u80CC\u666F\u663E\u793A\u56FE\u7247\u3002"
    },
    ko: {
      appLang: "\u{1F310} \uC571 \uC5B8\uC5B4",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \uC74C\uC131",
      speechRate: "\u{1F39A}\uFE0F \uB9D0\uD558\uAE30 \uC18D\uB3C4",
      studying: "\u{1F4DA} \uD559\uC2B5 \uC911",
      translate: "\u{1F5E3}\uFE0F \uBC88\uC5ED",
      level: "\u{1F4CA} \uB808\uBCA8",
      trainerMode: "\u{1F393} \uD2B8\uB808\uC774\uB108 \uBAA8\uB4DC",
      myProgress: "\u{1F4C8} \uB0B4 \uC9C4\uB3C4",
      theme: "\u{1F3A8} \uD14C\uB9C8",
      chats: "\uCC44\uD305",
      background: "\u{1F5BC}\uFE0F \uBC30\uACBD",
      standard: "\u{1F4D6} \uD45C\uC900",
      active: "\u{1F680} \uD65C\uC131",
      grammar: "\u{1F4DA} \uBB38\uBC95",
      conversation: "\u{1F4AC} \uB300\uD654",
      modeHint: "\uB2E8\uC5B4 + \uD78C\uD2B8 \uD034\uC988",
      management: "\u{1F4BE} \uAD00\uB9AC",
      export: "\u{1F4E5} \uB0B4\uBCF4\uB0B4\uAE30",
      loading: "\uB85C\uB529 \uC911...",
      voiceBtn: "\u{1F3A4} \uC74C\uC131",
      screenBtn: "\u{1F5A5}\uFE0F \uD654\uBA74",
      cameraBtn: "\u{1F4F7} \uCE74\uBA54\uB77C",
      skipBtn: "\u23ED\uFE0F \uAC74\uB108\uB6F0\uAE30",
      continueBtn: "\u25B6\uFE0F \uACC4\uC18D",
      stopBtn: "\u2B1B \uC815\uC9C0",
      sendBtn: "\uBCF4\uB0B4\uAE30",
      typePlaceholder: "\uBA54\uC2DC\uC9C0 \uC785\uB825...",
      searchLang: "\u{1F50D} \uC5B8\uC5B4 \uAC80\uC0C9...",
      getKey: "\uD0A4 \uBC1B\uAE30 \u2192",
      settings: "\u2699\uFE0F \uC124\uC815",
      newChat: "\uC0C8 \uCC44\uD305",
      thoughts: "\uC0DD\uAC01",
      tip_apikey: "\u{1F511} Google Gemini API \uD0A4. aistudio.google.com \uBB34\uB8CC.",
      tip_voice: "\u{1F399}\uFE0F AI \uAD50\uC0AC \uBAA9\uC18C\uB9AC. Gacrux \u2014 \uCD94\uCC9C.",
      tip_speed: "\u{1F39A}\uFE0F \uC18D\uB3C4. 1.0 = \uBCF4\uD1B5. 0.7 \uB290\uB9BC, 1.5 \uBE60\uB984.",
      tip_langs: "\u{1F30D} \uC67C\uCABD \u2014 \uBC30\uC6B8 \uC5B8\uC5B4. \uC624\uB978\uCABD \u2014 \uBC88\uC5ED \uC5B8\uC5B4.",
      tip_level: "\u{1F4CA} A1 (\uCD08\uAE09) \u2192 C2 (\uC720\uCC3D). \uBD07\uC774 \uB09C\uC774\uB3C4 \uC870\uC808.",
      tip_trainer: "\u{1F393} \uD45C\uC900 \u2014 \uB2E8\uC5B4\\n\u{1F680} \uD65C\uC131 \u2014 \uC5F0\uC2B5\\n\u{1F4DA} \uBB38\uBC95 \u2014 \uC8FC\uC81C\\n\u{1F4AC} \uB300\uD654 \u2014 \uCC44\uD305",
      tip_theme: "\u{1F3A8} \uC571 \uD14C\uB9C8. \uBC30\uACBD \uCF1C\uBA74 \uC774\uBBF8\uC9C0 \uD45C\uC2DC."
    },
    pl: {
      appLang: "\u{1F310} J\u0119zyk aplikacji",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F G\u0142os",
      speechRate: "\u{1F39A}\uFE0F Szybko\u015B\u0107 mowy",
      studying: "\u{1F4DA} Ucz\u0119 si\u0119",
      translate: "\u{1F5E3}\uFE0F T\u0142umaczenie",
      level: "\u{1F4CA} Poziom",
      trainerMode: "\u{1F393} Tryb trenera",
      myProgress: "\u{1F4C8} M\xF3j post\u0119p",
      theme: "\u{1F3A8} Motyw",
      chats: "Czaty",
      background: "\u{1F5BC}\uFE0F T\u0142o",
      standard: "\u{1F4D6} Standard",
      active: "\u{1F680} Aktywny",
      grammar: "\u{1F4DA} Gramatyka",
      conversation: "\u{1F4AC} Rozmowa",
      modeHint: "S\u0142owa + quiz z podpowiedziami",
      management: "\u{1F4BE} Zarz\u0105dzaj",
      export: "\u{1F4E5} Eksport",
      loading: "\u0141adowanie...",
      voiceBtn: "\u{1F3A4} G\u0142os",
      screenBtn: "\u{1F5A5}\uFE0F Ekran",
      cameraBtn: "\u{1F4F7} Kamera",
      skipBtn: "\u23ED\uFE0F Pomi\u0144",
      continueBtn: "\u25B6\uFE0F Kontynuuj",
      stopBtn: "\u2B1B Stop",
      sendBtn: "Wy\u015Blij",
      typePlaceholder: "Wpisz wiadomo\u015B\u0107...",
      searchLang: "\u{1F50D} Szukaj j\u0119zyka...",
      getKey: "Pobierz klucz \u2192",
      settings: "\u2699\uFE0F Ustawienia",
      newChat: "Nowy czat",
      thoughts: "My\u015Bli",
      tip_apikey: "\u{1F511} Klucz API Google Gemini. Za darmo na aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F G\u0142os nauczyciela AI. Gacrux \u2014 polecany.",
      tip_speed: "\u{1F39A}\uFE0F Szybko\u015B\u0107. 1.0 = normalna. 0.7 wolna, 1.5 szybka.",
      tip_langs: "\u{1F30D} Lewo \u2014 j\u0119zyk do NAUKI. Prawo \u2014 TW\xD3J j\u0119zyk.",
      tip_level: "\u{1F4CA} A1 (pocz\u0105tkuj\u0105cy) \u2192 C2 (bieg\u0142y). Bot dostosowuje trudno\u015B\u0107.",
      tip_trainer: "\u{1F393} Standard \u2014 s\u0142owa\\n\uFFFD\uFFFD Aktywny \u2014 \u0107wiczenia\\n\u{1F4DA} Gramatyka \u2014 tematy\\n\u{1F4AC} Rozmowa \u2014 czat",
      tip_theme: "\u{1F3A8} Motyw. W\u0142\u0105cz T\u0142o dla obrazu."
    },
    tr: {
      appLang: "\u{1F310} Uygulama dili",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F Ses",
      speechRate: "\u{1F39A}\uFE0F Konu\u015Fma h\u0131z\u0131",
      studying: "\u{1F4DA} \xD6\u011Freniyorum",
      translate: "\u{1F5E3}\uFE0F \xC7eviri",
      level: "\u{1F4CA} Seviye",
      trainerMode: "\u{1F393} E\u011Fitmen modu",
      myProgress: "\u{1F4C8} \u0130lerlemem",
      theme: "\u{1F3A8} Tema",
      chats: "Sohbetler",
      background: "\u{1F5BC}\uFE0F Arkaplan",
      standard: "\u{1F4D6} Standart",
      active: "\u{1F680} Aktif",
      grammar: "\u{1F4DA} Dilbilgisi",
      conversation: "\u{1F4AC} Konu\u015Fma",
      modeHint: "Kelimeler + ipu\xE7lu s\u0131nav",
      management: "\u{1F4BE} Y\xF6netim",
      export: "\u{1F4E5} D\u0131\u015Fa aktar",
      loading: "Y\xFCkleniyor...",
      voiceBtn: "\u{1F3A4} Ses",
      screenBtn: "\u{1F5A5}\uFE0F Ekran",
      cameraBtn: "\u{1F4F7} Kamera",
      skipBtn: "\u23ED\uFE0F Atla",
      continueBtn: "\u25B6\uFE0F Devam",
      stopBtn: "\u2B1B Durdur",
      sendBtn: "G\xF6nder",
      typePlaceholder: "Mesaj yaz...",
      searchLang: "\u{1F50D} Dil ara...",
      getKey: "Anahtar al \u2192",
      settings: "\u2699\uFE0F Ayarlar",
      newChat: "Yeni sohbet",
      thoughts: "D\xFC\u015F\xFCnceler",
      tip_apikey: "\u{1F511} Google Gemini API anahtar\u0131. aistudio.google.com \xFCcretsiz.",
      tip_voice: "\u{1F399}\uFE0F AI \xF6\u011Fretmen sesi. Gacrux \u2014 \xF6nerilen.",
      tip_speed: "\u{1F39A}\uFE0F H\u0131z. 1.0 = normal. 0.7 yava\u015F, 1.5 h\u0131zl\u0131.",
      tip_langs: "\u{1F30D} Sol \u2014 \xF6\u011Frenilecek dil. Sa\u011F \u2014 \xE7eviri diliniz.",
      tip_level: "\u{1F4CA} A1 (ba\u015Flang\u0131\xE7) \u2192 C2 (ak\u0131c\u0131). Bot zorlu\u011Fu ayarlar.",
      tip_trainer: "\u{1F393} Standart \u2014 kelimeler\\n\u{1F680} Aktif \u2014 pratik\\n\u{1F4DA} Dilbilgisi \u2014 konular\\n\u{1F4AC} Konu\u015Fma \u2014 sohbet",
      tip_theme: "\u{1F3A8} Tema. Resim i\xE7in Arkaplan etkinle\u015Ftirin."
    },
    ar: {
      appLang: "\u{1F310} \u0644\u063A\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \u0627\u0644\u0635\u0648\u062A",
      speechRate: "\u{1F39A}\uFE0F \u0633\u0631\u0639\u0629 \u0627\u0644\u0643\u0644\u0627\u0645",
      studying: "\u{1F4DA} \u0623\u062F\u0631\u0633",
      translate: "\u{1F5E3}\uFE0F \u0627\u0644\u062A\u0631\u062C\u0645\u0629",
      level: "\u{1F4CA} \u0627\u0644\u0645\u0633\u062A\u0648\u0649",
      trainerMode: "\u{1F393} \u0648\u0636\u0639 \u0627\u0644\u0645\u062F\u0631\u0628",
      myProgress: "\u{1F4C8} \u062A\u0642\u062F\u0645\u064A",
      theme: "\u{1F3A8} \u0627\u0644\u0633\u0645\u0629",
      chats: "\u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0627\u062A",
      background: "\u{1F5BC}\uFE0F \u0627\u0644\u062E\u0644\u0641\u064A\u0629",
      standard: "\u{1F4D6} \u0639\u0627\u062F\u064A",
      active: "\u{1F680} \u0646\u0634\u0637",
      grammar: "\u{1F4DA} \u0642\u0648\u0627\u0639\u062F",
      conversation: "\u{1F4AC} \u0645\u062D\u0627\u062F\u062B\u0629",
      modeHint: "\u0643\u0644\u0645\u0627\u062A + \u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0639 \u062A\u0644\u0645\u064A\u062D\u0627\u062A",
      management: "\u{1F4BE} \u0625\u062F\u0627\u0631\u0629",
      export: "\u{1F4E5} \u062A\u0635\u062F\u064A\u0631",
      loading: "\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644...",
      voiceBtn: "\u{1F3A4} \u0635\u0648\u062A",
      screenBtn: "\u{1F5A5}\uFE0F \u0634\u0627\u0634\u0629",
      cameraBtn: "\u{1F4F7} \u0643\u0627\u0645\u064A\u0631\u0627",
      skipBtn: "\u23ED\uFE0F \u062A\u062E\u0637\u064A",
      continueBtn: "\u25B6\uFE0F \u0645\u062A\u0627\u0628\u0639\u0629",
      stopBtn: "\u2B1B \u0625\u064A\u0642\u0627\u0641",
      sendBtn: "\u0625\u0631\u0633\u0627\u0644",
      typePlaceholder: "\u0627\u0643\u062A\u0628 \u0631\u0633\u0627\u0644\u0629...",
      searchLang: "\u{1F50D} \u0628\u062D\u062B \u0639\u0646 \u0644\u063A\u0629...",
      getKey: "\u0627\u062D\u0635\u0644 \u0639\u0644\u0649 \u0645\u0641\u062A\u0627\u062D \u2192",
      settings: "\u2699\uFE0F \u0625\u0639\u062F\u0627\u062F\u0627\u062A",
      newChat: "\u0645\u062D\u0627\u062F\u062B\u0629 \u062C\u062F\u064A\u062F\u0629",
      thoughts: "\u0623\u0641\u0643\u0627\u0631",
      tip_apikey: "\u{1F511} \u0645\u0641\u062A\u0627\u062D API Google Gemini. \u0645\u062C\u0627\u0646\u064A \u0645\u0646 aistudio.google.com.",
      tip_voice: "\u{1F399}\uFE0F \u0635\u0648\u062A \u0627\u0644\u0645\u0639\u0644\u0645 \u0627\u0644\u0630\u0643\u064A. Gacrux \u2014 \u0645\u0648\u0635\u0649 \u0628\u0647.",
      tip_speed: "\u{1F39A}\uFE0F \u0627\u0644\u0633\u0631\u0639\u0629. 1.0 = \u0639\u0627\u062F\u064A. 0.7 \u0628\u0637\u064A\u0621\u060C 1.5 \u0633\u0631\u064A\u0639.",
      tip_langs: "\u{1F30D} \u064A\u0633\u0627\u0631 \u2014 \u0644\u063A\u0629 \u0627\u0644\u062A\u0639\u0644\u0645. \u064A\u0645\u064A\u0646 \u2014 \u0644\u063A\u062A\u0643 \u0644\u0644\u062A\u0631\u062C\u0645\u0629.",
      tip_level: "\u{1F4CA} A1 (\u0645\u0628\u062A\u062F\u0626) \u2192 C2 (\u0637\u0644\u064A\u0642). \u0627\u0644\u0628\u0648\u062A \u064A\u0636\u0628\u0637 \u0627\u0644\u0635\u0639\u0648\u0628\u0629.",
      tip_trainer: "\u{1F393} \u0639\u0627\u062F\u064A \u2014 \u0643\u0644\u0645\u0627\u062A\\n\u{1F680} \u0646\u0634\u0637 \u2014 \u062A\u062F\u0631\u064A\u0628\\n\u{1F4DA} \u0642\u0648\u0627\u0639\u062F \u2014 \u0645\u0648\u0627\u0636\u064A\u0639\\n\u{1F4AC} \u0645\u062D\u0627\u062F\u062B\u0629 \u2014 \u062F\u0631\u062F\u0634\u0629",
      tip_theme: "\u{1F3A8} \u0633\u0645\u0629 \u0627\u0644\u062A\u0637\u0628\u064A\u0642. \u0641\u0639\u0651\u0644 \u0627\u0644\u062E\u0644\u0641\u064A\u0629 \u0644\u0635\u0648\u0631\u0629."
    },
    hi: {
      appLang: "\u{1F310} \u0910\u092A \u092D\u093E\u0937\u093E",
      apikey: "\u{1F511} API KEY",
      voice: "\u{1F399}\uFE0F \u0906\u0935\u093E\u091C\u093C",
      speechRate: "\u{1F39A}\uFE0F \u092C\u094B\u0932\u0928\u0947 \u0915\u0940 \u0917\u0924\u093F",
      studying: "\u{1F4DA} \u092A\u0922\u093C \u0930\u0939\u093E \u0939\u0942\u0901",
      translate: "\u{1F5E3}\uFE0F \u0905\u0928\u0941\u0935\u093E\u0926",
      level: "\u{1F4CA} \u0938\u094D\u0924\u0930",
      trainerMode: "\u{1F393} \u092A\u094D\u0930\u0936\u093F\u0915\u094D\u0937\u0915 \u092E\u094B\u0921",
      myProgress: "\u{1F4C8} \u092E\u0947\u0930\u0940 \u092A\u094D\u0930\u0917\u0924\u093F",
      theme: "\u{1F3A8} \u0925\u0940\u092E",
      chats: "\u091A\u0948\u091F",
      background: "\u{1F5BC}\uFE0F \u092A\u0943\u0937\u094D\u0920\u092D\u0942\u092E\u093F",
      standard: "\u{1F4D6} \u092E\u093E\u0928\u0915",
      active: "\u{1F680} \u0938\u0915\u094D\u0930\u093F\u092F",
      grammar: "\u{1F4DA} \u0935\u094D\u092F\u093E\u0915\u0930\u0923",
      conversation: "\u{1F4AC} \u092C\u093E\u0924\u091A\u0940\u0924",
      modeHint: "\u0936\u092C\u094D\u0926 + \u0938\u0902\u0915\u0947\u0924\u094B\u0902 \u0915\u0947 \u0938\u093E\u0925 \u0915\u094D\u0935\u093F\u091C\u093C",
      management: "\u{1F4BE} \u092A\u094D\u0930\u092C\u0902\u0927\u0928",
      export: "\u{1F4E5} \u0928\u093F\u0930\u094D\u092F\u093E\u0924",
      loading: "\u0932\u094B\u0921 \u0939\u094B \u0930\u0939\u093E \u0939\u0948...",
      voiceBtn: "\u{1F3A4} \u0906\u0935\u093E\u091C\u093C",
      screenBtn: "\u{1F5A5}\uFE0F \u0938\u094D\u0915\u094D\u0930\u0940\u0928",
      cameraBtn: "\u{1F4F7} \u0915\u0948\u092E\u0930\u093E",
      skipBtn: "\u23ED\uFE0F \u091B\u094B\u0921\u093C\u0947\u0902",
      continueBtn: "\u25B6\uFE0F \u091C\u093E\u0930\u0940 \u0930\u0916\u0947\u0902",
      stopBtn: "\u2B1B \u0930\u0941\u0915\u0947\u0902",
      sendBtn: "\u092D\u0947\u091C\u0947\u0902",
      typePlaceholder: "\u0938\u0902\u0926\u0947\u0936 \u0932\u093F\u0916\u0947\u0902...",
      searchLang: "\u{1F50D} \u092D\u093E\u0937\u093E \u0916\u094B\u091C\u0947\u0902...",
      getKey: "\u0915\u0941\u0902\u091C\u0940 \u092A\u094D\u0930\u093E\u092A\u094D\u0924 \u0915\u0930\u0947\u0902 \u2192",
      settings: "\u2699\uFE0F \u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938",
      newChat: "\u0928\u0908 \u091A\u0948\u091F",
      thoughts: "\u0935\u093F\u091A\u093E\u0930",
      tip_apikey: "\u{1F511} Google Gemini API \u0915\u0941\u0902\u091C\u0940\u0964 aistudio.google.com \u092A\u0930 \u092E\u0941\u092B\u094D\u0924\u0964",
      tip_voice: "\u{1F399}\uFE0F AI \u0936\u093F\u0915\u094D\u0937\u0915 \u0915\u0940 \u0906\u0935\u093E\u091C\u093C\u0964 Gacrux \u2014 \u0938\u0941\u091D\u093E\u0935\u0964",
      tip_speed: "\u{1F39A}\uFE0F \u0917\u0924\u093F\u0964 1.0 = \u0938\u093E\u092E\u093E\u0928\u094D\u092F\u0964 0.7 \u0927\u0940\u092E\u093E, 1.5 \u0924\u0947\u091C\u093C\u0964",
      tip_langs: "\u{1F30D} \u092C\u093E\u090F\u0902 \u2014 \u0938\u0940\u0916\u0928\u0947 \u0915\u0940 \u092D\u093E\u0937\u093E\u0964 \u0926\u093E\u090F\u0902 \u2014 \u0905\u0928\u0941\u0935\u093E\u0926 \u092D\u093E\u0937\u093E\u0964",
      tip_level: "\u{1F4CA} A1 (\u0936\u0941\u0930\u0941\u0906\u0924) \u2192 C2 (\u0927\u093E\u0930\u093E\u092A\u094D\u0930\u0935\u093E\u0939)\u0964 \u092C\u0949\u091F \u0915\u0920\u093F\u0928\u093E\u0908 \u0938\u092E\u093E\u092F\u094B\u091C\u093F\u0924\u0964",
      tip_trainer: "\u{1F393} \u0938\u094D\u091F\u0948\u0902\u0921\u0930\u094D\u0921 \u2014 \u0936\u092C\u094D\u0926\\n\u{1F680} \u0938\u0915\u094D\u0930\u093F\u092F \u2014 \u0905\u092D\u094D\u092F\u093E\u0938\\n\u{1F4DA} \u0935\u094D\u092F\u093E\u0915\u0930\u0923 \u2014 \u0935\u093F\u0937\u092F\\n\u{1F4AC} \u0935\u093E\u0930\u094D\u0924\u093E\u0932\u093E\u092A \u2014 \u091A\u0948\u091F",
      tip_theme: "\u{1F3A8} \u0910\u092A \u0925\u0940\u092E\u0964 \u091B\u0935\u093F \u0915\u0947 \u0932\u093F\u090F \u092A\u0943\u0937\u094D\u0920\u092D\u0942\u092E\u093F \u0938\u0915\u094D\u0937\u092E \u0915\u0930\u0947\u0902\u0964"
    }
  };
  var currentLang = "ru";
  function t(key) {
    return T[currentLang]?.[key] || T["en"]?.[key] || key;
  }
  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const text = t(key);
      const children = Array.from(el.children);
      if (children.length > 0) {
        el.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            node.textContent = text + " ";
          }
        });
      } else {
        el.textContent = text;
      }
    });
    const radioMap = {
      standard: t("standard"),
      active: t("active"),
      grammar: t("grammar"),
      free_conversation: t("conversation")
    };
    document.querySelectorAll(".teacher-mode-radios .radio-label").forEach((label) => {
      const input = label.querySelector('input[type="radio"]');
      const span = label.querySelector("span:last-child");
      if (input && span && radioMap[input.value])
        span.textContent = radioMap[input.value];
    });
    const mgmt = document.getElementById("open-saves-modal-btn");
    if (mgmt)
      mgmt.textContent = t("management");
    const exp = document.getElementById("export-words-btn");
    if (exp)
      exp.textContent = t("export");
    const ld = document.querySelector(".progress-loading");
    if (ld)
      ld.textContent = t("loading");
    const modeBtns = [
      ["btn-voice", "voiceBtn"],
      ["btn-screen", "screenBtn"],
      ["btn-camera", "cameraBtn"]
    ];
    for (const [id, key] of modeBtns) {
      const btn = document.getElementById(id);
      if (btn) {
        const textSpan = btn.querySelector("span:last-child");
        if (textSpan) {
          const text = t(key);
          const parts = text.split(" ");
          textSpan.textContent = parts.length > 1 ? parts.slice(1).join(" ") : text;
        }
      }
    }
    const skipBtn = document.getElementById("skip-speech-btn");
    if (skipBtn)
      skipBtn.textContent = t("skipBtn");
    const stopBtn = document.getElementById("stop-btn");
    if (stopBtn)
      stopBtn.textContent = t("stopBtn");
    const continueBtn = document.getElementById("continue-btn");
    if (continueBtn)
      continueBtn.textContent = t("continueBtn");
    const msgInput = document.getElementById("message-input");
    if (msgInput)
      msgInput.placeholder = t("typePlaceholder");
    const getKeyLink = document.querySelector(".settings-group .link");
    if (getKeyLink)
      getKeyLink.textContent = t("getKey");
    const chatsHeader = document.querySelector(".sidebar-header span");
    if (chatsHeader) {
      const img = chatsHeader.querySelector("img");
      if (img) {
        chatsHeader.textContent = "";
        chatsHeader.appendChild(img);
        chatsHeader.appendChild(document.createTextNode(" " + t("chats")));
      } else {
        chatsHeader.textContent = t("chats");
      }
    }
    const thoughtsBtns = document.querySelectorAll(".thinking-toggle-text");
    thoughtsBtns.forEach((el) => {
      el.textContent = t("thoughts");
    });
    const settingsLinks = document.querySelectorAll('[data-i18n="settings"]');
    settingsLinks.forEach((el) => {
      el.textContent = t("settings");
    });
    updatePickerButton();
  }
  var pickerBtn = null;
  var pickerDropdown = null;
  function updatePickerButton() {
    if (!pickerBtn)
      return;
    const meta = LANGS[currentLang];
    pickerBtn.innerHTML = `
        <span class="lang-flag">${meta.flag}</span>
        <span class="lang-name">${meta.native}</span>
        <span class="lang-arrow">\u25BE</span>
    `;
  }
  function buildPicker(container2) {
    container2.innerHTML = `
        <label data-i18n="appLang">${t("appLang")}</label>
        <div class="language-picker app-lang-picker" id="app-lang-picker">
            <button class="language-picker-btn" id="app-lang-picker-btn" type="button">
                <span class="lang-flag">${LANGS[currentLang].flag}</span>
                <span class="lang-name">${LANGS[currentLang].native}</span>
                <span class="lang-arrow">\u25BE</span>
            </button>
            <div class="language-picker-dropdown" id="app-lang-dropdown">
                <input type="text" class="language-search" id="app-lang-search"
                    placeholder="\u{1F50D} Search..." autocomplete="off">
                <div class="language-list" id="app-lang-list"></div>
            </div>
        </div>
    `;
    pickerBtn = container2.querySelector("#app-lang-picker-btn");
    pickerDropdown = container2.querySelector("#app-lang-dropdown");
    const searchInput = container2.querySelector("#app-lang-search");
    const listEl = container2.querySelector("#app-lang-list");
    function renderList(filter = "") {
      listEl.innerHTML = "";
      const q = filter.toLowerCase();
      for (const [code, meta] of Object.entries(LANGS)) {
        const match = !q || meta.name.toLowerCase().includes(q) || meta.native.toLowerCase().includes(q) || code.includes(q);
        if (!match)
          continue;
        const item = document.createElement("div");
        item.className = "language-item" + (code === currentLang ? " selected" : "");
        item.innerHTML = `
                <span class="lang-item-flag">${meta.flag}</span>
                <span class="lang-item-name">${meta.native}</span>
                <span class="lang-item-en">${meta.name}</span>
            `;
        item.addEventListener("click", () => {
          currentLang = code;
          localStorage.setItem("app_language", currentLang);
          pickerDropdown?.classList.remove("open");
          applyTranslations();
        });
        listEl.appendChild(item);
      }
    }
    pickerBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen2 = pickerDropdown?.classList.contains("open");
      document.querySelectorAll(".language-picker-dropdown.open").forEach((d) => d.classList.remove("open"));
      if (!isOpen2 && pickerBtn && pickerDropdown) {
        const btnEl = pickerBtn;
        const dropEl = pickerDropdown;
        const app = document.querySelector(".app") || document.body;
        if (dropEl.parentElement !== app) {
          app.appendChild(dropEl);
        }
        requestAnimationFrame(() => {
          const rect = btnEl.getBoundingClientRect();
          const dropW = 240;
          let left = rect.left;
          if (left + dropW > window.innerWidth - 10)
            left = window.innerWidth - dropW - 10;
          if (left < 10)
            left = 10;
          const dropH = dropEl.offsetHeight || 300;
          let top = rect.bottom + 4;
          if (top + dropH > window.innerHeight - 10) {
            top = rect.top - dropH - 4;
            if (top < 10)
              top = 10;
          }
          dropEl.style.position = "fixed";
          dropEl.style.left = `${left}px`;
          dropEl.style.top = `${top}px`;
          dropEl.style.width = `${Math.max(dropW, rect.width)}px`;
          dropEl.style.zIndex = "99999";
          dropEl.classList.add("open");
          searchInput.value = "";
          renderList();
          searchInput.focus();
        });
      }
    });
    searchInput?.addEventListener("input", () => {
      renderList(searchInput.value);
    });
    document.addEventListener("click", (e) => {
      if (!container2.contains(e.target)) {
        pickerDropdown?.classList.remove("open");
      }
    });
    renderList();
  }
  function initI18n() {
    const saved = localStorage.getItem("app_language");
    if (saved && T[saved])
      currentLang = saved;
    const sidebar = document.querySelector(".sidebar-right");
    const themeGroup = sidebar?.querySelector(".theme-group");
    if (sidebar && themeGroup) {
      const group = document.createElement("div");
      group.className = "settings-group app-lang-group";
      themeGroup.insertAdjacentElement("afterend", group);
      buildPicker(group);
    }
    applyTranslations();
  }

  // src/modules/ui/cheatsheet.ts
  var cheatsheetWindow = null;
  var isDragging = false;
  var isResizing = false;
  var resizeDirection = "";
  var dragOffset = { x: 0, y: 0 };
  var resizeStart = { x: 0, y: 0, width: 0, height: 0 };
  var wordsData = null;
  var SIZE_CACHE_KEY = "cheatsheet_size";
  var DEFAULT_SIZE = { width: 460, height: 520 };
  function getGermanReference(level) {
    const sections = [
      {
        title: `\u{1F4CC} ${t("gram_articles") || "Articles"} (Artikel)`,
        content: `
    <table class="grammar-table">
        <tr><th></th><th>Maskulin</th><th>Feminin</th><th>Neutrum</th><th>Plural</th></tr>
        <tr><td><b>Nom </b></td> <td>der </td><td>die</td> <td>das </td><td>die</td> </tr>
        <tr> <td><b>Akk </b></td> <td>den </td><td>die</td> <td>das </td><td>die</td> </tr>
        <tr> <td><b>Dat </b></td> <td>dem </td><td>der</td> <td>dem </td><td>den</td> </tr>
        <tr> <td><b>Gen </b></td> <td>des </td><td>der</td> <td>des </td><td>der</td> </tr>
        </table>
            `
      },
      {
        title: `\u{1F464} ${t("gram_pronouns") || "Pronouns"} (Pronomen)`,
        content: `
        <table class="grammar-table">
            <tr><th>Nom</th><th>Akk</th><th>Dat</th><th>Poss.</th></tr>
            <tr> <td>ich </td><td>mich</td> <td>mir </td><td>mein</td> </tr>
            <tr> <td>du </td><td>dich</td> <td>dir </td><td>dein</td> </tr>
            <tr> <td>er </td><td>ihn</td> <td>ihm </td><td>sein</td> </tr>
            <tr> <td>sie </td><td>sie</td> <td>ihr </td><td>ihr</td> </tr>
            <tr> <td>es </td><td>es</td> <td>ihm </td><td>sein</td> </tr>
            <tr> <td>wir </td><td>uns</td> <td>uns </td><td>unser</td> </tr>
            <tr> <td>ihr </td><td>euch</td> <td>euch </td><td>euer</td> </tr>
            <tr> <td>sie / Sie </td><td>sie/Sie </td><td>ihnen/Ihnen </td><td>ihr/Ihr </td></tr>
            </table>
                `
      },
      {
        title: `\u{1F504} ${t("gram_verbs_present") || "Verbs:Present"} (Pr\xE4sens)`,
        content: `
            <table class="grammar-table">
                <tr><th></th><th>sein</th> <th>haben </th><th>werden</th> <th>-en </th></tr>
                <tr><td>ich </td><td>bin</td> <td>habe </td><td>werde</td> <td>-e </td></tr>
                <tr><td>du </td><td>bist</td> <td>hast </td><td>wirst</td> <td>-st </td></tr>
                <tr><td>er / sie </td><td>ist</td> <td>hat </td><td>wird</td> <td>-t </td></tr>
                <tr><td>wir </td><td>sind</td> <td>haben </td><td>werden</td> <td>-en </td></tr>
                <tr><td>ihr </td><td>seid</td> <td>habt </td><td>werdet</td> <td>-t </td></tr>
                <tr><td>sie / Sie </td><td>sind</td> <td>haben </td><td>werden</td> <td>-en </td></tr>
                </table>
                    `
      },
      {
        title: `\u23F0 ${t("gram_tenses") || "Tenses"} (Zeiten)`,
        content: `
                <div class="grammar-card"> <b>Perfekt:</b> haben/sein + Partizip II <br> <i>Ich <u> habe </u> gemacht. Er <u>ist</u> gegangen.</i></div>
                    <div class="grammar-card"> <b>Pr\xE4teritum:</b> hatte, war, konnte, musste...<br><i>Ich <u>war</u> m\xFCde.Sie <u> hatte </u> Zeit.</i> </div>
                        <div class="grammar-card"> <b>Futur I:</b> werden + Infinitiv<br><i>Ich <u>werde</u> lernen.</i></div>
                            ${level >= "B1" ? `<div class="grammar-card"><b>Plusquamperfekt:</b> hatte/war + Part.II<br><i>Nachdem ich gegessen <u>hatte</u>...</i></div>
                <div class="grammar-card"><b>Konjunktiv II:</b> w\xFCrde + Inf / w\xE4re, h\xE4tte<br><i>Wenn ich Zeit <u>h\xE4tte</u>, <u>w\xFCrde</u> ich...</i></div>` : ""}
`
      },
      {
        title: `\u{1F4D0} ${t("gram_prepositions") || "Prepositions"} (Pr\xE4positionen)`,
        content: `
    <div class="grammar-card"> <b>+ Akkusativ:</b> durch, f\xFCr, gegen, ohne, um, bis, entlang</div>
        <div class="grammar-card"> <b>+ Dativ:</b> aus, bei, mit, nach, seit, von, zu, gegen\xFCber</div>
            <div class="grammar-card"> <b>Wechsel(Akk / Dat):</b> an, auf, hinter, in, neben, \xFCber, unter, vor, zwischen<br>
                <small> Wohin ? \u2192 Akk | Wo ? \u2192 Dat </small></div>
                    ${level >= "B1" ? `<div class="grammar-card"><b>+ Genitiv:</b> wegen, w\xE4hrend, trotz, statt, innerhalb, au\xDFerhalb</div>` : ""}
`
      }
    ];
    if (level >= "B1") {
      sections.push({
        title: `\u{1F517} ${t("gram_conjunctions") || "Conjunctions"} (Konjunktionen)`,
        content: `
    <div class="grammar-card"> <b>Hauptsatz(V2):</b> und, aber, oder, denn, sondern</div>
        <div class="grammar-card"> <b>Nebensatz(V\u2192Ende):</b> weil, dass, wenn, als, ob, obwohl, nachdem, bevor, damit</div>
            <div class="grammar-card"> <b>Doppel:</b> sowohl...als auch, weder...noch, entweder...oder, nicht nur...sondern auch, je...desto</div>
                `
      });
    }
    if (level >= "B1") {
      sections.push({
        title: `\u{1F500} ${t("gram_passive") || "Passive"} (Passiv)`,
        content: `
                <div class="grammar-card"> <b>Pr\xE4sens:</b> wird + Part.II \u2192 <i>Das Haus <u>wird gebaut</u>.</i></div>
                    <div class="grammar-card"> <b>Pr\xE4t:</b> wurde + Part.II \u2192 <i>Es <u>wurde gemacht</u>.</i></div>
                        <div class="grammar-card"> <b>Perfekt:</b> ist + Part.II + worden \u2192 <i>Es <u>ist gebaut worden</u>.</i></div>
                            `
      });
    }
    return sections;
  }
  function getEnglishReference(level) {
    return [
      {
        title: `\u23F0 ${t("gram_tenses") || "Tenses"} Overview`,
        content: `
                            <div class="grammar-card"> <b>Present Simple:</b> I work / He works <br> <small>Habits, facts, schedules </small></div>
                                <div class="grammar-card"> <b>Present Continuous:</b> I am working<br><small>Right now, temporary</small> </div>
                                    <div class="grammar-card"> <b>Past Simple:</b> I worked / I went <br> <small>Finished actions in past </small></div>
                                        <div class="grammar-card"> <b>Present Perfect:</b> I have worked<br><small>Past \u2192 now connection</small> </div>
                ${level >= "B1" ? `
                <div class="grammar-card"><b>Past Perfect:</b> I had worked<br><small>Before another past action</small></div>
                <div class="grammar-card"><b>Future Perfect:</b> I will have worked<br><small>Completed before a future time</small></div>
                ` : ""}
`
      },
      {
        title: `\u{1F4CC} ${t("gram_articles") || "Articles"} & Determiners`,
        content: `
    <div class="grammar-card"> <b>a / an </b> \u2014 \u043E\u0434\u0438\u043D \u0438\u0437 \u043C\u043D\u043E\u0433\u0438\u0445 (I saw <u>a</u> cat)</div>
        <div class="grammar-card"> <b>the </b> \u2014 \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u044B\u0439 (<u>The</u> cat is black)</div>
            <div class="grammar-card"> <b>some / any </b> \u2014 some (+), any (\u2212/ ?)</div>
                <div class="grammar-card"> <b>much / many </b> \u2014 much (uncountable), many (countable)</div>
                    `
      },
      {
        title: `\u{1F517} ${t("gram_conditionals") || "Conditionals"}`,
        content: `
                    <div class="grammar-card"> <b>0:</b> If + Present \u2192 Present<br><i>If you heat water, it boils.</i> </div>
                        <div class="grammar-card"> <b>1:</b> If + Present \u2192 will + V<br><i>If it rains, I will stay home.</i> </div>
                            <div class="grammar-card"> <b>2:</b> If + Past \u2192 would + V<br><i>If I were rich, I would travel.</i> </div>
                ${level >= "B1" ? `<div class="grammar-card"><b>3:</b> If + Past Perfect \u2192 would have + V3<br><i>If I had known, I would have helped.</i></div>` : ""}
`
      }
    ];
  }
  function getJapaneseReference(_level) {
    return [
      {
        title: `\u{1F524} ${t("gram_hiragana") || "Hiragana"} (Hiragana)`,
        content: `
    <table class="grammar-table compact">
        <tr><td>\u3042 a </td><td>\u3044 i</td> <td>\u3046 u </td><td>\u3048 e</td> <td>\u304A o </td></tr>
            <tr><td>\u304B ka </td><td>\u304D ki</td> <td>\u304F ku </td><td>\u3051 ke</td> <td>\u3053 ko </td></tr>
                <tr><td>\u3055 sa </td><td>\u3057 shi</td> <td>\u3059 su </td><td>\u305B se</td> <td>\u305D so </td></tr>
                    <tr><td>\u305F ta </td><td>\u3061 chi</td> <td>\u3064 tsu </td><td>\u3066 te</td> <td>\u3068 to </td></tr>
                        <tr><td>\u306A na </td><td>\u306B ni</td> <td>\u306C nu </td><td>\u306D ne</td> <td>\u306E no </td></tr>
                            <tr><td>\u306F ha </td><td>\u3072 hi</td> <td>\u3075 fu </td><td>\u3078 he</td> <td>\u307B ho </td></tr>
                                <tr><td>\u307E ma </td><td>\u307F mi</td> <td>\u3080 mu </td><td>\u3081 me</td> <td>\u3082 mo </td></tr>
                                    <tr><td>\u3089 ra </td><td>\u308A ri</td> <td>\u308B ru </td><td>\u308C re</td> <td>\u308D ro </td></tr>
                                        <tr><td>\u3084 ya </td><td></td> <td>\u3086 yu </td><td></td> <td>\u3088 yo </td></tr>
                                            <tr><td>\u308F wa </td><td></td> <td>\u3093 n </td><td></td> <td>\u3092 wo </td></tr>
                                                </table>
                                                    `
      },
      {
        title: `\u{1F3F7}\uFE0F ${t("gram_particles") || "Particles"} (Particles)`,
        content: `
                                                <div class="grammar-card"> <b>\u306F(wa) </b> \u2014 \u0442\u0435\u043C\u0430 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F:\u79C1<u>\u306F</u> \u5B66\u751F\u3067\u3059 </div>
                                                    <div class="grammar-card"> <b>\u304C(ga) </b> \u2014 \u043F\u043E\u0434\u043B\u0435\u0436\u0430\u0449\u0435\u0435:\u732B<u>\u304C</u> \u3044\u307E\u3059 </div>
                                                        <div class="grammar-card"> <b>\u3092(wo) </b> \u2014 \u043E\u0431\u044A\u0435\u043A\u0442:\u672C<u>\u3092</u> \u8AAD\u3080 </div>
                                                            <div class="grammar-card"> <b>\u306B(ni) </b> \u2014 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435/\u0432\u0440\u0435\u043C\u044F:\u5B66\u6821 <u> \u306B </u>\u884C\u304F</div>
                                                                <div class="grammar-card"> <b>\u3067(de) </b> \u2014 \u043C\u0435\u0441\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F/\u0441\u0440\u0435\u0434\u0441\u0442\u0432\u043E:\u30AB\u30D5\u30A7 <u> \u3067 </u>\u52C9\u5F37\u3059\u308B</div>
                                                                    <div class="grammar-card"> <b>\u306E(no) </b> \u2014 \u043F\u0440\u0438\u0442\u044F\u0436\u0430\u043D\u0438\u0435:\u79C1<u>\u306E</u> \u672C </div>
                                                                        `
      },
      {
        title: `\u{1F504} ${t("gram_verb_forms") || "Verb Forms"}`,
        content: `
                                                                        <div class="grammar-card"> <b>\u301C\u307E\u3059(masu) </b> \u2014 \u0432\u0435\u0436\u043B\u0438\u0432\u0430\u044F:\u98DF\u3079<u>\u307E\u3059</u> </div>
                                                                            <div class="grammar-card"> <b>\u301C\u307E\u305B\u3093 </b> \u2014 \u043E\u0442\u0440\u0438\u0446\u0430\u043D\u0438\u0435:\u98DF\u3079<u>\u307E\u305B\u3093</u> </div>
                                                                                <div class="grammar-card"> <b>\u301C\u307E\u3057\u305F </b> \u2014 \u043F\u0440\u043E\u0448\u043B\u043E\u0435:\u98DF\u3079<u>\u307E\u3057\u305F</u> </div>
                                                                                    <div class="grammar-card"> <b>\u301C\u3066(te) </b> \u2014 \u0441\u043E\u0435\u0434\u0438\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F:\u98DF\u3079<u>\u3066</u> \u304F\u3060\u3055\u3044 </div>
                                                                                        `
      }
    ];
  }
  function getGrammarReference() {
    const lang = localStorage.getItem("gemini_target_language") || "German";
    const level = localStorage.getItem("gemini_level") || "A1";
    switch (lang) {
      case "English":
        return getEnglishReference(level);
      case "Japanese":
        return getJapaneseReference(level);
      default:
        return getGermanReference(level);
    }
  }
  function initCheatsheet() {
    const btn = document.createElement("button");
    btn.id = "cheatsheet-btn";
    btn.innerHTML = "\u{1F4D6}";
    btn.title = t("gram_cheatsheet") || "Grammar Cheatsheet";
    btn.style.cssText = `
        position:fixed;
        bottom:100px;
        right:20px;
        width:50px;
        height:50px;
        border-radius:50%;
        background:var(--accent, linear-gradient(135deg, #667eea, #764ba2));
        border:none;
        color:white;
        font-size:24px;
        cursor:pointer;
        box-shadow:0 4px 15px rgba(0, 0, 0, 0.3);
        z-index:1000;
        transition:transform 0.2s, box-shadow 0.2s;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.1)";
      btn.style.boxShadow = "0 6px 20px rgba(0,0,0,0.4)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 4px 15px rgba(0,0,0,0.3)";
    });
    btn.addEventListener("click", () => toggleCheatsheet());
    document.body.appendChild(btn);
    addCheatsheetStyles();
    console.log("[Cheatsheet] Module initialized");
  }
  function closeCheatsheet() {
    if (cheatsheetWindow) {
      cheatsheetWindow.remove();
      cheatsheetWindow = null;
    }
    document.removeEventListener("mousedown", handleOutsideClick);
  }
  function handleOutsideClick(e) {
    if (cheatsheetWindow && !cheatsheetWindow.contains(e.target)) {
      const target = e.target;
      const btn = document.getElementById("cheatsheet-btn");
      if (btn && btn.contains(target))
        return;
      if (target.closest("#sel-toolbar") || target.closest("#sel-analysis-panel") || target.closest("#sel-analysis-overlay")) {
        return;
      }
      closeCheatsheet();
    }
  }
  async function toggleCheatsheet(tabName) {
    if (cheatsheetWindow) {
      closeCheatsheet();
      return;
    }
    const savedSize = getSavedSize();
    const mode = localStorage.getItem("gemini_teacher_mode") || "standard";
    const wordsTabHtml = mode === "standard" ? `<button class="cheatsheet-tab" data-tab="words" data-i18n="gram_words">${t("gram_words")}</button>` : "";
    cheatsheetWindow = document.createElement("div");
    cheatsheetWindow.className = "cheatsheet-window";
    cheatsheetWindow.style.width = savedSize.width + "px";
    cheatsheetWindow.style.height = savedSize.height + "px";
    cheatsheetWindow.innerHTML = `
        <div class="cheatsheet-header">
            <span>\u{1F4D6} <span data-i18n="gram_cheatsheet">${t("gram_cheatsheet")}</span></span>
            <button class="cheatsheet-close" title="${t("gram_close") || "Close"}">\xD7</button>
        </div>
        <div class="cheatsheet-tabs">
            <button class="cheatsheet-tab active" data-tab="reference" data-i18n="gram_reference">${t("gram_reference")}</button>
            ${wordsTabHtml}
            <button class="cheatsheet-tab" data-tab="history" data-i18n="gram_history">${t("gram_history")}</button>
        </div>
        <div class="cheatsheet-content"></div>
        <div class="resize-handle resize-e" data-dir="e"></div>
        <div class="resize-handle resize-w" data-dir="w"></div>
        <div class="resize-handle resize-s" data-dir="s"></div>
        <div class="resize-handle resize-n" data-dir="n"></div>
        <div class="resize-handle resize-se" data-dir="se"></div>
        <div class="resize-handle resize-sw" data-dir="sw"></div>
        <div class="resize-handle resize-ne" data-dir="ne"></div>
        <div class="resize-handle resize-nw" data-dir="nw"></div>
    `;
    document.body.appendChild(cheatsheetWindow);
    setTimeout(() => document.addEventListener("mousedown", handleOutsideClick), 10);
    const header = cheatsheetWindow.querySelector(".cheatsheet-header");
    header.addEventListener("mousedown", startDrag);
    cheatsheetWindow.querySelector(".cheatsheet-close")?.addEventListener("click", closeCheatsheet);
    cheatsheetWindow.querySelectorAll(".cheatsheet-tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const tName = e.target.dataset.tab;
        if (tName)
          switchTab(tName);
      });
    });
    let defaultTab = localStorage.getItem("gemini_cheatsheet_tab") || "reference";
    if (defaultTab === "words" && mode !== "standard")
      defaultTab = "reference";
    if (typeof tabName === "string") {
      switchTab(tabName);
    } else {
      switchTab(defaultTab);
    }
    cheatsheetWindow.querySelectorAll(".resize-handle").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => startResize(e));
    });
  }
  function loadReferenceTab() {
    if (!cheatsheetWindow)
      return;
    const content = cheatsheetWindow.querySelector(".cheatsheet-content");
    const sections = getGrammarReference();
    const lang = localStorage.getItem("gemini_target_language") || "German";
    const level = localStorage.getItem("gemini_level") || "A1";
    content.innerHTML = `
                                                                <div class="ref-header">
                                                                    <span class="ref-lang"> ${lang} \u2014 ${level} </span>
                                                                        </div>
        ${sections.map((s, i) => `
            <details class="grammar-details" ${i < 2 ? "open" : ""}>
                <summary>${s.title}</summary>
                <div class="grammar-body">${s.content}</div>
            </details>
        `).join("")}
`;
  }
  function switchTab(tabName) {
    if (!cheatsheetWindow)
      return;
    cheatsheetWindow.querySelectorAll(".cheatsheet-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    localStorage.setItem("gemini_cheatsheet_tab", tabName);
    if (tabName === "reference")
      loadReferenceTab();
    else if (tabName === "words")
      loadWordsTab();
    else if (tabName === "history")
      loadHistoryTab();
  }
  function loadHistoryTab() {
    if (!cheatsheetWindow)
      return;
    const content = cheatsheetWindow.querySelector(".cheatsheet-content");
    const rawHist = localStorage.getItem("gemini_analysis_history");
    const historyList = rawHist ? JSON.parse(rawHist) : [];
    if (historyList.length === 0) {
      content.innerHTML = `<div class="cheatsheet-loading">${t("gram_history_empty") || 'History is empty. Select text and click "Grammar Analysis" or "Explain".'}</div>`;
      return;
    }
    content.innerHTML = `
        <div class="ref-header">
            <span class="ref-lang">${t("gram_history_title") || "Analysis History"}</span>
        </div>
        ${historyList.map((item) => `
            <details class="history-card">
                <summary>${item.title}:"${item.text.length > 25 ? item.text.substring(0, 25) + "..." : item.text}"</summary>
                <div class="history-body">${item.html}</div>
            </details>
        `).join("")}
    `;
  }
  async function loadWordsTab(forceRefresh = false) {
    if (!cheatsheetWindow)
      return;
    const content = cheatsheetWindow.querySelector(".cheatsheet-content");
    if (!forceRefresh && wordsData) {
      renderWordsList(content);
      return;
    }
    content.innerHTML = `<div class="cheatsheet-loading">${t("loading") || "Loading..."}</div>`;
    const level = localStorage.getItem("gemini_level") || "A1";
    try {
      const response = await fetch("/api/analyze-grammar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, simple: true })
      });
      if (!response.ok)
        throw new Error("API error");
      const data = await response.json();
      const lines = (data.analysis || "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("##"));
      const cleanedLines = lines.map((l) => l.replace(/^[-•*]\s*/, ""));
      wordsData = { words: cleanedLines, count: data.word_count || cleanedLines.length, level };
      renderWordsList(content);
    } catch {
      content.innerHTML = `<div class="cheatsheet-error">${t("gram_load_error") || "Loading error. Please try again."}</div>`;
    }
  }
  function renderWordsList(content) {
    if (!wordsData)
      return;
    const wordsHtml = wordsData.words.map((w) => `
        <div class="word-item" onclick = "window._speakWord && window._speakWord('${w.replace(/'/g, "\\'")}') ">
            <span class="word-text"> ${w} </span>
                <span class="word-speak" title = "\u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C">\u{1F50A}</span>
                    </div>
                        `).join("");
    content.innerHTML = `
                    <div class="cheatsheet-stats">
            \u{1F4CA} \u0418\u0437\u0443\u0447\u0435\u043D\u043E:<strong>${wordsData.count} </strong> \u0441\u043B\u043E\u0432 (${wordsData.level})
        </div>
        <input type = "text" class="word-search" placeholder = "\u{1F50D} \u041F\u043E\u0438\u0441\u043A..."/>
            <div class="words-list"> ${wordsHtml} </div>
                `;
    const searchInput = content.querySelector(".word-search");
    searchInput?.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase();
      content.querySelectorAll(".word-item").forEach((item) => {
        const text = item.textContent?.toLowerCase() || "";
        item.style.display = text.includes(query) ? "" : "none";
      });
    });
  }
  if (typeof window !== "undefined") {
    window._speakWord = (word) => {
      if (!word)
        return;
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(word.split(" \u2014 ")[0].split(" (")[0].trim());
      const lang = localStorage.getItem("gemini_target_language") || "German";
      const langMap = {
        "German": "de-DE",
        "English": "en-US",
        "French": "fr-FR",
        "Spanish": "es-ES",
        "Japanese": "ja-JP",
        "Korean": "ko-KR"
      };
      utt.lang = langMap[lang] || "de-DE";
      window.speechSynthesis.speak(utt);
    };
  }
  function startDrag(e) {
    if (!cheatsheetWindow)
      return;
    isDragging = true;
    dragOffset = {
      x: e.clientX - cheatsheetWindow.offsetLeft,
      y: e.clientY - cheatsheetWindow.offsetTop
    };
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", stopDrag);
  }
  function drag(e) {
    if (!isDragging || !cheatsheetWindow)
      return;
    cheatsheetWindow.style.left = e.clientX - dragOffset.x + "px";
    cheatsheetWindow.style.top = e.clientY - dragOffset.y + "px";
    cheatsheetWindow.style.right = "auto";
    cheatsheetWindow.style.bottom = "auto";
  }
  function stopDrag() {
    isDragging = false;
    document.removeEventListener("mousemove", drag);
    document.removeEventListener("mouseup", stopDrag);
  }
  function getSavedSize() {
    try {
      const saved = localStorage.getItem(SIZE_CACHE_KEY);
      if (saved)
        return JSON.parse(saved);
    } catch {
    }
    return DEFAULT_SIZE;
  }
  function saveSize() {
    if (!cheatsheetWindow)
      return;
    try {
      localStorage.setItem(SIZE_CACHE_KEY, JSON.stringify({
        width: cheatsheetWindow.offsetWidth,
        height: cheatsheetWindow.offsetHeight
      }));
    } catch {
    }
  }
  function startResize(e) {
    if (!cheatsheetWindow)
      return;
    e.preventDefault();
    e.stopPropagation();
    resizeDirection = e.target.dataset.dir || "";
    isResizing = true;
    resizeStart = {
      x: e.clientX,
      y: e.clientY,
      width: cheatsheetWindow.offsetWidth,
      height: cheatsheetWindow.offsetHeight
    };
    document.addEventListener("mousemove", resize);
    document.addEventListener("mouseup", stopResize);
  }
  function resize(e) {
    if (!isResizing || !cheatsheetWindow)
      return;
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const minW = 300, minH = 250;
    let newW = resizeStart.width, newH = resizeStart.height;
    if (resizeDirection.includes("e"))
      newW = Math.max(minW, resizeStart.width + dx);
    if (resizeDirection.includes("w")) {
      newW = Math.max(minW, resizeStart.width - dx);
      if (newW > minW) {
        cheatsheetWindow.style.left = cheatsheetWindow.offsetLeft + dx + "px";
        cheatsheetWindow.style.right = "auto";
      }
    }
    if (resizeDirection.includes("s"))
      newH = Math.max(minH, resizeStart.height + dy);
    if (resizeDirection.includes("n")) {
      newH = Math.max(minH, resizeStart.height - dy);
      if (newH > minH) {
        cheatsheetWindow.style.top = cheatsheetWindow.offsetTop + dy + "px";
        cheatsheetWindow.style.bottom = "auto";
      }
    }
    cheatsheetWindow.style.width = newW + "px";
    cheatsheetWindow.style.height = newH + "px";
  }
  function stopResize() {
    if (isResizing)
      saveSize();
    isResizing = false;
    resizeDirection = "";
    document.removeEventListener("mousemove", resize);
    document.removeEventListener("mouseup", stopResize);
  }
  function addCheatsheetStyles() {
    if (document.getElementById("cheatsheet-styles"))
      return;
    const style = document.createElement("style");
    style.id = "cheatsheet-styles";
    style.textContent = `
        .cheatsheet-window {
            position:fixed;
            top:100px;
            right:80px;
            width:460px;
            max-height:80vh;
            background:var(--bg2, #12121a);
            border:1px solid var(--border, #2a2a3a);
            border-radius:12px;
            box-shadow:0 10px 40px var(--shadow, rgba(0,0,0,0.5));
            z-index:1001;
            overflow:hidden;
            display:flex;
            flex-direction:column;
            color:var(--text, #f4f4f5);
        }
        .cheatsheet-header {
            display:flex;
            justify-content:space-between;
            align-items:center;
            padding:12px 16px;
            background:var(--bg3, #1a1a26);
            border-bottom:1px solid var(--border, #2a2a3a);
            color:var(--text, #f4f4f5);
            font-weight:bold;
            cursor:move;
            user-select:none;
        }
        .cheatsheet-header span { color:var(--accent, #6366f1); }
        .cheatsheet-close {
            background:none; border:none;
            color:var(--text3, #71717a);
            font-size:20px; cursor:pointer;
            padding:0 4px; line-height:1;
            transition:color 0.2s;
        }
        .cheatsheet-close:hover { color:var(--red, #ef4444); }
        .cheatsheet-controls { display:flex; gap:8px; }
        .cheatsheet-controls button {
            background:var(--bg4, #242434);
            border:1px solid var(--border, #2a2a3a);
            color:var(--text2, #a1a1aa);
            width:28px; height:28px; border-radius:50%;
            cursor:pointer; font-size:14px;
            transition:background 0.2s, transform 0.2s;
        }
        .cheatsheet-controls button:hover {
            background:var(--accent, #6366f1);
            color:white;
            transform:scale(1.1);
        }
        .cheatsheet-tabs {
            display:flex;
            background:var(--bg1, #0a0a0f);
            padding:8px; gap:6px;
        }
        .cheatsheet-tab {
            flex:1; padding:7px 10px;
            background:transparent;
            border:1px solid transparent;
            color:var(--text3, #71717a);
            font-size:12px;
            border-radius:6px; cursor:pointer;
            transition:all 0.2s;
            white-space:nowrap;
        }
        .cheatsheet-tab:hover {
            background:var(--bg3, #1a1a26);
            color:var(--text, #f4f4f5);
        }
        .cheatsheet-tab.active {
            background:var(--accent, #6366f1);
            color:white;
            border-color:var(--accent, #6366f1);
        }
        .cheatsheet-content {
            padding:14px; overflow-y:auto; flex:1;
            color:var(--text, #f4f4f5);
            font-size:13px; line-height:1.5;
        }

        /* Reference tab */
        .ref-header {
            display:flex; justify-content:space-between; align-items:center;
            margin-bottom:12px;
        }
        .ref-lang {
            font-size:14px; font-weight:bold;
            color:var(--accent, #6366f1);
        }
        .grammar-details {
            margin-bottom:6px;
            border:1px solid var(--border, #2a2a3a);
            border-radius:8px;
            overflow:hidden;
        }
        .grammar-details summary {
            padding:10px 14px;
            background:var(--bg3, #1a1a26);
            font-size:13px; font-weight:600;
            cursor:pointer; user-select:none;
            list-style:none;
            color:var(--text, #f4f4f5);
        }
        .grammar-details summary::before {
            content:'\u25B8 '; color:var(--accent, #6366f1);
        }
        .grammar-details[open] summary::before {
            content:'\u25BE ';
        }
        .grammar-details summary:hover {
            background:var(--bg4, #242434);
        }
        .grammar-body {
            padding:10px 14px;
            background:var(--bg2, #12121a);
        }

        /* History cards */
        .history-card {
            margin-bottom:10px;
            background:var(--bg3, #1a1a26);
            border-radius:10px;
            border:1px solid var(--border, #2a2a3a);
            overflow:hidden;
            transition: border-color 0.2s;
        }
        .history-card:hover { border-color:var(--accent, #6366f1); }
        .history-card summary {
            padding:12px 14px;
            font-size:14px; font-weight:600; color:var(--text, #f4f4f5);
            cursor:pointer; user-select:none; list-style:none;
        }
        .history-card summary::before {
            content:'\u25B8 '; color:var(--accent, #6366f1); margin-right:6px; font-size:16px;
        }
        .history-card[open] summary::before { content:'\u25BE '; }
        .history-card[open] summary {
            background:var(--bg4, #242434);
            border-bottom:1px solid var(--border, #2a2a3a);
        }
        .history-body {
            padding:16px; color:var(--text, #f4f4f5);
            font-size:14px; line-height:1.6;
        }
        .history-body h3 { color:var(--accent, #6366f1); font-size:16px; margin:14px 0 6px; }
        .history-body h4 { color:var(--accent-hover, #818cf8); font-size:14px; margin:10px 0 4px; }
        .history-body b, .history-body strong { color:var(--accent, #6366f1); }
        .history-body code {
            background:var(--bg4, #242434);
            padding:2px 6px; border-radius:4px; font-size:13px;
            color:var(--cyan, #06b6d4);
        }

        /* Grammar tables */
        .grammar-table {
            width:100%;
            border-collapse:collapse;
            font-size:12px;
            margin:4px 0;
        }
        .grammar-table th, .grammar-table td {
            padding:5px 8px;
            border:1px solid var(--border, #2a2a3a);
            text-align:center;
        }
        .grammar-table th {
            background:var(--bg4, #242434);
            color:var(--accent, #6366f1);
            font-weight:600;
        }
        .grammar-table td b { color:var(--accent, #6366f1); }
        .grammar-table.compact td { padding:3px 5px; font-size:11px; }

        /* Grammar cards */
        .grammar-card {
            padding:8px 10px;
            margin:4px 0;
            background:var(--bg3, #1a1a26);
            border-radius:6px;
            border-left:3px solid var(--accent, #6366f1);
            font-size:12px;
        }
        .grammar-card b { color:var(--accent-hover, #818cf8); }
        .grammar-card i { color:var(--text3, #71717a); }
        .grammar-card small { color:var(--text3, #71717a); }

        /* Words tab */
        .word-search {
            width:100%; padding:8px 12px;
            background:var(--bg3, #1a1a26);
            border:1px solid var(--border, #2a2a3a);
            border-radius:8px; color:var(--text, #f4f4f5);
            font-size:13px; margin-bottom:10px;
            outline:none;
        }
        .word-search:focus { border-color:var(--accent, #6366f1); }
        .words-list { max-height:350px; overflow-y:auto; }
        .word-item {
            display:flex; justify-content:space-between; align-items:center;
            padding:7px 10px;
            border-bottom:1px solid var(--border, #2a2a3a);
            cursor:pointer; font-size:13px; transition:background 0.15s;
        }
        .word-item:hover { background:var(--bg4, #242434); }
        .word-speak { font-size:14px; opacity:0.4; transition:opacity 0.2s; }
        .word-item:hover .word-speak { opacity:1; }

        .cheatsheet-stats {
            background:var(--bg3, #1a1a26);
            border:1px solid var(--border, #2a2a3a);
            padding:10px 12px; border-radius:8px; margin-bottom:10px;
            color:var(--text, #f4f4f5);
        }

        /* Analysis tab */
        .analysis-placeholder { text-align:center; padding:40px 20px; color:var(--text3, #71717a); }
        .analysis-header {
            display:flex; justify-content:space-between; align-items:center;
            padding:8px 12px;
            background:var(--bg3, #1a1a26);
            border:1px solid var(--border, #2a2a3a);
            border-radius:8px; margin-bottom:12px;
        }
        .analysis-header small { color:var(--text3, #71717a); font-size:11px; }
        .btn-request-analysis {
            margin-top:16px; padding:12px 24px;
            background:var(--accent, #6366f1);
            border:none; color:white; border-radius:8px;
            cursor:pointer; font-size:14px;
            transition:transform 0.2s, box-shadow 0.2s;
        }
        .btn-request-analysis:hover {
            transform:scale(1.05);
            background:var(--accent-hover, #818cf8);
            box-shadow:0 4px 15px var(--shadow, rgba(0,0,0,0.4));
        }
        .cheatsheet-loading { text-align:center; padding:40px; color:var(--text3, #71717a); }
        .cheatsheet-error { text-align:center; padding:40px; color:var(--red, #ef4444); }
        .cheatsheet-content h2 { color:var(--accent, #6366f1); font-size:18px; margin:16px 0 8px; }
        .cheatsheet-content h3 { color:var(--accent, #6366f1); font-size:16px; margin:14px 0 6px; }
        .cheatsheet-content h4 { color:var(--accent-hover, #818cf8); font-size:14px; margin:12px 0 4px; }

        /* Resize handles */
        .resize-handle { position:absolute; background:transparent; }
        .resize-e { right:0; top:10%; height:80%; width:6px; cursor:e-resize; }
        .resize-w { left:0; top:10%; height:80%; width:6px; cursor:w-resize; }
        .resize-s { bottom:0; left:10%; width:80%; height:6px; cursor:s-resize; }
        .resize-n { top:0; left:10%; width:80%; height:6px; cursor:n-resize; }
        .resize-se { right:0; bottom:0; width:12px; height:12px; cursor:se-resize; }
        .resize-sw { left:0; bottom:0; width:12px; height:12px; cursor:sw-resize; }
        .resize-ne { right:0; top:0; width:12px; height:12px; cursor:ne-resize; }
        .resize-nw { left:0; top:0; width:12px; height:12px; cursor:nw-resize; }
        .resize-handle:hover { background:var(--bg4, #242434); }

        /* ====== MOBILE RESPONSIVE ====== */
        @media screen and (max-width: 600px) {
            .cheatsheet-window {
                position:fixed !important;
                top:0 !important;
                left:0 !important;
                right:0 !important;
                bottom:0 !important;
                width:100% !important;
                height:100% !important;
                max-height:100vh !important;
                border-radius:0;
                z-index:2000;
            }
            .cheatsheet-header {
                padding:14px 16px;
                font-size:15px;
            }
            .cheatsheet-controls button {
                width:34px;
                height:34px;
                font-size:16px;
            }
            .cheatsheet-tabs {
                padding:6px;
                gap:4px;
            }
            .cheatsheet-tab {
                padding:10px 8px;
                font-size:13px;
            }
            .cheatsheet-content {
                padding:12px;
                font-size:14px;
            }
            .grammar-table {
                font-size:11px;
            }
            .grammar-table th, .grammar-table td {
                padding:4px 5px;
            }
            .grammar-card {
                font-size:13px;
                padding:10px 12px;
            }
            .word-item {
                padding:10px 12px;
                font-size:14px;
            }
            .word-search {
                padding:10px 14px;
                font-size:14px;
            }
            .resize-handle { display:none !important; }
        }

        /* Tablet */
        @media screen and (max-width: 900px) and (min-width: 601px) {
            .cheatsheet-window {
                width:90vw !important;
                max-width:450px;
                right:5vw !important;
            }
        }
    `;
    document.head.appendChild(style);
  }
  if (typeof window !== "undefined") {
    window.initCheatsheet = initCheatsheet;
    window.toggleCheatsheet = toggleCheatsheet;
  }

  // src/main.ts
  init_language_picker();

  // src/modules/ui/tooltips.ts
  var TOOLTIPS = [
    { target: ".settings-group:has(#api-key)", key: "tip_apikey" },
    { target: ".settings-group:has(#voice-select)", key: "tip_voice" },
    { target: ".settings-group:has(#speech-rate)", key: "tip_speed" },
    { target: ".language-row", key: "tip_langs" },
    { target: ".settings-group:has(#language-level)", key: "tip_level" },
    { target: ".teacher-mode-group", key: "tip_trainer" },
    { target: ".settings-group:has(#theme-select)", key: "tip_theme" }
  ];
  var activePopup = null;
  function closeActivePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  }
  function showTooltipPopup(btn, key) {
    closeActivePopup();
    const text = t(key);
    const popup = document.createElement("div");
    popup.className = "tooltip-popup";
    popup.innerHTML = text.replace(/\\n/g, "<br>");
    document.body.appendChild(popup);
    activePopup = popup;
    const rect = btn.getBoundingClientRect();
    const popupW = 250;
    let left = rect.left - popupW - 10;
    if (left < 10)
      left = rect.right + 10;
    let top = rect.top - 10;
    if (top + 180 > window.innerHeight)
      top = window.innerHeight - 190;
    if (top < 10)
      top = 10;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.width = `${popupW}px`;
    setTimeout(() => {
      const handler = (e) => {
        if (!popup.contains(e.target) && e.target !== btn) {
          closeActivePopup();
          document.removeEventListener("click", handler);
        }
      };
      document.addEventListener("click", handler);
    }, 50);
  }
  function initTooltips() {
    for (const cfg of TOOLTIPS) {
      const target = document.querySelector(cfg.target);
      if (!target)
        continue;
      const btn = document.createElement("button");
      btn.className = "tooltip-hint-btn";
      btn.textContent = "?";
      btn.type = "button";
      btn.title = "?";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        showTooltipPopup(btn, cfg.key);
      });
      const label = target.querySelector("label");
      if (label) {
        label.appendChild(btn);
      } else {
        target.prepend(btn);
      }
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape")
        closeActivePopup();
    });
  }

  // src/modules/ui/tutorial.ts
  var TUTORIAL_STEPS = [
    {
      target: ".logo",
      title: "\u{1F44B} \u041F\u0440\u0438\u0432\u0456\u0442! \u0426\u0435 Gemini Live",
      text: "AI-\u0432\u0447\u0438\u0442\u0435\u043B\u044C \u043C\u043E\u0432 \u0447\u0435\u0440\u0435\u0437 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0438\u0439 \u0434\u0456\u0430\u043B\u043E\u0433. \u0414\u0430\u0432\u0430\u0439 \u0440\u043E\u0437\u0431\u0435\u0440\u0435\u043C\u043E\u0441\u044F, \u044F\u043A \u0442\u0443\u0442 \u0432\u0441\u0435 \u0432\u043B\u0430\u0448\u0442\u043E\u0432\u0430\u043D\u043E!",
      position: "bottom"
    },
    {
      target: ".settings-group:has(#api-key)",
      title: "\u{1F511} \u041A\u0440\u043E\u043A 1: API \u041A\u043B\u044E\u0447",
      text: '\u0421\u043F\u043E\u0447\u0430\u0442\u043A\u0443 \u043F\u043E\u0442\u0440\u0456\u0431\u0435\u043D API \u043A\u043B\u044E\u0447 \u0432\u0456\u0434 Google. \u041D\u0430\u0442\u0438\u0441\u043D\u0438 "Get key \u2192", \u0437\u0430\u0440\u0435\u0454\u0441\u0442\u0440\u0443\u0439\u0441\u044F \u0442\u0430 \u0441\u043A\u043E\u043F\u0456\u044E\u0439 \u043A\u043B\u044E\u0447 \u0441\u044E\u0434\u0438. \u0426\u0435 \u0431\u0435\u0437\u043A\u043E\u0448\u0442\u043E\u0432\u043D\u043E!',
      position: "left"
    },
    {
      target: ".language-row",
      title: "\u{1F30D} \u041A\u0440\u043E\u043A 2: \u041E\u0431\u0435\u0440\u0438 \u043C\u043E\u0432\u0438",
      text: "\u0417\u043B\u0456\u0432\u0430 \u2014 \u043C\u043E\u0432\u0430, \u044F\u043A\u0443 \u0442\u0438 \u0412\u0418\u0412\u0427\u0410\u0404\u0428 (\u043D\u0430\u043F\u0440. Deutsch). \u0421\u043F\u0440\u0430\u0432\u0430 \u2014 \u0422\u0412\u041E\u042F \u0440\u0456\u0434\u043D\u0430 \u043C\u043E\u0432\u0430 \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u043A\u043B\u0430\u0434\u0456\u0432 (\u043D\u0430\u043F\u0440. \u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430).",
      position: "left"
    },
    {
      target: ".settings-group:has(#language-level)",
      title: "\u{1F4CA} \u041A\u0440\u043E\u043A 3: \u0422\u0432\u0456\u0439 \u0440\u0456\u0432\u0435\u043D\u044C",
      text: "\u041E\u0431\u0435\u0440\u0438 \u0441\u0432\u0456\u0439 \u0440\u0456\u0432\u0435\u043D\u044C:\n\u2022 A1 \u2014 \u0437 \u043D\u0443\u043B\u044F\n\u2022 A2 \u2014 \u0431\u0430\u0437\u043E\u0432\u0438\u0439\n\u2022 B1 \u2014 \u0441\u0435\u0440\u0435\u0434\u043D\u0456\u0439\n\u2022 B2 \u2014 \u0432\u0438\u0449\u0438\u0439 \u0437\u0430 \u0441\u0435\u0440\u0435\u0434\u043D\u0456\u0439\n\u2022 C1/C2 \u2014 \u043F\u0440\u043E\u0441\u0443\u043D\u0443\u0442\u0438\u0439",
      position: "left"
    },
    {
      target: ".teacher-mode-group",
      title: "\u{1F393} \u041A\u0440\u043E\u043A 4: \u0420\u0435\u0436\u0438\u043C \u043D\u0430\u0432\u0447\u0430\u043D\u043D\u044F",
      text: '\u{1F4D6} \u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442 \u2014 \u0441\u043B\u043E\u0432\u0430 \u0437 \u043F\u0456\u0434\u043A\u0430\u0437\u043A\u0430\u043C\u0438\n\u{1F680} \u0410\u043A\u0442\u0438\u0432\u043D\u0438\u0439 \u2014 \u0456\u043D\u0442\u0435\u043D\u0441\u0438\u0432\u043D\u0430 \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0430\n\u{1F4DA} \u0413\u0440\u0430\u043C\u0430\u0442\u0438\u043A\u0430 \u2014 \u0433\u0440\u0430\u043C\u0430\u0442\u0438\u0447\u043D\u0456 \u0442\u0435\u043C\u0438\n\u{1F4AC} \u0420\u043E\u0437\u043C\u043E\u0432\u0430 \u2014 \u0432\u0456\u043B\u044C\u043D\u0435 \u0441\u043F\u0456\u043B\u043A\u0443\u0432\u0430\u043D\u043D\u044F\n\n\u041E\u0431\u0435\u0440\u0438 "\u0421\u0442\u0430\u043D\u0434\u0430\u0440\u0442" \u044F\u043A\u0449\u043E \u0442\u0438 \u043F\u043E\u0447\u0430\u0442\u043A\u0456\u0432\u0435\u0446\u044C!',
      position: "left"
    },
    {
      target: ".settings-group:has(#voice-select)",
      title: "\u{1F399}\uFE0F \u041A\u0440\u043E\u043A 5: \u0413\u043E\u043B\u043E\u0441 \u0443\u0447\u0438\u0442\u0435\u043B\u044F",
      text: "\u041E\u0431\u0435\u0440\u0438 \u0433\u043E\u043B\u043E\u0441 AI-\u0432\u0447\u0438\u0442\u0435\u043B\u044F \u2014 \u0447\u043E\u043B\u043E\u0432\u0456\u0447\u0438\u0439 \u0430\u0431\u043E \u0436\u0456\u043D\u043E\u0447\u0438\u0439. Gacrux (Female) \u0437\u0432\u0443\u0447\u0438\u0442\u044C \u043D\u0430\u0439\u043F\u0440\u0438\u0440\u043E\u0434\u043D\u0456\u0448\u0435!",
      position: "left"
    },
    {
      target: ".settings-group:has(#speech-rate)",
      title: "\u{1F39A}\uFE0F \u041A\u0440\u043E\u043A 6: \u0428\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C \u043C\u043E\u0432\u043B\u0435\u043D\u043D\u044F",
      text: "1.0 = \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u0430 \u0448\u0432\u0438\u0434\u043A\u0456\u0441\u0442\u044C.\n\u0417\u043C\u0435\u043D\u0448 \u0434\u043E 0.7 \u044F\u043A\u0449\u043E \u043F\u043E\u0433\u0430\u043D\u043E \u0440\u043E\u0437\u0443\u043C\u0456\u0454\u0448.\n\u0417\u0431\u0456\u043B\u044C\u0448 \u0434\u043E 1.5 \u0434\u043B\u044F \u0442\u0440\u0435\u043D\u0443\u0432\u0430\u043D\u043D\u044F \u0441\u043B\u0443\u0445\u0443.",
      position: "left"
    },
    {
      target: "#mode-buttons",
      title: "\u{1F3A4} \u041A\u0440\u043E\u043A 7: \u041F\u043E\u0447\u043D\u0438 \u0440\u043E\u0437\u043C\u043E\u0432\u0443!",
      text: "\u{1F3A4} Voice \u2014 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u0438\u0439 \u0434\u0456\u0430\u043B\u043E\u0433 (\u043E\u0441\u043D\u043E\u0432\u043D\u0438\u0439 \u0440\u0435\u0436\u0438\u043C)\n\u{1F5A5}\uFE0F Screen \u2014 \u0431\u043E\u0442 \u0431\u0430\u0447\u0438\u0442\u044C \u0442\u0432\u0456\u0439 \u0435\u043A\u0440\u0430\u043D\n\u{1F4F7} Camera \u2014 \u0431\u043E\u0442 \u0431\u0430\u0447\u0438\u0442\u044C \u043A\u0430\u043C\u0435\u0440\u0443\n\n\u041D\u0430\u0442\u0438\u0441\u043D\u0438 Voice \u0449\u043E\u0431 \u043F\u043E\u0447\u0430\u0442\u0438 \u0440\u043E\u0437\u043C\u043E\u0432\u0443 \u0437 AI-\u0432\u0447\u0438\u0442\u0435\u043B\u0435\u043C!",
      position: "top"
    },
    {
      target: ".floating-widget",
      title: "\u{1F39B}\uFE0F \u041A\u0440\u043E\u043A 8: \u041F\u0430\u043D\u0435\u043B\u044C \u043A\u0435\u0440\u0443\u0432\u0430\u043D\u043D\u044F",
      text: "\u{1F50A} \u041F\u043E\u0432\u0437\u0443\u043D\u043E\u043A \u0433\u0443\u0447\u043D\u043E\u0441\u0442\u0456 \u0431\u043E\u0442\u0430\n\u{1F399}\uFE0F \u0423\u0432\u0456\u043C\u043A\u043D\u0443\u0442\u0438/\u0432\u0438\u043C\u043A\u043D\u0443\u0442\u0438 \u043C\u0456\u043A\u0440\u043E\u0444\u043E\u043D\n\u{1F4DC} \u0421\u043B\u0456\u0434\u0443\u0432\u0430\u0442\u0438 \u0437\u0430 \u043F\u0456\u0434\u0441\u0432\u0456\u0442\u043A\u043E\u044E\n\n\u041C\u043E\u0436\u043D\u0430 \u043F\u0435\u0440\u0435\u0442\u044F\u0433\u0443\u0432\u0430\u0442\u0438 \u0446\u044E \u043F\u0430\u043D\u0435\u043B\u044C!",
      position: "top"
    },
    {
      target: ".progress-section",
      title: "\u{1F4C8} \u041A\u0440\u043E\u043A 9: \u041F\u0440\u043E\u0433\u0440\u0435\u0441",
      text: '\u0422\u0443\u0442 \u0432\u0438\u0434\u043D\u043E \u0441\u043A\u0456\u043B\u044C\u043A\u0438 \u0441\u043B\u0456\u0432 \u0442\u0438 \u0432\u0438\u0432\u0447\u0438\u0432. \u041D\u0430\u0442\u0438\u0441\u043D\u0438 "\u0423\u043F\u0440\u0430\u0432\u043B\u0456\u043D\u043D\u044F" \u0449\u043E\u0431 \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u043F\u0440\u043E\u0433\u0440\u0435\u0441 \u0442\u0430 \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0438\u0442\u0438 \u043F\u0456\u0437\u043D\u0456\u0448\u0435.',
      position: "left"
    },
    {
      target: ".chat-section",
      title: "\u{1F389} \u0413\u043E\u0442\u043E\u0432\u043E!",
      text: "\u0422\u0435\u043F\u0435\u0440 \u0442\u0438 \u0437\u043D\u0430\u0454\u0448 \u0432\u0441\u0435! \u041D\u0430\u0442\u0438\u0441\u043D\u0438 Voice \u0456 \u043F\u043E\u0447\u043D\u0438 \u0432\u0447\u0438\u0442\u0438 \u043C\u043E\u0432\u0443 \u0437 AI.\n\n\u{1F4A1} \u042F\u043A\u0449\u043E \u0449\u043E\u0441\u044C \u043D\u0435\u0437\u0440\u043E\u0437\u0443\u043C\u0456\u043B\u043E \u2014 \u043D\u0430\u0442\u0438\u0441\u043D\u0438 \u2753 \u0431\u0456\u043B\u044F \u0431\u0443\u0434\u044C-\u044F\u043A\u043E\u0433\u043E \u043D\u0430\u043B\u0430\u0448\u0442\u0443\u0432\u0430\u043D\u043D\u044F.",
      position: "center"
    }
  ];
  var activeSteps = TUTORIAL_STEPS;
  var currentStep = 0;
  var overlay = null;
  function clearOverlayContent() {
    if (!overlay)
      return;
    overlay.innerHTML = "";
  }
  function showStep(stepIndex) {
    if (!overlay)
      return;
    if (stepIndex >= activeSteps.length) {
      closeTutorial();
      return;
    }
    currentStep = stepIndex;
    const step = activeSteps[stepIndex];
    const target = document.querySelector(step.target);
    const isMobile = window.innerWidth <= 600;
    if (isMobile && target) {
      const inRightSidebar = target.closest(".sidebar-right");
      const inLeftSidebar = target.closest(".sidebar-left");
      if (inRightSidebar && window.openMobileSidebar) {
        const sidebar = document.getElementById("sidebar-right");
        if (sidebar && !sidebar.classList.contains("mobile-open")) {
          window.openMobileSidebar("right");
        }
      } else if (inLeftSidebar && window.openMobileSidebar) {
        const sidebar = document.getElementById("sidebar-left");
        if (sidebar && !sidebar.classList.contains("mobile-open")) {
          window.openMobileSidebar("left");
        }
      }
    }
    const delay = isMobile && target?.closest(".sidebar-left, .sidebar-right") ? 350 : 0;
    setTimeout(() => {
      if (!overlay)
        return;
      clearOverlayContent();
      const spotlight = document.createElement("div");
      spotlight.className = "tutorial-spotlight";
      if (target && step.position !== "center") {
        const rect = target.getBoundingClientRect();
        const pad = 8;
        spotlight.style.left = `${rect.left - pad}px`;
        spotlight.style.top = `${rect.top - pad}px`;
        spotlight.style.width = `${rect.width + pad * 2}px`;
        spotlight.style.height = `${rect.height + pad * 2}px`;
        target.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        spotlight.style.display = "none";
      }
      overlay.appendChild(spotlight);
      const isLast = stepIndex === activeSteps.length - 1;
      const tooltip = document.createElement("div");
      tooltip.className = "tutorial-tooltip";
      tooltip.innerHTML = `
            <div class="tutorial-step-counter">${stepIndex + 1} / ${activeSteps.length}</div>
            <h3 class="tutorial-title">${step.title}</h3>
            <p class="tutorial-text">${step.text.replace(/\n/g, "<br>")}</p>
            <div class="tutorial-buttons">
                <button class="tutorial-btn tutorial-skip">\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u0438</button>
                <button class="tutorial-btn tutorial-next">${isLast ? "\u2705 \u0413\u043E\u0442\u043E\u0432\u043E" : "\u0414\u0430\u043B\u0456 \u2192"}</button>
            </div>
        `;
      overlay.appendChild(tooltip);
      const pos = step.position || "bottom";
      if (target && pos !== "center") {
        const rect = target.getBoundingClientRect();
        requestAnimationFrame(() => {
          const tRect = tooltip.getBoundingClientRect();
          const tW = tRect.width || 320;
          const tH = tRect.height || 200;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          let left = 0;
          let top = 0;
          if (isMobile) {
            left = Math.max(10, Math.min(vw - tW - 10, (vw - tW) / 2));
            top = Math.min(vh - tH - 10, rect.bottom + 15);
            if (top < 10)
              top = 10;
          } else {
            switch (pos) {
              case "left": {
                left = rect.left - tW - 20;
                if (left < 10)
                  left = rect.right + 20;
                top = Math.max(10, rect.top);
                break;
              }
              case "right": {
                left = rect.right + 20;
                if (left + tW > vw)
                  left = rect.left - tW - 20;
                top = Math.max(10, rect.top);
                break;
              }
              case "top":
                left = Math.max(10, rect.left);
                top = rect.top - tH - 15;
                break;
              case "bottom":
              default:
                left = Math.max(10, rect.left);
                top = rect.bottom + 15;
                break;
            }
          }
          left = Math.max(10, Math.min(left, vw - tW - 10));
          top = Math.max(10, Math.min(top, vh - tH - 10));
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
        });
      } else {
        tooltip.style.left = "50%";
        tooltip.style.top = "50%";
        tooltip.style.transform = "translate(-50%, -50%)";
      }
      tooltip.querySelector(".tutorial-next")?.addEventListener("click", () => showStep(currentStep + 1));
      tooltip.querySelector(".tutorial-skip")?.addEventListener("click", closeTutorial);
    }, delay);
  }
  function closeTutorial() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.body.classList.remove("tutorial-active");
    localStorage.setItem("tutorial_completed", "true");
  }
  function startTutorial(customSteps = TUTORIAL_STEPS) {
    activeSteps = customSteps;
    currentStep = 0;
    document.getElementById("tutorial-overlay")?.remove();
    overlay = document.createElement("div");
    overlay.className = "tutorial-overlay";
    overlay.id = "tutorial-overlay";
    document.body.appendChild(overlay);
    document.body.classList.add("tutorial-active");
    showStep(0);
  }
  function initTutorial() {
    const completed = localStorage.getItem("tutorial_completed");
    const logo = document.querySelector(".sidebar-right .logo");
    if (logo) {
      const btn = document.createElement("button");
      btn.className = "tutorial-icon-btn";
      btn.innerHTML = "\u{1F393} \u0422\u0443\u0442\u043E\u0440\u0456\u0430\u043B";
      btn.title = "\u041F\u0440\u043E\u0439\u0442\u0438 \u043D\u0430\u0432\u0447\u0430\u043B\u044C\u043D\u0438\u0439 \u0442\u0443\u0442\u043E\u0440\u0456\u0430\u043B";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        btn.classList.remove("glow");
        startTutorial();
      });
      logo.appendChild(btn);
      if (!completed) {
        setTimeout(() => {
          btn.classList.add("glow");
        }, 5e3);
      }
    }
  }
  var MOBILE_HINTS = [
    { icon: "\u{1F50A}", text: "\u0412\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u2192 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041E\u0437\u0432\u0443\u0447\u0438\u0442\u044C\xBB" },
    { icon: "\u25C0", text: "\u041F\u043E\u0442\u044F\u043D\u0438\u0442\u0435 \u0441\u0442\u0440\u0435\u043B\u043A\u0443 \u0434\u043B\u044F \u043F\u0430\u043D\u0435\u043B\u0438 \u0447\u0430\u0442\u043E\u0432" },
    { icon: "\u25B6", text: "\u041F\u043E\u0442\u044F\u043D\u0438\u0442\u0435 \u0441\u0442\u0440\u0435\u043B\u043A\u0443 \u0434\u043B\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A" },
    { icon: "\u{1F4D6}", text: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u{1F4D6} \u2014 \u0448\u043F\u0430\u0440\u0433\u0430\u043B\u043A\u0430 \u0433\u0440\u0430\u043C\u043C\u0430\u0442\u0438\u043A\u0438" },
    { icon: "\u{1F3A4}", text: "Voice \u2014 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0439 \u0443\u0440\u043E\u043A \u0441 AI" },
    { icon: "\u{1F4CA}", text: "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" },
    { icon: "\u{1F39A}\uFE0F", text: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0440\u0435\u0447\u0438: \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u0442\u0435 \u0432 \u25B6 \u043F\u0430\u043D\u0435\u043B\u0438" }
  ];
  var hintIndex = 0;
  var hintTimer = null;
  function showMobileHint() {
    if (localStorage.getItem("mobile_hints_dismissed") === "true")
      return;
    if (window.innerWidth > 600)
      return;
    if (document.body.classList.contains("tutorial-active"))
      return;
    const hint = MOBILE_HINTS[hintIndex % MOBILE_HINTS.length];
    hintIndex++;
    const toast = document.createElement("div");
    toast.className = "mobile-hint-toast";
    toast.innerHTML = `
        <span class="mobile-hint-icon">${hint.icon}</span>
        <span class="mobile-hint-text">${hint.text}</span>
        <button class="mobile-hint-close" title="\u0411\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C">\u2715</button>
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add("show");
    });
    toast.querySelector(".mobile-hint-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
      localStorage.setItem("mobile_hints_dismissed", "true");
      if (hintTimer)
        clearInterval(hintTimer);
    });
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 5e3);
  }
  function initMobileHints() {
    if (window.innerWidth > 600)
      return;
    if (localStorage.getItem("mobile_hints_dismissed") === "true")
      return;
    const style = document.createElement("style");
    style.textContent = `
        .mobile-hint-toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: rgba(30, 30, 50, 0.95);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(102, 126, 234, 0.3);
            border-radius: 12px;
            padding: 10px 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 9000;
            opacity: 0;
            transition: opacity 0.3s ease, transform 0.3s ease;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            max-width: calc(100vw - 32px);
            pointer-events: auto;
        }
        .mobile-hint-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .mobile-hint-icon {
            font-size: 20px;
            flex-shrink: 0;
        }
        .mobile-hint-text {
            color: #e0e0f0;
            font-size: 13px;
            line-height: 1.3;
            flex: 1;
        }
        .mobile-hint-close {
            background: none;
            border: none;
            color: rgba(255,255,255,0.4);
            font-size: 14px;
            cursor: pointer;
            padding: 4px;
            flex-shrink: 0;
        }
        .mobile-hint-close:active {
            color: #fff;
        }
    `;
    document.head.appendChild(style);
    setTimeout(() => {
      showMobileHint();
      hintTimer = setInterval(showMobileHint, 12e4);
    }, 3e4);
  }

  // src/main.ts
  init_orchestrator();
  function initApp() {
    console.log("[App] Initializing TypeScript application...");
    initElements();
    const elements2 = getElements();
    Settings.load();
    const savedLevel = localStorage.getItem("gemini_level");
    const savedLang = LanguagePicker.getTargetLanguage();
    const syncPayload = {};
    if (savedLevel)
      syncPayload.level = savedLevel;
    if (savedLang)
      syncPayload.target_language = savedLang;
    if (Object.keys(syncPayload).length > 0) {
      fetch("/api/profile?user_id=default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncPayload)
      }).then(() => {
        console.log("[Startup] DB sync: level=", savedLevel, "lang=", savedLang);
      }).catch((err) => console.error("[Startup] DB sync failed:", err));
    }
    Chat.initListeners();
    Chat.initScrollListener();
    setupEventHandlers(elements2);
    Vocabulary.refreshProgress();
    Vocabulary.loadLearnedWords();
    initChatSessions();
    initCheatsheet();
    LanguagePicker.setup();
    LanguagePicker.setupNative();
    initI18n();
    initTooltips();
    initTutorial();
    initMobileHints();
    const deliveryHint = document.getElementById("delivery-mode-hint");
    function getDeliveryMode() {
      return document.querySelector('input[name="delivery-mode"]:checked')?.value || "interactive";
    }
    window.getDeliveryMode = getDeliveryMode;
    function updateDeliveryHint() {
      if (!deliveryHint)
        return;
      const mode = getDeliveryMode();
      switch (mode) {
        case "interactive":
          deliveryHint.textContent = "\u0418\u043D\u0442\u0435\u0440\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0439 \u0434\u0438\u0430\u043B\u043E\u0433";
          break;
        case "fast_text":
          deliveryHint.textContent = "1 \u0433\u043E\u043B\u043E\u0441\u043E\u043C + 9 \u0442\u0435\u043A\u0441\u0442\u043E\u043C";
          break;
        case "auto_10":
          deliveryHint.textContent = "\u0412\u0441\u0435 10 \u0433\u043E\u043B\u043E\u0441\u043E\u043C \u043F\u043E\u0434\u0440\u044F\u0434";
          break;
      }
    }
    const savedDelivery = localStorage.getItem("delivery_mode");
    if (savedDelivery) {
      const radio = document.querySelector(`input[name="delivery-mode"][value="${savedDelivery}"]`);
      if (radio)
        radio.checked = true;
    }
    updateDeliveryHint();
    document.querySelectorAll('input[name="delivery-mode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        localStorage.setItem("delivery_mode", getDeliveryMode());
        updateDeliveryHint();
      });
    });
    console.log("[App] TypeScript modules initialized");
    Promise.resolve().then(() => (init_enrichment(), enrichment_exports)).then((m) => {
      window.enrichDialogueBlocks = m.enrichDialogueBlocks;
      console.log("[App] Enrichment observer attached to window");
    });
    window.revealQuizAnswer = (element) => {
      if (element.classList.contains("answered"))
        return;
      const questionText = element.textContent?.replace("\u{1F446} \u043D\u0430\u0436\u043C\u0438", "").trim() || "";
      element.classList.add("answered");
      const hint = element.querySelector(".quiz-reveal-hint");
      if (hint)
        hint.remove();
      const textInput = document.getElementById("text-input");
      if (textInput) {
        textInput.value = questionText;
        Chat.sendTextMessage();
      }
    };
    window.openMobileSidebar = (side) => {
      const sidebar = document.getElementById(`sidebar-${side}`);
      const overlay2 = document.getElementById("mobile-overlay");
      if (sidebar) {
        if (sidebar.classList.contains("mobile-open")) {
          sidebar.classList.remove("mobile-open");
          if (overlay2)
            overlay2.classList.remove("active");
        } else {
          sidebar.classList.add("mobile-open");
          if (overlay2)
            overlay2.classList.add("active");
        }
      }
    };
    window.closeMobileSidebars = () => {
      const sidebarLeft = document.getElementById("sidebar-left");
      const sidebarRight = document.getElementById("sidebar-right");
      const overlay2 = document.getElementById("mobile-overlay");
      if (sidebarLeft)
        sidebarLeft.classList.remove("mobile-open");
      if (sidebarRight)
        sidebarRight.classList.remove("mobile-open");
      if (overlay2)
        overlay2.classList.remove("active");
    };
  }
  function setupEventHandlers(elements2) {
    document.getElementById("btn-voice")?.addEventListener("click", () => startConversation("voice"));
    document.getElementById("btn-screen")?.addEventListener("click", () => startConversation("screen"));
    document.getElementById("btn-camera")?.addEventListener("click", () => startConversation("camera"));
    document.getElementById("stop-btn")?.addEventListener("click", () => stopConversation(true));
    const skipBtn = document.getElementById("skip-speech-btn");
    skipBtn?.addEventListener("click", () => {
      if (window.AudioPlayback) {
        window.AudioPlayback.skipPlayback();
      }
      setState({ isPlaying: false });
      StreamingDisplay.finalize("ai", "");
      StreamingDisplay.reset();
      StreamingDisplay.triggerEnrichment(true);
      skipBtn.classList.remove("speaking");
      console.log("[Skip] Bot speech interrupted \u2014 text saved to history, mic re-enabled");
    });
    const muteBtn = document.getElementById("mute-mic-btn");
    muteBtn?.addEventListener("click", () => {
      const isMuted = muteBtn.classList.toggle("muted");
      muteBtn.textContent = isMuted ? "\u{1F6AB}\u{1F399}\uFE0F" : "\u{1F399}\uFE0F";
      muteBtn.title = isMuted ? "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D" : "\u0417\u0430\u0433\u043B\u0443\u0448\u0438\u0442\u044C \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D (\u0440\u0435\u0436\u0438\u043C \u043F\u0440\u0430\u043A\u0442\u0438\u043A\u0438)";
      if (window.AudioCapture) {
        window.AudioCapture.setMicMute(isMuted);
      }
    });
    const muteVoiceBtn = document.getElementById("mute-voice-btn");
    const volumeSlider = document.getElementById("volume-slider");
    let savedVolume = parseInt(localStorage.getItem("app_volume") || "100", 10);
    if (volumeSlider) {
      volumeSlider.value = String(savedVolume);
    }
    muteVoiceBtn?.addEventListener("click", () => {
      const isMuted = muteVoiceBtn.classList.toggle("muted");
      if (isMuted) {
        savedVolume = parseInt(volumeSlider?.value || "100", 10);
        if (volumeSlider)
          volumeSlider.value = "0";
        muteVoiceBtn.textContent = "\u{1F507}";
        muteVoiceBtn.title = "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441 \u0431\u043E\u0442\u0430";
      } else {
        if (volumeSlider)
          volumeSlider.value = String(savedVolume);
        muteVoiceBtn.textContent = "\u{1F50A}";
        muteVoiceBtn.title = "\u0417\u0430\u0433\u043B\u0443\u0448\u0438\u0442\u044C \u0433\u043E\u043B\u043E\u0441 \u0431\u043E\u0442\u0430";
      }
      const volume = parseInt(volumeSlider?.value || "100", 10);
      if (window.AudioPlayback) {
        window.AudioPlayback.setVolume(volume / 100);
      }
    });
    volumeSlider?.addEventListener("input", () => {
      const volume = parseInt(volumeSlider.value, 10);
      localStorage.setItem("app_volume", String(volume));
      if (muteVoiceBtn) {
        muteVoiceBtn.textContent = volume === 0 ? "\u{1F507}" : volume < 50 ? "\u{1F509}" : "\u{1F50A}";
        if (volume === 0) {
          muteVoiceBtn.classList.add("muted");
        } else {
          muteVoiceBtn.classList.remove("muted");
        }
      }
      if (window.AudioPlayback) {
        window.AudioPlayback.setVolume(volume / 100);
      }
    });
    const germanOnlyBtn = document.getElementById("german-only-btn");
    const savedGermanOnly = localStorage.getItem("germanOnlyMode") === "true";
    if (savedGermanOnly && germanOnlyBtn) {
      germanOnlyBtn.classList.add("active");
      germanOnlyBtn.textContent = "\u{1F1E9}\u{1F1EA}\u2713";
      window.germanOnlyMode = true;
    }
    germanOnlyBtn?.addEventListener("click", () => {
      const isActive = germanOnlyBtn.classList.toggle("active");
      germanOnlyBtn.textContent = isActive ? "\u{1F1E9}\u{1F1EA}\u2713" : "\u{1F1E9}\u{1F1EA}";
      germanOnlyBtn.title = isActive ? "\u0420\u0435\u0436\u0438\u043C: \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 \u0412\u041A\u041B (\u043D\u0430\u0436\u043C\u0438 \u0447\u0442\u043E\u0431 \u0432\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C)" : "\u0420\u0435\u0436\u0438\u043C: \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 (\u043D\u0435 \u043E\u0437\u0432\u0443\u0447\u0438\u0432\u0430\u0442\u044C \u0440\u0443\u0441\u0441\u043A\u0438\u0439)";
      localStorage.setItem("germanOnlyMode", String(isActive));
      window.germanOnlyMode = isActive;
      const WsController = window.WsController;
      if (WsController?.isConnected?.()) {
        const message = isActive ? "[SYSTEM] \u0412\u0410\u0416\u041D\u041E: \u0421 \u044D\u0442\u043E\u0433\u043E \u043C\u043E\u043C\u0435\u043D\u0442\u0430 \u0433\u043E\u0432\u043E\u0440\u0438 \u0422\u041E\u041B\u042C\u041A\u041E \u043F\u043E-\u043D\u0435\u043C\u0435\u0446\u043A\u0438! \u0420\u0443\u0441\u0441\u043A\u0438\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u044B \u041F\u0418\u0428\u0418 \u0432 \u0441\u043A\u043E\u0431\u043A\u0430\u0445, \u043D\u043E \u041D\u0415 \u041E\u0417\u0412\u0423\u0427\u0418\u0412\u0410\u0419. \u0413\u043E\u0432\u043E\u0440\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u0439 \u0442\u0435\u043A\u0441\u0442!" : "[SYSTEM] \u041C\u043E\u0436\u0435\u0448\u044C \u0441\u043D\u043E\u0432\u0430 \u043E\u0437\u0432\u0443\u0447\u0438\u0432\u0430\u0442\u044C \u0440\u0443\u0441\u0441\u043A\u0438\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u044B \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043D\u0435\u043C\u0435\u0446\u043A\u0438\u043C.";
        WsController.sendText(message);
        console.log("[GermanOnly]", isActive ? "Enabled" : "Disabled");
      }
    });
    elements2.saveBtn?.addEventListener("click", Settings.save);
    Settings.setupThemeListener();
    Settings.setupBgToggle();
    Settings.setupTeacherModeListener();
    Settings.setupSpeechRateListener();
    Settings.setupApiKeyListeners();
    elements2.sendBtn?.addEventListener("click", Chat.sendTextMessage);
    elements2.textInput?.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        Chat.sendTextMessage();
      }
    });
    elements2.attachBtn?.addEventListener("click", () => elements2.fileInput?.click());
    elements2.fileInput?.addEventListener("change", handleFileSelect);
    elements2.newChatBtn?.addEventListener("click", newChat);
    setupSidebarCollapse();
    setupVideoControls();
    setupProgressWidget();
    setupDraggableWidget();
    document.addEventListener("click", () => {
      elements2.contextMenu?.classList.add("hidden");
    });
  }
  function setupDraggableWidget() {
    const widget = document.getElementById("floating-widget");
    const handle = document.getElementById("widget-drag-handle");
    if (!widget || !handle)
      return;
    widget.classList.remove("hidden");
    widget.style.display = "flex";
    const savedPos = localStorage.getItem("widget-position");
    if (savedPos) {
      try {
        const { x, y } = JSON.parse(savedPos);
        const maxX = window.innerWidth - 100;
        const maxY = window.innerHeight - 50;
        if (x >= 0 && x <= maxX && y >= 0 && y <= maxY) {
          widget.style.left = `${x}px`;
          widget.style.top = `${y}px`;
          widget.style.right = "auto";
          widget.style.bottom = "auto";
        } else {
          console.log("[Widget] Saved position out of bounds, resetting");
          localStorage.removeItem("widget-position");
        }
      } catch (e) {
        console.log("[Widget] Failed to restore position");
        localStorage.removeItem("widget-position");
      }
    }
    let isDragging2 = false;
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;
    const startDrag2 = (clientX, clientY) => {
      isDragging2 = true;
      const rect = widget.getBoundingClientRect();
      startX = clientX;
      startY = clientY;
      initialX = rect.left;
      initialY = rect.top;
      handle.style.cursor = "grabbing";
    };
    const doDrag = (clientX, clientY) => {
      if (!isDragging2)
        return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      let newX = initialX + dx;
      let newY = initialY + dy;
      newX = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, newX));
      newY = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, newY));
      widget.style.left = `${newX}px`;
      widget.style.top = `${newY}px`;
      widget.style.right = "auto";
      widget.style.bottom = "auto";
    };
    const endDrag = () => {
      if (!isDragging2)
        return;
      isDragging2 = false;
      handle.style.cursor = "grab";
      const rect = widget.getBoundingClientRect();
      localStorage.setItem("widget-position", JSON.stringify({ x: rect.left, y: rect.top }));
    };
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startDrag2(e.clientX, e.clientY);
    });
    document.addEventListener("mousemove", (e) => doDrag(e.clientX, e.clientY));
    document.addEventListener("mouseup", endDrag);
    handle.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      startDrag2(touch.clientX, touch.clientY);
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      const touch = e.touches[0];
      doDrag(touch.clientX, touch.clientY);
    }, { passive: true });
    document.addEventListener("touchend", endDrag);
  }
  function handleFileSelect(e) {
    const input = e.target;
    const files = Array.from(input.files || []);
    const state2 = getState();
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result;
        const base64 = result.split(",")[1];
        state2.pendingAttachments.push({
          name: file.name,
          type: file.type,
          data: base64,
          preview: file.type.startsWith("image/") ? result : null
        });
        updateAttachmentsPreview();
      };
      reader.readAsDataURL(file);
    });
    input.value = "";
  }
  function updateAttachmentsPreview() {
    const container2 = document.getElementById("attachments-preview");
    const state2 = getState();
    if (!container2)
      return;
    if (state2.pendingAttachments.length === 0) {
      container2.innerHTML = "";
      container2.classList.add("hidden");
      return;
    }
    container2.classList.remove("hidden");
    container2.innerHTML = state2.pendingAttachments.map((att, i) => `
        <div class="attachment-chip">
            ${att.preview ? `<img src="${att.preview}" class="attachment-thumb">` : ""}
            <span>${att.name}</span>
            <button onclick="removeAttachment(${i})" class="remove-attachment">\xD7</button>
        </div>
    `).join("");
  }
  window.removeAttachment = function(index) {
    const state2 = getState();
    state2.pendingAttachments.splice(index, 1);
    updateAttachmentsPreview();
  };
  function newChat() {
    Chat.clearMessages();
    const newChatId = crypto.randomUUID();
    setState({
      conversationHistory: [],
      currentChatId: newChatId
    });
    localStorage.setItem("gemini_current_chat_id", newChatId);
    clearAttachments();
    updateAttachmentsPreview();
    Notifications.showToast("\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442 \u0441\u043E\u0437\u0434\u0430\u043D", 2e3);
  }
  function setupSidebarCollapse() {
    const SIDEBAR_STATE_KEY = "sidebar_state";
    const SIDEBAR_WIDTH_KEY = "sidebar_widths";
    const savedState = JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) || "{}");
    const savedWidths = JSON.parse(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "{}");
    const MIN_SIDEBAR = 150;
    const app = document.querySelector(".app");
    if (savedWidths.left && app) {
      const w = Math.max(MIN_SIDEBAR, savedWidths.left);
      app.style.setProperty("--sidebar-left-width", w + "px");
    }
    if (savedWidths.right && app) {
      const w = Math.max(MIN_SIDEBAR, savedWidths.right);
      app.style.setProperty("--sidebar-right-width", w + "px");
    }
    if (savedState.leftCollapsed) {
      document.querySelector(".app")?.classList.add("left-collapsed");
      createShowButton("left");
    }
    if (savedState.rightCollapsed) {
      document.querySelector(".app")?.classList.add("right-collapsed");
      createShowButton("right");
    }
    const saveSidebarState = () => {
      const appEl = document.querySelector(".app");
      localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify({
        leftCollapsed: appEl?.classList.contains("left-collapsed") || false,
        rightCollapsed: appEl?.classList.contains("right-collapsed") || false
      }));
    };
    document.getElementById("hide-left-btn")?.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        window.closeMobileSidebars?.();
      } else {
        document.querySelector(".app")?.classList.add("left-collapsed");
        createShowButton("left");
        saveSidebarState();
      }
    });
    document.getElementById("hide-right-btn")?.addEventListener("click", () => {
      if (window.innerWidth <= 900) {
        window.closeMobileSidebars?.();
      } else {
        document.querySelector(".app")?.classList.add("right-collapsed");
        createShowButton("right");
        saveSidebarState();
      }
    });
    window._saveSidebarState = saveSidebarState;
    const leftSidebar = document.getElementById("sidebar-left");
    const rightSidebar = document.getElementById("sidebar-right");
    function createDragHandle(sidebar, side) {
      const handle = document.createElement("div");
      handle.className = `sidebar-drag-handle sidebar-drag-${side}`;
      handle.title = "\u041F\u043E\u0442\u044F\u043D\u0438\u0442\u0435 \u0434\u043B\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0448\u0438\u0440\u0438\u043D\u044B";
      sidebar.appendChild(handle);
      let startX = 0;
      let startWidth = 0;
      let isDragging2 = false;
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isDragging2 = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        handle.classList.add("active");
      });
      document.addEventListener("mousemove", (e) => {
        if (!isDragging2)
          return;
        const MIN_W = 150, MAX_W = 500;
        let newWidth;
        if (side === "left") {
          newWidth = startWidth + (e.clientX - startX);
        } else {
          newWidth = startWidth - (e.clientX - startX);
        }
        newWidth = Math.max(MIN_W, Math.min(MAX_W, newWidth));
        const cssVar = side === "left" ? "--sidebar-left-width" : "--sidebar-right-width";
        app?.style.setProperty(cssVar, newWidth + "px");
      });
      document.addEventListener("mouseup", () => {
        if (!isDragging2)
          return;
        isDragging2 = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        handle.classList.remove("active");
        const widths = JSON.parse(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "{}");
        if (side === "left" && leftSidebar)
          widths.left = leftSidebar.offsetWidth;
        if (side === "right" && rightSidebar)
          widths.right = rightSidebar.offsetWidth;
        localStorage.setItem(SIDEBAR_WIDTH_KEY, JSON.stringify(widths));
      });
    }
    if (leftSidebar)
      createDragHandle(leftSidebar, "left");
    if (rightSidebar)
      createDragHandle(rightSidebar, "right");
  }
  function createShowButton(side) {
    const existing = document.getElementById(`show-${side}-btn`);
    if (existing)
      return;
    const btn = document.createElement("button");
    btn.id = `show-${side}-btn`;
    btn.className = `show-sidebar-btn ${side}`;
    btn.textContent = side === "left" ? "\u2192" : "\u2190";
    btn.addEventListener("click", () => {
      document.querySelector(".app")?.classList.remove(`${side}-collapsed`);
      btn.remove();
      if (window._saveSidebarState) {
        window._saveSidebarState();
      }
    });
    document.body.appendChild(btn);
  }
  function setupVideoControls() {
    const elements2 = getElements();
    const videoSection = elements2.videoSection;
    if (!videoSection)
      return;
    const toggleBtn = document.getElementById("toggle-video");
    const fullscreenBtn = document.getElementById("video-fullscreen");
    const hideBtn = document.getElementById("hide-video");
    const showBtn = document.getElementById("show-video-btn");
    const videoBody = document.getElementById("video-body");
    const dragHandle = videoSection.querySelector(".drag-handle");
    toggleBtn?.addEventListener("click", () => {
      videoBody?.classList.toggle("minimized");
      if (toggleBtn)
        toggleBtn.textContent = videoBody?.classList.contains("minimized") ? "+" : "\u2212";
    });
    hideBtn?.addEventListener("click", () => {
      videoSection.classList.add("video-hidden");
      showBtn?.classList.remove("hidden");
    });
    showBtn?.addEventListener("click", () => {
      videoSection.classList.remove("video-hidden");
      showBtn?.classList.add("hidden");
    });
    fullscreenBtn?.addEventListener("click", () => {
      videoSection.classList.toggle("video-fullscreen");
    });
    setupDrag(videoSection, dragHandle);
  }
  function setupDrag(videoSection, dragHandle) {
    if (!dragHandle)
      return;
    let isDragging2 = false;
    let offsetX = 0, offsetY = 0;
    const startDrag2 = (clientX, clientY) => {
      if (videoSection.classList.contains("video-fullscreen"))
        return;
      isDragging2 = true;
      videoSection.classList.add("dragging");
      const rect = videoSection.getBoundingClientRect();
      offsetX = clientX - rect.left;
      offsetY = clientY - rect.top;
      videoSection.style.position = "fixed";
      videoSection.style.left = `${rect.left}px`;
      videoSection.style.top = `${rect.top}px`;
      videoSection.style.right = "auto";
      videoSection.style.bottom = "auto";
    };
    const moveDrag = (clientX, clientY) => {
      if (!isDragging2)
        return;
      const maxX = window.innerWidth - videoSection.offsetWidth;
      const maxY = window.innerHeight - videoSection.offsetHeight;
      videoSection.style.left = `${Math.max(0, Math.min(clientX - offsetX, maxX))}px`;
      videoSection.style.top = `${Math.max(0, Math.min(clientY - offsetY, maxY))}px`;
    };
    const endDrag = () => {
      isDragging2 = false;
      videoSection.classList.remove("dragging");
    };
    dragHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startDrag2(e.clientX, e.clientY);
    });
    document.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
    document.addEventListener("mouseup", endDrag);
    dragHandle.addEventListener("touchstart", (e) => {
      e.preventDefault();
      startDrag2(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    document.addEventListener("touchmove", (e) => {
      if (isDragging2) {
        e.preventDefault();
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    document.addEventListener("touchend", endDrag);
  }
  var progressAutoCloseTimer = null;
  function setupProgressWidget() {
    const progressSection = document.querySelector(".progress-section");
    if (progressSection) {
      const progressLabel = progressSection.querySelector("label");
      const progressWidget = progressSection.querySelector("#progress-widget");
      const progressActions = progressSection.querySelector(".progress-actions-row");
      let arrowSpan = null;
      if (progressLabel) {
        arrowSpan = document.createElement("span");
        arrowSpan.className = "progress-collapse-arrow";
        arrowSpan.textContent = " \u25B8";
        arrowSpan.style.cssText = "font-size: 10px; opacity: 0.7; transition: transform 0.2s; display: inline-block;";
        progressLabel.appendChild(arrowSpan);
      }
      if (progressWidget)
        progressWidget.style.display = "none";
      if (progressActions)
        progressActions.style.display = "none";
      if (progressLabel) {
        progressLabel.style.cursor = "pointer";
        progressLabel.title = "Click to expand";
        progressLabel.addEventListener("click", (e) => {
          if (e.target.classList.contains("tooltip-hint-btn"))
            return;
          const isHidden = progressWidget?.style.display === "none";
          if (progressWidget)
            progressWidget.style.display = isHidden ? "" : "none";
          if (progressActions)
            progressActions.style.display = isHidden ? "" : "none";
          if (arrowSpan)
            arrowSpan.textContent = isHidden ? " \u25BE" : " \u25B8";
          if (isHidden) {
            if (progressAutoCloseTimer)
              clearTimeout(progressAutoCloseTimer);
            progressAutoCloseTimer = setTimeout(() => {
              if (progressWidget)
                progressWidget.style.display = "none";
              if (progressActions)
                progressActions.style.display = "none";
              if (arrowSpan)
                arrowSpan.textContent = " \u25B8";
            }, 1e4);
          } else {
            if (progressAutoCloseTimer)
              clearTimeout(progressAutoCloseTimer);
          }
        });
      }
    }
    document.getElementById("export-words-btn")?.addEventListener("click", () => {
      window.open("/api/export-words?format=csv", "_blank");
    });
    document.getElementById("language-level")?.addEventListener("change", async () => {
      const newLevel = document.getElementById("language-level")?.value;
      if (newLevel) {
        localStorage.setItem("gemini_level", newLevel);
        try {
          await fetch("/api/profile?user_id=default", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ level: newLevel })
          });
          console.log("[Level] Updated DB profile level to:", newLevel);
        } catch (err) {
          console.error("[Level] Failed to update profile:", err);
        }
        const state2 = getState();
        if (state2.isConnected) {
          try {
            await fetch("/api/clear-session", { method: "POST" });
          } catch (_) {
          }
          StreamingDisplay.hardReset();
          const chatMessages = document.getElementById("chat-messages");
          if (chatMessages) {
            chatMessages.innerHTML = "";
            const notif = document.createElement("div");
            notif.className = "system-message mode-change-notice";
            notif.innerHTML = `\u{1F504} \u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043D\u0430 <strong>${newLevel}</strong>...`;
            notif.style.cssText = "background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; padding: 10px; margin: 10px 0; border-radius: 8px; text-align: center;";
            chatMessages.appendChild(notif);
          }
          stopConversation();
          setTimeout(() => startConversation("voice"), 500);
        }
      }
      Vocabulary.refreshProgress();
    });
    setupSaveSlots();
  }
  async function setupSaveSlots() {
    const savesModal = document.getElementById("saves-modal");
    const openBtn = document.getElementById("open-saves-modal-btn");
    const closeBtn = document.getElementById("close-saves-modal");
    openBtn?.addEventListener("click", () => {
      savesModal?.classList.remove("hidden");
      const currentSaveName = localStorage.getItem("current_save_name");
      const nameEl = document.getElementById("current-save-name");
      if (nameEl) {
        nameEl.textContent = currentSaveName || "\u041D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E (\u043D\u043E\u0432\u0430\u044F \u0441\u0435\u0441\u0441\u0438\u044F)";
        nameEl.style.color = currentSaveName ? "var(--green)" : "var(--text3)";
      }
      loadSaveSlotsList();
    });
    closeBtn?.addEventListener("click", () => {
      savesModal?.classList.add("hidden");
    });
    savesModal?.querySelector(".modal-overlay")?.addEventListener("click", () => {
      savesModal?.classList.add("hidden");
    });
    document.getElementById("create-save-btn")?.addEventListener("click", async () => {
      const name = prompt("\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F:", `\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 ${(/* @__PURE__ */ new Date()).toLocaleDateString("ru")}`);
      if (!name)
        return;
      try {
        const res = await fetch("/api/saves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot_name: name })
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem("current_save_name", name);
          Notifications.showToast(`\u{1F4BE} \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E: ${data.word_count} \u0441\u043B\u043E\u0432`, 3e3);
          loadSaveSlotsList();
        }
      } catch (e) {
        console.error("Save failed:", e);
      }
    });
    document.getElementById("reset-progress-btn")?.addEventListener("click", async () => {
      if (!confirm("\u26A0\uFE0F \u0412\u044B \u0443\u0432\u0435\u0440\u0435\u043D\u044B, \u0447\u0442\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u043D\u0430\u0447\u0430\u0442\u044C \u0437\u0430\u043D\u043E\u0432\u043E?\n\n\u0412\u0435\u0441\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043B\u0451\u043D!\n\n\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441!"))
        return;
      try {
        const res = await fetch("/api/progress/reset-all", { method: "POST" });
        if (res.ok) {
          Notifications.showToast("\u{1F5D1}\uFE0F \u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u0431\u0440\u043E\u0448\u0435\u043D", 3e3);
          Vocabulary.refreshProgress();
        }
      } catch (e) {
        console.error("Reset failed:", e);
      }
    });
    loadSaveSlotsList();
  }
  async function loadSaveSlotsList() {
    const container2 = document.getElementById("save-slots-list");
    if (!container2)
      return;
    try {
      const res = await fetch("/api/saves");
      if (!res.ok)
        throw new Error("Failed to load saves");
      const slots = await res.json();
      if (slots.length === 0) {
        container2.innerHTML = '<p class="saves-empty">\u041D\u0435\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0439</p>';
        return;
      }
      container2.innerHTML = slots.map((slot) => `
            <div class="save-slot-item" data-id="${slot.id}">
                <div class="save-slot-info">
                    <span class="save-slot-name">${escapeHtml2(slot.slot_name)}</span>
                    <span class="save-slot-meta">${slot.word_count} \u0441\u043B\u043E\u0432 \u2022 ${formatDate(slot.created_at)}</span>
                </div>
                <div class="save-slot-btns">
                    <button class="btn btn-sm btn-load load-save-btn">\u{1F4C2} \u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C</button>
                    <button class="btn btn-sm btn-del delete-save-btn">\u{1F5D1}\uFE0F \u0423\u0434\u0430\u043B\u0438\u0442\u044C</button>
                </div>
            </div>
        `).join("");
      container2.querySelectorAll(".load-save-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const item = e.target.closest(".save-slot-item");
          const id = item?.getAttribute("data-id");
          if (!id || !confirm("\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u044D\u0442\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435?\n\n\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u043C\u0435\u043D\u0451\u043D!"))
            return;
          try {
            const res2 = await fetch(`/api/saves/${id}`);
            if (res2.ok) {
              const data = await res2.json();
              const slotName = item?.querySelector(".save-slot-name")?.textContent || "";
              localStorage.setItem("current_save_name", slotName);
              Notifications.showToast(`\u{1F4C2} \u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E: ${data.word_count} \u0441\u043B\u043E\u0432`, 3e3);
              Vocabulary.refreshProgress();
            }
          } catch (e2) {
            console.error("Load failed:", e2);
          }
        });
      });
      container2.querySelectorAll(".delete-save-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const item = e.target.closest(".save-slot-item");
          const id = item?.getAttribute("data-id");
          if (!id || !confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435?"))
            return;
          try {
            const res2 = await fetch(`/api/saves/${id}`, { method: "DELETE" });
            if (res2.ok) {
              Notifications.showToast("\u{1F5D1}\uFE0F \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E", 2e3);
              loadSaveSlotsList();
            }
          } catch (e2) {
            console.error("Delete failed:", e2);
          }
        });
      });
    } catch (e) {
      console.error("Failed to load saves:", e);
      container2.innerHTML = '<p class="saves-empty">\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438</p>';
    }
  }
  function escapeHtml2(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  function formatDate(isoDate) {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString("ru", { day: "numeric", month: "short" });
    } catch {
      return isoDate;
    }
  }
  document.addEventListener("DOMContentLoaded", initApp);
  console.log("[App] TypeScript bundle loaded");
})();
//# sourceMappingURL=bundle.js.map
