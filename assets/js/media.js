/* ============================================================================
 * media.js — 媒体层
 *   IndexedDB 二进制归档 · 唱片机播放器 · 哥特氛围音效（纯 WebAudio 合成）
 *   所有能力都挂在 window.Media 上，无构建步骤、无依赖。
 * ==========================================================================*/
(function () {
  'use strict';

  const DB_NAME = 'memorial-media';
  const DB_VERSION = 1;
  const STORE = 'files';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('byPerson', 'personId', { recursive: false });
          store.createIndex('byKind', 'kind', { recursive: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
    return dbPromise;
  }

  async function tx(mode, run) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      try {
        out = run(store);
      } catch (err) {
        reject(err);
        return;
      }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('事务被中止'));
    });
  }

  const uid = (prefix) =>
    (prefix || 'm') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

  async function putFile({ blob, name, kind, personId }) {
    const id = uid(kind === 'audio' ? 'a' : kind === 'video' ? 'v' : 'i');
    const rec = {
      id,
      name: name || '未命名',
      kind: kind || 'image',
      type: (blob && blob.type) || '',
      size: (blob && blob.size) || 0,
      personId: personId || '',
      addedAt: Date.now(),
      blob,
    };
    await tx('readwrite', (s) => s.put(rec));
    return id;
  }

  async function getFile(id) {
    return tx('readonly', (s) => s.get(id));
  }

  async function deleteFile(id) {
    return tx('readwrite', (s) => s.delete(id));
  }

  async function allMeta() {
    const recs = await tx('readonly', (s) => s.getAll());
    return (recs || []).map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      type: r.type,
      size: r.size,
      personId: r.personId,
      addedAt: r.addedAt,
    }));
  }

  async function clearAll() {
    return tx('readwrite', (s) => s.clear());
  }

  /* ---------------------------------------------------- 对象 URL 生命周期 */
  const urls = new Map(); // fileId -> objectURL

  async function useObjectURL(fileId) {
    if (urls.has(fileId)) return urls.get(fileId);
    const rec = await getFile(fileId);
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    urls.set(fileId, url);
    return url;
  }

  function releaseObjectURL(fileId) {
    if (urls.has(fileId)) {
      URL.revokeObjectURL(urls.get(fileId));
      urls.delete(fileId);
    }
  }

  function releaseAll() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  }

  function kindOf(file) {
    const type = (file && file.type) || '';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (type.startsWith('image/')) return 'image';
    const ext = ((file && file.name) || '').split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(ext)) return 'audio';
    return 'image';
  }

  /* ------------------------------------------------ 哥特氛围音效（合成器） */
  /* 低音管风琴持续音 + 缓慢颤音 + 偶发钟声，无需任何音频文件。 */
  const drone = {
    ctx: null,
    nodes: null,
    on: false,
    volume: 0.5,

    make() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 0;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.6;

      const mix = ctx.createGain();
      mix.gain.value = 0.9;
      filter.connect(mix);
      mix.connect(master);
      master.connect(ctx.destination);

      // 小三和弦：D2 / F2 / A2 / D3
      const voices = [
        { f: 73.42, g: 0.34, d: 0.04 },
        { f: 87.31, g: 0.26, d: -0.06 },
        { f: 110.0, g: 0.2, d: 0.09 },
        { f: 146.83, g: 0.11, d: -0.11 },
      ].map((v, i) => {
        const osc = ctx.createOscillator();
        osc.type = i % 2 ? 'triangle' : 'sine';
        osc.frequency.value = v.f;
        osc.detune.value = v.d * 100;
        const g = ctx.createGain();
        g.gain.value = v.g;
        // 各自独立的缓慢起伏，避免机械感
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.045 + i * 0.017;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = v.g * 0.55;
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        osc.connect(g);
        g.connect(filter);
        return { osc, lfo, g };
      });

      // 空气噪声层（穿过滤波器，模拟房间/风）
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.022 * white) / 1.022;
        data[i] = last * 3.2;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.16;
      noise.connect(noiseGain);
      noiseGain.connect(filter);

      this.ctx = ctx;
      this.nodes = { master, filter, voices, noise, noiseGain, bellTimer: null };
      return true;
    },

    async toggle() {
      if (!this.nodes && !this.make()) throw new Error('WebAudio 不可用');
      const { ctx, nodes } = this;
      if (ctx.state === 'suspended') await ctx.resume();
      const t = ctx.currentTime;
      if (!this.on) {
        nodes.voices.forEach((v) => {
          try { v.osc.start(); v.lfo.start(); } catch (e) { /* 已启动 */ }
        });
        try { nodes.noise.start(); } catch (e) { /* 已启动 */ }
        nodes.master.gain.cancelScheduledValues(t);
        nodes.master.gain.setValueAtTime(nodes.master.gain.value, t);
        nodes.master.gain.linearRampToValueAtTime(0.3 * this.volume, t + 3.4);
        this.scheduleBell();
        this.on = true;
      } else {
        nodes.master.gain.cancelScheduledValues(t);
        nodes.master.gain.setValueAtTime(nodes.master.gain.value, t);
        nodes.master.gain.linearRampToValueAtTime(0, t + 1.6);
        if (nodes.bellTimer) clearTimeout(nodes.bellTimer);
        this.on = false;
      }
      return this.on;
    },

    scheduleBell() {
      if (!this.on && this.nodes && this.nodes.bellTimer) return;
      const wait = 14000 + Math.random() * 26000;
      this.nodes.bellTimer = setTimeout(() => {
        this.bell();
        if (this.on) this.scheduleBell();
      }, wait);
    },

    bell() {
      const { ctx, nodes } = this;
      if (!ctx || !this.on) return;
      const t = ctx.currentTime;
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.002);
        const g = ctx.createGain();
        g.gain.value = 0;
        const start = t + i * 0.055;
        const peak = 0.045 / (i + 1);
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(peak, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, start + 6.2);
        osc.connect(g);
        g.connect(nodes.master);
        osc.start(start);
        osc.stop(start + 6.4);
      });
    },

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.ctx && this.on && this.nodes) {
        this.nodes.master.gain.setTargetAtTime(0.3 * this.volume, this.ctx.currentTime, 0.4);
      }
    },
  };

  /* --------------------------------------------------------- 唱片机播放器 */
  const player = {
    audio: null,
    tracks: [],
    index: 0,
    hooks: {},

    ensure() {
      if (this.audio) return this.audio;
      const a = new Audio();
      a.preload = 'metadata';
      a.addEventListener('play', () => this.emit('state'));
      a.addEventListener('pause', () => this.emit('state'));
      a.addEventListener('ended', () => this.next(true));
      a.addEventListener('timeupdate', () => this.emit('time'));
      a.addEventListener('loadedmetadata', () => this.emit('time'));
      a.addEventListener('error', () => this.emit('error'));
      this.audio = a;
      return a;
    },

    on(event, fn) {
      this.hooks[event] = fn;
      return this;
    },

    emit(event, payload) {
      if (typeof this.hooks[event] === 'function') this.hooks[event](payload);
    },

    async load(tracks) {
      const next = (tracks || []).filter(Boolean);
      const sig = next
        .map((t) => t.id + ':' + (t.fileId || '') + ':' + (t.src ? String(t.src).slice(-24) : ''))
        .join('|');
      // 列表没有变化时，不要打断正在播放的曲子
      if (sig === this.sig && this.audio && this.audio.src) return;
      this.sig = sig;
      this.tracks = next;
      if (!this.tracks.length) return;
      if (this.index >= this.tracks.length) this.index = 0;
      await this.cue(this.index, false);
    },

    async cue(index, autoplay) {
      const track = this.tracks[index];
      if (!track) return;
      this.index = index;
      const a = this.ensure();
      let src = track.src || null;

      if (!src && track.fileId) {
        try {
          src = await useObjectURL(track.fileId);
        } catch (err) {
          src = null;
        }
      }
      if (!src) {
        this.emit('error', { track, reason: 'missing' });
        return;
      }
      a.src = src;
      this.emit('track', { track, index });
      this.emit('state');
      if (autoplay !== false) {
        try {
          await a.play();
        } catch (err) {
          this.emit('error', { track, reason: 'blocked', error: err });
        }
      }
    },

    async play() {
      const a = this.ensure();
      if (!a.src && this.tracks.length) await this.cue(this.index, false);
      try {
        await a.play();
        return true;
      } catch (err) {
        this.emit('error', { reason: 'blocked', error: err });
        return false;
      }
    },

    pause() {
      if (this.audio) this.audio.pause();
    },

    toggle() {
      if (!this.audio || this.audio.paused) return this.play();
      this.pause();
      return Promise.resolve(false);
    },

    next(auto) {
      if (!this.tracks.length) return;
      const n = (this.index + 1) % this.tracks.length;
      this.cue(n, true);
    },

    prev() {
      if (!this.tracks.length) return;
      const n = (this.index - 1 + this.tracks.length) % this.tracks.length;
      this.cue(n, true);
    },

    seek(ratio) {
      const a = this.ensure();
      if (!a.duration || !isFinite(a.duration)) return;
      a.currentTime = Math.max(0, Math.min(1, ratio)) * a.duration;
    },

    setVolume(v) {
      this.ensure().volume = Math.max(0, Math.min(1, v));
    },

    get playing() {
      return !!(this.audio && !this.audio.paused && this.audio.src);
    },
  };

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  window.Media = {
    uid,
    putFile,
    getFile,
    deleteFile,
    allMeta,
    clearAll,
    useObjectURL,
    releaseObjectURL,
    releaseAll,
    kindOf,
    drone,
    player,
    fmtTime,
  };
})();
