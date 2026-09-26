/* ============================================================================
 * app.js — 交互与渲染总控
 *   依赖 store.js（数据）与 media.js（媒体）。
 *   页面通过 <body data-page="home|person" data-person="p1"> 声明身份。
 * ==========================================================================*/
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const S = window.Store;
  const M = window.Media;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const body = document.body;
  const page = body.dataset.page || 'home';
  // 人物页的真实身份来自 URL 的 ?id=，模板里的 data-person 只是默认值
  let urlId = '';
  try {
    urlId = new URLSearchParams(location.search).get('id') || '';
  } catch (err) {
    urlId = '';
  }
  const personId = /^p[1-4]$/.test(urlId) ? urlId : body.dataset.person || '';
  body.dataset.person = personId;
  const isPersonPage = page === 'person' && !!personId;
  const editKey = 'vic-memorial:editing';

  /* ------------------------------------------------------------- 小图标 */
  const ICONS = {
    flower: [{ d: 'M12 20.4S4.6 15.9 4.6 10.7A3.6 3.6 0 0 1 12 8.6a3.6 3.6 0 0 1 7.4 2.1c0 5.2-7.4 9.7-7.4 9.7Z', fill: true }],
    plus: [{ d: 'M12 5v14M5 12h14' }],
    close: [{ d: 'M6 6l12 12M18 6L6 18' }],
    left: [{ d: 'M15 5l-7 7 7 7' }],
    right: [{ d: 'M9 5l7 7-7 7' }],
    chevron: [{ d: 'M9 6l6 6-6 6' }],
    play: [{ d: 'M8 5.5v13l11-6.5z', fill: true }],
    pause: [{ d: 'M9 5.5h3v13H9zM13.5 5.5h3v13h-3z', fill: true }],
    prev: [{ d: 'M7 5.5v13M18 6l-8 6 8 6z', fill: true }],
    next: [{ d: 'M17 5.5v13M6 6l8 6-8 6z', fill: true }],
    image: [{ d: 'M4 5.5h16v13H4zM4 15l4.5-4.2L14 16M14.5 12.5l2-1.8L20 14' }, { d: 'M15.5 9.2h.01' }],
    film: [{ d: 'M4 5.5h16v13H4zM8 5.5v13M16 5.5v13M4 12h16M4 8.6h4M4 15.4h4M16 8.6h4M16 15.4h4' }],
    music: [{ d: 'M9 17.5V6.2l10-2v11.1' }, { d: 'M9 17.5a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0ZM19 15.3a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0Z' }],
    candle: [{ d: 'M12 3.5c1.6 1.6 2.3 2.7 2.3 4a2.3 2.3 0 1 1-4.6 0c0-1.3.7-2.4 2.3-4Z' }, { d: 'M8.5 10.5h7v9h-7zM7 19.5h10' }],
    layers: [{ d: 'M12 4l8 4.3-8 4.3-8-4.3z' }, { d: 'M4 12.4l8 4.3 8-4.3M4 16.4l8 4.3 8-4.3' }],
    quill: [{ d: 'M5 19c2-7 6.5-11.5 14-14-1.6 5-4.3 8.6-8.2 10.8L5 19Z' }, { d: 'M5 19l3.5-3.5' }],
    mail: [{ d: 'M3.5 6h17v12h-17zM3.5 6.6L12 13l8.5-6.4' }],
    arrowUp: [{ d: 'M12 19V5M6 11l6-6 6 6' }],
    download: [{ d: 'M12 4v11M7.5 11.5L12 16l4.5-4.5M5 19h14' }],
    reset: [{ d: 'M4.5 12a7.5 7.5 0 1 0 2.4-5.5' }, { d: 'M4 4.5v4h4' }],
    lockOpen: [{ d: 'M6 11h12v9H6zM8.8 11V8.2a3.2 3.2 0 0 1 6.4 0' }],
    lock: [{ d: 'M6 11h12v9H6zM8.8 11V8.2a3.2 3.2 0 0 1 6.4 0v2.8' }],
    sun: [{ d: 'M12 5v2M12 17v2M5 12H3M21 12h-2M6.6 6.6L5.2 5.2M18.8 18.8l-1.4-1.4M17.4 6.6l1.4-1.4M5.2 18.8l1.4-1.4' }, { d: 'M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z' }],
    moon: [{ d: 'M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z' }],
    menu: [{ d: 'M4 7h16M4 12h16M4 17h16' }],
    volume: [{ d: 'M5 10h3l4-3.5v11L8 14H5zM15.5 9.5a4 4 0 0 1 0 5M18 7.5a7 7 0 0 1 0 9' }],
    text: [{ d: 'M5 6.5h14M5 12h9M5 17.5h12' }],
    dots: [{ d: 'M6 12h.01M12 12h.01M18 12h.01' }],
  };

  function icon(name, cls) {
    const paths = ICONS[name] || [];
    const inner = paths
      .map((p) => `<path d="${p.d}"${p.fill ? ' fill="currentColor" stroke="none"' : ''}/>`)
      .join('');
    return `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  }

  /* --------------------------------------------------------------- 提示 */
  let toastBox = null;
  function toast(msg, kind) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'toasts';
      toastBox.setAttribute('role', 'status');
      body.appendChild(toastBox);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'warn' ? ' toast--warn' : '');
    el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 500);
    }, kind === 'warn' ? 5200 : 3000);
  }

  /* ------------------------------------------------- 人物页：把自己换进去 */
  const PEOPLE_ORDER = ['p1', 'p2', 'p3', 'p4'];

  async function personInit() {
    if (!isPersonPage) return;
    if (!S.person(personId)) {
      const fallback = PEOPLE_ORDER[0];
      body.dataset.person = fallback;
      location.replace('person.html?id=' + fallback);
      return;
    }

    const me = S.person(personId);
    const idx = PEOPLE_ORDER.indexOf(personId);

    // 把模板里的 p1 换成当前人物
    $$('[data-text],[data-edit],[data-portrait],[data-portrait-edit]').forEach((el) => {
      ['text', 'edit', 'portrait', 'portraitEdit'].forEach((k) => {
        const v = el.dataset[k];
        if (v && v.indexOf('p1') !== -1) el.dataset[k] = v.split('p1').join(personId);
      });
    });

    // 首屏背景用这个人的一张照片
    const bg = $('[data-profile-bg]');
    if (bg) {
      const imgs = S.mediaOf(personId).filter((m) => m.kind === 'image' && (S.seeded || !m.seed));
      const pick = imgs.filter((m) => !m.seed).slice(-1)[0] || imgs[0];
      const src = pick ? pick.src || (pick.fileId ? await M.useObjectURL(pick.fileId) : '') : '';
      if (src) bg.innerHTML = '<img src="' + esc(src) + '" alt="" aria-hidden="true">';
    }

    // 其余三人
    const strip = $('[data-strip]');
    if (strip) {
      strip.innerHTML = '';
      PEOPLE_ORDER.filter((id) => id !== personId).forEach((id) => {
        const p = S.person(id);
        const item = document.createElement('a');
        item.className = 'strip__item';
        item.href = 'person.html?id=' + id;
        item.innerHTML =
          '<span data-avatar="' + id + '"></span>' +
          '<span>' + esc(p.name) + ' · ' + esc((p.dates || '').split('—')[1] ? (p.dates || '').split('—')[1].trim() : '') + '</span>';
        strip.appendChild(item);
      });
    }

    // 前后翻阅
    const pager = $('[data-pager]');
    if (pager) {
      const prev = S.person(PEOPLE_ORDER[(idx - 1 + 4) % 4]);
      const next = S.person(PEOPLE_ORDER[(idx + 1) % 4]);
      pager.innerHTML =
        '<a class="pager__prev" href="person.html?id=' + prev.id + '"><span>← 上一位</span><strong>' + esc(prev.name) + '</strong></a>' +
        '<a class="pager__next" href="person.html?id=' + next.id + '"><span>下一位 →</span><strong>' + esc(next.name) + '</strong></a>';
    }

    // 定制一句提示
    $$('[data-portrait-hint] small').forEach((s) => { s.textContent = '解锁编辑后点它即可换上'; });
    $$('[data-portrait-hint] .mono:first-child').forEach((s) => { s.textContent = 'Portrait ' + (me.sigil || roman(idx + 1)); });
  }

  async function applyAvatars() {
    const slots = $$('[data-avatar]');
    for (const el of slots) {
      const id = el.dataset.avatar;
      const list = S.mediaOf(id).filter((m) => m.kind === 'image' && (S.seeded || !m.seed));
      const pick = list.filter((m) => !m.seed).slice(-1)[0] || list[0];
      const src = pick ? pick.src || (pick.fileId ? await M.useObjectURL(pick.fileId) : '') : '';
      if (src) el.innerHTML = '<img src="' + esc(src) + '" alt="" aria-hidden="true">';
      else el.remove();
    }
  }

  function roman(n) {
    const map = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return map[n] || String(n);
  }

  function esc(str) {
    return String(str === undefined || str === null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  /* 让同一段文字在刷新后仍保持相同的倾斜角 */
  function hashTilt(str) {
    let h = 0;
    for (let i = 0; i < String(str).length; i += 1) h = (h * 31 + String(str).charCodeAt(i)) % 997;
    return ((h % 5) - 2) * 0.35;
  }

  /* ------------------------------------------------- 文本绑定与内容填充 */
  function applyText() {
    $$('[data-text]').forEach((el) => {
      const v = S.getPath(el.dataset.text, '');
      el.textContent = v;
    });
    $$('[data-attr]').forEach((el) => {
      const [attr, path] = el.dataset.attr.split('|');
      if (attr && path) el.setAttribute(attr, S.getPath(path, ''));
    });
    document.title = S.getPath('site.title', '四人纪念') + (isPersonPage && S.person(personId) ? ' · ' + S.person(personId).name : '');
  }

  /* 可编辑元素也要先回填数据，否则换人/换数据后仍显示模板里的默认字 */
  function fillEditable() {
    $$('[data-edit]').forEach((el) => {
      const path = el.dataset.edit;
      if (!path) return;
      const v = S.getPath(path, null);
      if (v === null || v === undefined) return;
      if (el.textContent.trim() !== String(v).trim()) el.textContent = v;
    });
  }

  /* ------------------------------------------------------------- 灯箱 */
  const lightbox = {
    el: null,
    items: [],
    index: 0,

    mount() {
      if (this.el) return this.el;
      const el = document.createElement('div');
      el.className = 'lightbox';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML =
        '<button class="icon-btn lightbox__close" data-close aria-label="关闭">' + icon('close') + '</button>' +
        '<button class="icon-btn lightbox__nav lightbox__nav--prev" data-prev aria-label="上一项">' + icon('left') + '</button>' +
        '<button class="icon-btn lightbox__nav lightbox__nav--next" data-next aria-label="下一项">' + icon('right') + '</button>' +
        '<div class="lightbox__stage"><div class="lightbox__frame" data-frame></div><div class="lightbox__cap"><h3 data-cap></h3><p data-sub></p></div></div>' +
        '<span class="chip lightbox__count" data-count></span>';
      body.appendChild(el);
      el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('[data-close]')) this.close();
        if (e.target.closest('[data-prev]')) this.step(-1);
        if (e.target.closest('[data-next]')) this.step(1);
      });
      document.addEventListener('keydown', (e) => {
        if (!el.classList.contains('is-open')) return;
        if (e.key === 'Escape') this.close();
        if (e.key === 'ArrowLeft') this.step(-1);
        if (e.key === 'ArrowRight') this.step(1);
      });
      this.el = el;
      return el;
    },

    async open(items, index) {
      this.items = items;
      this.index = index || 0;
      this.mount();
      await this.render();
      this.el.classList.add('is-open');
      body.classList.add('no-scroll');
    },

    async render() {
      const frame = $('[data-frame]', this.el);
      const item = this.items[this.index];
      frame.innerHTML = '';
      if (!item) return;
      frame.style.minWidth = '240px';
      const kind = item.kind === 'video' ? 'video' : 'image';
      const src = item.objectUrl || item.src || '';
      if (!src) {
        frame.innerHTML = '<div class="empty" style="margin:0"><strong>这一格还是空的</strong><p>点相册墙上的「＋」上传你们的影像。</p></div>';
      } else if (kind === 'video') {
        const v = document.createElement('video');
        v.src = src;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        frame.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = src;
        img.alt = item.title || '影像';
        frame.appendChild(img);
      }
      $('[data-cap]', this.el).textContent = item.title || '';
      $('[data-sub]', this.el).textContent = item.caption || '';
      $('[data-count]', this.el).textContent = roman(this.index + 1) + ' / ' + roman(this.items.length) + (item.personName ? ' · ' + item.personName : '');
    },

    step(delta) {
      if (!this.items.length) return;
      this.index = (this.index + delta + this.items.length) % this.items.length;
      this.render();
    },

    close() {
      if (!this.el) return;
      this.el.classList.remove('is-open');
      body.classList.remove('no-scroll');
      const v = $('video', this.el);
      if (v) v.pause();
    },
  };

  /* --------------------------------------------------------- 影音相册墙 */
  const wall = {
    container: null,
    scopePerson: '',
    records: [],
    filter: 'all',

    async mount(sel, opts) {
      this.container = $(sel);
      if (!this.container) return;
      this.scopePerson = (opts && opts.personId) || '';
      this.allowAdd = true;
      await this.refresh();
    },

    async refresh() {
      const showSeeds = S.seeded;
      this.records = S.mediaOf(this.scopePerson)
        .filter((m) => (this.filter === 'all' ? true : m.kind === this.filter))
        .filter((m) => showSeeds || !m.seed);

      // 为需要本地文件的记录预解析 objectURL
      for (const rec of this.records) {
        if (rec.fileId && !rec.src) {
          try {
            rec.objectUrl = await M.useObjectURL(rec.fileId);
          } catch (err) {
            rec.objectUrl = null;
          }
        }
      }
      this.render();
    },

    render() {
      const box = this.container;
      if (!box) return;
      box.innerHTML = '';

      if (!this.records.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.style.gridColumn = '1 / -1';
        empty.style.gridRow = 'span 20';
        empty.innerHTML =
          icon('image') +
          '<p><strong>相册还是空的</strong></p>' +
          '<p>把你们的照片、视频放进来 —— 每人一格，也可以放在公共墙。</p>';
        box.appendChild(empty);
      }

      this.records.forEach((rec, i) => {
        const tile = document.createElement('article');
        tile.className = 'tile' + (rec.kind === 'video' ? ' tile--video' : '');
        tile.dataset.id = rec.id;
        if (rec.kind !== 'video') tile.style.gridRow = 'span ' + (24 + ((i * 5) % 12));
        else tile.style.gridRow = 'span 30';

        const src = rec.objectUrl || rec.src || '';
        const media = src
          ? rec.kind === 'video'
            ? '<video src="' + esc(src) + '" muted playsinline preload="metadata"></video>'
            : '<img src="' + esc(src) + '" alt="' + esc(rec.title || '') + '" loading="lazy" decoding="async">'
          : '<div class="arch__empty" style="position:absolute;inset:0"><div><div class="mono">空缺</div><small>等待你们的影像</small></div></div>';

        const owner = rec.personId && S.person(rec.personId) ? S.person(rec.personId).name : '';
        tile.innerHTML =
          '<div class="tile__media photo-filter">' + media + '</div>' +
          (rec.kind === 'video' && src ? '<div class="tile__play"><span>' + icon('play', 'ico--fill') + '</span></div>' : '') +
          '<span class="tile__kind">' + icon(rec.kind === 'video' ? 'film' : 'image') + '</span>' +
          '<div class="tile__tools">' +
            '<button class="icon-btn" data-act="title" title="改标题" style="width:1.9rem;height:1.9rem">' + icon('text') + '</button>' +
            '<button class="icon-btn" data-act="owner" title="归属于谁" style="width:1.9rem;height:1.9rem">' + icon('layers') + '</button>' +
            '<button class="icon-btn" data-act="remove" title="移除" style="width:1.9rem;height:1.9rem">' + icon('close') + '</button>' +
          '</div>' +
          '<div class="tile__overlay"><span class="tile__title">' + esc(rec.title || '未命名') + '</span>' +
            '<span class="tile__caption">' + esc(rec.caption || '') + '</span>' +
            '<span class="tile__meta">' +
              (owner ? '<span class="chip chip--gold">' + esc(owner) + '</span>' : '<span class="chip">公共</span>') +
              (rec.seed ? '<span class="chip">示例</span>' : '') +
            '</span>' +
          '</div>';
        box.appendChild(tile);
      });

      if (this.allowAdd) box.appendChild(this.addTile());
    },

    addTile() {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tile tile--add';
      t.innerHTML = icon('plus') + '<small>上传照片 / 视频<br>可多选</small>';
      t.addEventListener('click', () => this.pick());
      return t;
    },

    pick() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.addEventListener('change', () => {
        if (input.files && input.files.length) this.ingest(input.files);
      });
      input.click();
    },

    async ingest(fileList) {
      const files = Array.prototype.slice.call(fileList);
      if (!files.length) return;
      let done = 0;
      for (const file of files) {
        const kind = M.kindOf(file);
        let src = '';
        let fileId = '';
        let tooBig = false;
        if (file.size <= 12 * 1024 * 1024) {
          try {
            src = await readAsDataURL(file);
          } catch (err) {
            tooBig = true;
          }
        } else {
          tooBig = true;
        }
        if (tooBig) {
          try {
            fileId = await M.putFile({ blob: file, name: file.name, kind, personId: this.scopePerson });
          } catch (err) {
            toast('存储空间不足，' + file.name + ' 未加入', 'warn');
            continue;
          }
        }
        S.addMedia({
          kind,
          title: file.name.replace(/\.[^.]+$/, ''),
          caption: '',
          personId: this.scopePerson,
          src,
          fileId,
          addedAt: Date.now(),
        });
        done += 1;
      }
      if (done) {
        S.clearSeed();
        S.save({ type: 'media', action: 'bulk' });
        toast('已收藏 ' + done + ' 件影像');
      }
    },
  };

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  /* --------------------------------------------------------- 时间轴渲染 */
  function renderTimeline(sel, scopePerson) {
    const box = $(sel);
    if (!box) return;
    const list = S.timelineOf(scopePerson);
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + icon('quill') + '<p><strong>还没有写下任何时刻</strong></p><p>解锁编辑后，点「添加时刻」把它补上。</p></div>';
      return;
    }
    list.forEach((item, i) => {
      const el = document.createElement('article');
      el.className = 'tl reveal';
      el.dataset.id = item.id;
      const owner = item.personId && S.person(item.personId) ? S.person(item.personId).name : '';
      el.innerHTML =
        '<span class="tl__num mono">' + roman(i + 1) + '</span>' +
        '<div class="tl__card">' +
          '<h3 class="tl__title">' + esc(item.title || '') + '</h3>' +
          '<p class="tl__text">' + esc(item.text || '') + '</p>' +
          '<div class="tl__actions">' +
            '<button class="btn btn--ghost btn--sm" data-act="edit">改这一条</button>' +
            '<button class="btn btn--danger btn--sm" data-act="remove">删除</button>' +
          '</div>' +
        '</div>' +
        '<div class="tl__axis"><span class="tl__dot"></span><span class="tl__year">' + esc(item.year || '') + '</span><span class="tl__age">' + esc(item.age || '') + (owner ? ' · ' + esc(owner) : '') + '</span></div>';
      box.appendChild(el);
    });
  }

  /* --------------------------------------------------------- 留言与献花 */
  /* 留言写给谁：支持四个人物 id，以及自定义称呼 custom:名字 */
  function noteTargetLabel(personId) {
    if (!personId) return '';
    if (personId.indexOf('custom:') === 0) {
      const name = personId.slice(7).trim();
      return name ? '写给 ' + name : '';
    }
    const p = S.person(personId);
    return p ? '写给 ' + p.name : '';
  }

  function renderNotes(sel, scopePerson) {
    const box = $(sel);
    if (!box) return;
    const list = S.notesOf(scopePerson);
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="empty" style="break-inside:avoid">' + icon('mail') + '<p><strong>还没有人留言</strong></p><p>你可以是第一个。</p></div>';
      return;
    }
    list.forEach((n) => {
      const el = document.createElement('article');
      el.className = 'note reveal';
      el.dataset.id = n.id;
      el.style.setProperty('--tilt', hashTilt(n.id + n.name) + 'deg');
      const to = noteTargetLabel(n.personId);
      el.innerHTML =
        '<div class="note__head"><span class="note__who">' + esc(n.name || '匿名') + '</span>' + (to ? '<span class="note__to">' + esc(to) + '</span>' : '') + '</div>' +
        '<p class="note__body">' + esc(n.text || '') + '</p>' +
        '<div class="note__foot">' +
          '<span class="note__time">' + fmtDate(n.at) + '</span>' +
          '<span class="note__spacer"></span>' +
          '<button class="flower-btn" data-act="flower" aria-label="献花">' + icon('flower', 'ico--fill') + '<span data-count>' + (n.flowers || 0) + '</span></button>' +
          '<button class="btn btn--danger btn--sm note__del" data-act="remove">删</button>' +
        '</div>';
      box.appendChild(el);
    });
  }

  function flowerBurst(x, y) {
    if (reduceMotion) return;
    const layer = document.createElement('div');
    layer.className = 'flower-wall';
    body.appendChild(layer);
    for (let i = 0; i < 16; i += 1) {
      const p = document.createElement('span');
      p.className = 'petal';
      p.style.left = Math.max(2, Math.min(96, x / window.innerWidth * 100 + (Math.random() - 0.5) * 22)) + '%';
      p.style.setProperty('--dx', ((Math.random() - 0.5) * 34).toFixed(1) + 'vw');
      p.style.setProperty('--rot', Math.round(240 + Math.random() * 540) + 'deg');
      p.style.setProperty('--dur', (5 + Math.random() * 4).toFixed(1) + 's');
      p.style.animationDelay = (i * 0.09).toFixed(2) + 's';
      p.innerHTML = icon('flower', 'ico--fill');
      layer.appendChild(p);
    }
    setTimeout(() => layer.remove(), 11000);
  }

  /* --------------------------------------------------------------- 唱片机 */
  const deck = {
    mounted: false,
    els: {},
    tracks: [],

    mount() {
      const root = $('[data-deck]');
      if (!root || this.mounted) return;
      this.mounted = true;
      this.els = {
        root,
        disc: $('[data-disc]', root),
        name: $('[data-deck-name]', root),
        sub: $('[data-deck-sub]', root),
        toggle: $('[data-deck-toggle]', root),
        prev: $('[data-deck-prev]', root),
        next: $('[data-deck-next]', root),
        seek: $('[data-seek]', root),
        fill: $('[data-seek-fill]', root),
        knob: $('[data-seek-knob]', root),
        cur: $('[data-time-cur]', root),
        dur: $('[data-time-dur]', root),
        vol: $('[data-deck-vol]', root),
        list: $('[data-playlist]'),
      };

      const player = M.player;
      player.on('track', (p) => {
        this.els.name.textContent = p.track.title || '未命名音轨';
        this.els.sub.textContent = p.track.note || (p.track.seed ? '示例音轨 · 请替换' : '私人歌单');
        $$('.track', this.els.list).forEach((el, i) => el.classList.toggle('is-current', i === p.index));
      });
      player.on('state', () => {
        const playing = player.playing;
        this.els.disc.classList.toggle('is-playing', playing);
        this.els.toggle.classList.toggle('is-on', playing);
        this.els.toggle.setAttribute('aria-label', playing ? '暂停' : '播放');
      });
      player.on('time', () => {
        const a = player.audio;
        const d = a && isFinite(a.duration) ? a.duration : 0;
        const c = a ? a.currentTime : 0;
        const r = d ? c / d : 0;
        this.els.fill.style.width = (r * 100).toFixed(2) + '%';
        this.els.knob.style.left = (r * 100).toFixed(2) + '%';
        this.els.cur.textContent = M.fmtTime(c);
        this.els.dur.textContent = M.fmtTime(d);
      });
      player.on('error', (p) => {
        if (p && p.reason === 'missing') toast('这条音轨的文件已不在本地库中，请重新上传', 'warn');
        else if (p && p.reason === 'blocked') toast('浏览器拦截了自动播放，请再点一次播放键', 'warn');
      });

      this.els.toggle.addEventListener('click', () => player.toggle());
      this.els.prev.addEventListener('click', () => player.prev());
      this.els.next.addEventListener('click', () => player.next(false));
      this.els.seek.addEventListener('click', (e) => {
        const r = this.els.seek.getBoundingClientRect();
        player.seek((e.clientX - r.left) / r.width);
      });
      this.els.vol.addEventListener('input', () => player.setVolume(parseFloat(this.els.vol.value)));

      this.refresh();
    },

    async refresh() {
      if (!this.mounted) return;
      const showSeeds = S.seeded || !S.hasRealTracks(isPersonPage ? personId : '');
      this.tracks = S.tracksOf(isPersonPage ? personId : '').filter((t) => showSeeds || !t.seed);
      const list = this.els.list;
      if (list) {
        list.innerHTML = '';
        this.tracks.forEach((t, i) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'track' + (t.seed ? ' track--seed' : '');
          btn.innerHTML =
            '<span class="track__idx mono">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<span class="track__body"><span class="track__name">' + esc(t.title || '未命名音轨') + '</span>' +
            '<span class="track__note">' + esc(t.note || (t.seed ? '示例音轨 · 请替换' : '')) + '</span></span>' +
            '<span class="track__tools"><span class="icon-btn" data-act="remove" title="移除" style="width:1.9rem;height:1.9rem">' + icon('close') + '</span></span>';
          btn.addEventListener('click', (e) => {
            if (e.target.closest('[data-act="remove"]')) {
              e.stopPropagation();
              S.removeTrack(t.id);
              this.refresh();
              return;
            }
            M.player.cue(i, true);
          });
          li.appendChild(btn);
          list.appendChild(li);
        });
        const add = document.createElement('li');
        add.innerHTML = '<button type="button" class="track track--add" data-add-track>' + icon('plus') + '<span class="track__name" style="margin-left:.6rem;font-size:.92rem">上传你们的音乐</span></button>';
        list.appendChild(add);
      }
      if (!this.tracks.length) {
        this.els.name.textContent = '还没有音轨';
        this.els.sub.textContent = '上传一首歌，让它留在这里';
      } else {
        await M.player.load(this.tracks);
      }
    },

    addTrack() {
      const input = document.createElement('input');
      input.type = 'file';
      // 只收 mp3：其它格式各浏览器支持不一，统一最省事
      input.accept = 'audio/mpeg,.mp3';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg') {
          toast('请选择 mp3 文件（其它格式浏览器支持不一）', 'warn');
          return;
        }
        const kind = 'audio';
        let src = '';
        let fileId = '';
        if (file.size <= 12 * 1024 * 1024) {
          src = await readAsDataURL(file);
        } else {
          fileId = await M.putFile({ blob: file, name: file.name, kind, personId });
        }
        const title = window.prompt('这首曲子叫什么？', file.name.replace(/\.[^.]+$/, '')) || file.name;
        const note = window.prompt('想为它写一句什么？（可留空）', '') || '';
        S.addTrack({ personId, title, note, src, fileId });
        S.clearSeed();
        S.save({ type: 'track', action: 'bulk' });
        toast('已加入《' + title + '》');
        this.refresh();
      });
      input.click();
    },
  };

  /* ----------------------------------------------------- 氛围音效 / 主题 */
  function setupAmbient() {
    const btn = $('[data-ambient]');
    if (!btn) return;
    btn.innerHTML = icon('candle');
    const saved = localStorage.getItem('vic-memorial:ambient') === '1';
    if (saved) {
      // 需要用户手势才能启动音频：仅在交互后再尝试
      const once = async () => {
        try {
          await M.drone.toggle();
          btn.classList.add('is-on');
        } catch (err) {
          /* 静默 */
        }
        document.removeEventListener('pointerdown', once);
      };
      document.addEventListener('pointerdown', once, { once: true });
    }
    btn.addEventListener('click', async () => {
      try {
        const on = await M.drone.toggle();
        btn.classList.toggle('is-on', on);
        localStorage.setItem('vic-memorial:ambient', on ? '1' : '0');
        toast(on ? '管风琴声起' : '归于安静');
      } catch (err) {
        toast('当前浏览器不支持音频合成', 'warn');
      }
    });
  }

  function setupTheme() {
    const btn = $('[data-theme-toggle]');
    const saved = localStorage.getItem('vic-memorial:theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const paint = () => {
      if (!btn) return;
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      btn.innerHTML = icon(dark ? 'sun' : 'moon');
      btn.setAttribute('aria-label', dark ? '切换到明亮（白昼）' : '切换到幽暗（夜晚）');
    };
    paint();
    if (btn) {
      btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('vic-memorial:theme', next);
        paint();
        toast(next === 'light' ? '白昼：羊皮纸与墨' : '夜晚：烛火与石');
      });
    }
  }

  /* --------------------------------------------------------- 滚动与氛围 */
  function setupReveal() {
    const els = $$('.reveal');
    if (!els.length) return;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const siblings = Array.prototype.slice.call(e.target.parentElement ? e.target.parentElement.children : []);
          const idx = Math.max(0, siblings.indexOf(e.target));
          e.target.style.transitionDelay = Math.min(idx * 70, 420) + 'ms';
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );
    els.forEach((el) => io.observe(el));
  }

  function setupTracker() {
    const tracker = $('[data-tracker]');
    const bar = $('[data-tracker-fill]');
    if (!tracker || !bar) return;
    const update = () => {
      const r = tracker.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = r.height - vh * 0.4;
      const passed = vh * 0.6 - r.top;
      const pct = Math.max(0, Math.min(100, (passed / Math.max(1, total)) * 100));
      bar.style.setProperty('--fill', pct.toFixed(1) + '%');
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  function setupMasthead() {
    const head = $('.masthead');
    const top = $('[data-to-top]');
    const onScroll = () => {
      const y = window.scrollY;
      if (head) head.classList.toggle('is-stuck', y > 40);
      if (top) top.classList.toggle('is-visible', y > 700);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    if (top) {
      top.innerHTML = icon('arrowUp');
      top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
    }

    const toggle = $('[data-nav-toggle]');
    const nav = $('.nav');
    if (toggle && nav) {
      toggle.innerHTML = icon('menu');
      toggle.addEventListener('click', () => nav.classList.toggle('is-open'));
      $$('a', nav).forEach((a) => a.addEventListener('click', () => nav.classList.remove('is-open')));
    }

    // 当前小节高亮
    const links = $$('.nav a[href^="#"]');
    if (links.length && 'IntersectionObserver' in window) {
      const map = new Map();
      links.forEach((a) => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (target) map.set(target, a);
      });
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            links.forEach((l) => l.classList.remove('is-current'));
            const a = map.get(e.target);
            if (a) a.classList.add('is-current');
          });
        },
        { rootMargin: '-45% 0px -50% 0px' }
      );
      map.forEach((a, target) => io.observe(target));
    }
  }

  function setupLamp() {
    if (reduceMotion || window.matchMedia('(hover: none)').matches) return;
    const lamp = $('.lamp');
    if (!lamp) return;
    let raf = 0;
    let mx = 0.5;
    let my = 0.26;
    window.addEventListener(
      'pointermove',
      (e) => {
        mx = e.clientX / window.innerWidth;
        my = e.clientY / window.innerHeight;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          lamp.style.setProperty('--mx', (mx * 100).toFixed(2) + '%');
          lamp.style.setProperty('--my', (my * 100).toFixed(2) + '%');
        });
      },
      { passive: true }
    );
  }

  function setupDust() {
    const canvas = $('.dust');
    if (!canvas || reduceMotion || typeof canvas.getContext !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let motes = [];

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.width = Math.floor(window.innerWidth * dpr);
      h = canvas.height = Math.floor(window.innerHeight * dpr);
      const count = window.innerWidth < 700 ? 26 : 54;
      motes = new Array(count).fill(0).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.5 + 0.35) * dpr,
        vx: (Math.random() - 0.5) * 0.14 * dpr,
        vy: (-Math.random() * 0.16 - 0.03) * dpr,
        a: Math.random() * 0.42 + 0.08,
        p: Math.random() * Math.PI * 2,
      }));
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      motes.forEach((m) => {
        m.p += 0.012;
        m.x += m.vx + Math.sin(m.p) * 0.16 * dpr;
        m.y += m.vy;
        if (m.y < -8) {
          m.y = h + 8;
          m.x = Math.random() * w;
        }
        if (m.x < -8) m.x = w + 8;
        if (m.x > w + 8) m.x = -8;
        const alpha = m.a * (0.55 + 0.45 * Math.sin(m.p * 1.7));
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(224,195,131,' + alpha.toFixed(3) + ')';
        ctx.fill();
      });
      raf = requestAnimationFrame(tick);
    };

    let raf = 0;
    resize();
    tick();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else tick();
    });
  }

  /* ----------------------------------------------------------- 编辑模式 */
  const editor = {
    on: false,
    bar: null,

    init() {
      this.on = localStorage.getItem(editKey) === '1';
      this.buildBar();
      this.paint();
      if (this.on) this.bindEditable();
    },

    buildBar() {
      const bar = document.createElement('div');
      bar.className = 'editbar';
      bar.innerHTML =
        '<span class="editbar__label"><span class="pulse-dot"></span>编辑模式 · 改动即刻保存在本机</span>' +
        '<button class="btn btn--sm" data-e="timeline">' + icon('quill') + ' 添加时刻</button>' +
        '<button class="btn btn--sm" data-e="media">' + icon('image') + ' 上传影像</button>' +
        '<button class="btn btn--sm" data-e="track">' + icon('music') + ' 上传音乐</button>' +
        '<button class="btn btn--sm" data-e="export">' + icon('download') + ' 导出备份</button>' +
        '<button class="btn btn--sm" data-e="import">' + icon('layers') + ' 导入备份</button>' +
        '<button class="btn btn--sm btn--ghost" data-e="reset">' + icon('reset') + ' 恢复默认</button>' +
        '<button class="btn btn--sm btn--solid" data-e="done">' + icon('lock') + ' 完成</button>';
      body.appendChild(bar);
      this.bar = bar;

      bar.addEventListener('click', (e) => {
        const act = e.target.closest('[data-e]');
        if (!act) return;
        const k = act.dataset.e;
        if (k === 'done') return this.toggle(false);
        if (k === 'timeline') {
          const created = S.addTimelineFromDraft(isPersonPage ? personId : '');
          if (created) {
            S.clearSeed();
            renderTimeline('[data-timeline]', isPersonPage ? personId : '');
            this.bindEditable();
            toast('已添加一个时刻');
          }
          return;
        }
        if (k === 'media') return wall.pick();
        if (k === 'track') return deck.addTrack();
        if (k === 'export') return this.exportBackup();
        if (k === 'import') return this.importBackup();
        if (k === 'reset') return this.resetAll();
        return undefined;
      });
    },

    toggle(next) {
      this.on = typeof next === 'boolean' ? next : !this.on;
      localStorage.setItem(editKey, this.on ? '1' : '0');
      this.paint();
      if (this.on) {
        this.bindEditable();
        toast('编辑模式已开启：点任意文字直接修改，改动自动保存');
      } else {
        toast('编辑模式已关闭');
      }
    },

    paint() {
      body.classList.toggle('is-editing', this.on);
      if (this.bar) this.bar.classList.toggle('is-visible', this.on);
      const entry = $('[data-edit-toggle]');
      if (entry) {
        entry.innerHTML = icon(this.on ? 'lock' : 'lockOpen');
        entry.classList.toggle('is-on', this.on);
        entry.setAttribute('aria-label', this.on ? '退出编辑模式' : '进入编辑模式');
      }
      $$('[data-edit]').forEach((el) => {
        if (this.on) {
          try {
            el.setAttribute('contenteditable', 'plaintext-only');
            if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
          } catch (err) {
            el.setAttribute('contenteditable', 'true');
          }
          if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false');
        } else {
          el.removeAttribute('contenteditable');
        }
      });
    },

    bindEditable() {
      $$('[data-edit]').forEach((el) => {
        if (el.dataset.bound === '1') return;
        el.dataset.bound = '1';
        el.addEventListener('blur', () => {
          if (!this.on) return;
          const path = el.dataset.edit;
          if (!path) return;
          const before = S.getPath(path, '');
          const after = el.textContent.trim();
          if (before === after) return;
          S.setPath(path, after);
          S.save({ type: 'text', path });
          if (path.endsWith('.years') || path.endsWith('.dates')) applyText();
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && el.dataset.single !== undefined) {
            e.preventDefault();
            el.blur();
          }
          if (e.key === 'Escape') el.blur();
        });
      });
    },

    exportBackup() {
      const blob = new Blob([S.exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'memorial-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('已导出文字备份（照片视频在浏览器内部库中，换电脑需重新上传）');
    },

    importBackup() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          S.importData(await f.text());
          toast('已导入备份，正在刷新…');
          setTimeout(() => location.reload(), 700);
        } catch (err) {
          toast('导入失败：' + err.message, 'warn');
        }
      });
      input.click();
    },

    resetAll() {
      if (!window.confirm('将清空所有本机保存的文字与媒体索引（浏览器库中的文件也会被删除），恢复为初始内容。确定吗？')) return;
      (async () => {
        try {
          await M.clearAll();
          M.releaseAll();
        } catch (err) {
          /* 忽略 */
        }
        S.reset();
        toast('已恢复默认内容，正在刷新…');
        setTimeout(() => location.reload(), 700);
      })();
    },
  };

  /* --------------------------------------------------------- 事件总绑定 */
  function bindMediaGrid() {
    body.addEventListener('click', async (e) => {
      const tile = e.target.closest('.tile');
      if (!tile || tile.classList.contains('tile--add')) return;
      const id = tile.dataset.id;
      const rec = S.mediaOf(wall.scopePerson).find((m) => m.id === id);
      if (!rec) return;

      const tool = e.target.closest('[data-act]');
      if (tool) {
        const act = tool.dataset.act;
        if (act === 'remove') {
          if (!window.confirm('从相册墙移除《' + (rec.title || '未命名') + '》？')) return;
          if (rec.fileId) {
            try {
              await M.deleteFile(rec.fileId);
              M.releaseObjectURL(rec.fileId);
            } catch (err) {
              /* 忽略 */
            }
          }
          S.removeMedia(id);
          await wall.refresh();
          return;
        }
        if (act === 'title') {
          const t = window.prompt('标题', rec.title || '');
          if (t === null) return;
          const c = window.prompt('一句说明（可留空）', rec.caption || '');
          S.updateMedia(id, { title: t.trim(), caption: c === null ? rec.caption : c.trim() });
          await wall.refresh();
          return;
        }
        if (act === 'owner') {
          const who = window.prompt('归属：填 p1 / p2 / p3 / p4 之一，留空为公共', rec.personId || '');
          if (who === null) return;
          const v = who.trim();
          S.updateMedia(id, { personId: ['p1', 'p2', 'p3', 'p4'].includes(v) ? v : '' });
          await wall.refresh();
          return;
        }
        return;
      }

      // 打开灯箱
      const items = wall.records.map((m) => Object.assign({}, m, {
        personName: m.personId && S.person(m.personId) ? S.person(m.personId).name : '',
      }));
      const idx = wall.records.findIndex((m) => m.id === id);
      lightbox.open(items, Math.max(0, idx));
    });
  }

  function bindNotes() {
    const board = $('[data-notes]');
    if (board) {
      board.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const note = e.target.closest('.note');
        if (!note) return;
        const id = note.dataset.id;
        if (btn.dataset.act === 'flower') {
          const n = S.flowerNote(id, 1);
          const count = $('[data-count]', btn);
          if (count) count.textContent = n;
          const r = btn.getBoundingClientRect();
          flowerBurst(r.left + r.width / 2, r.top);
          return;
        }
        if (btn.dataset.act === 'remove') {
          if (!window.confirm('删除这条留言？')) return;
          S.removeNote(id);
          renderNotes('[data-notes]', isPersonPage ? personId : '');
        }
      });
    }

    const form = $('[data-letter-form]');
    if (form) {
      const text = $('textarea', form);
      const counter = $('[data-counter]', form);

      // 「写给」：选项跟随四人当前的名字生成，末尾另加「自己写一个…」
      const picker = $('[data-letter-picker]', form);
      const select = picker ? $('select', picker) : $('[data-letter-target]', form);
      const customWrap = $('[data-letter-custom]', form);
      const customInput = $('[name="toCustom"]', form);
      const isSelect = !!(select && select.tagName === 'SELECT');

      const syncCustom = () => {
        if (!isSelect || !customWrap) return;
        const isCustom = select.value === '__custom__';
        customWrap.hidden = !isCustom;
        if (isCustom && customInput) customInput.focus();
      };

      const syncPicker = () => {
        if (!isSelect) return;
        const keep = select.value;
        select.innerHTML = '';
        const all = document.createElement('option');
        all.value = '';
        all.textContent = '所有人';
        select.appendChild(all);
        S.people().forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name || p.id;
          select.appendChild(opt);
        });
        const other = document.createElement('option');
        other.value = '__custom__';
        other.textContent = '自己写一个…';
        select.appendChild(other);
        const opts = select.options ? Array.prototype.slice.call(select.options) : select.children;
        select.value = opts.some((o) => o.getAttribute('value') === keep) ? keep : '';
        syncCustom();
      };

      if (isSelect) {
        select.addEventListener('change', syncCustom);
        syncPicker();
        if (isPersonPage) select.value = personId; // 人物页默认写给这个人
      }

      const sync = () => {
        if (counter) counter.textContent = (text.value || '').length + ' / 600';
      };
      if (text) {
        text.addEventListener('input', sync);
        sync();
      }

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = ($('[name="who"]', form).value || '').trim() || '匿名';
        const body = ($('[name="what"]', form).value || '').trim();
        if (!body) {
          toast('写点什么再寄出去吧', 'warn');
          return;
        }
        let to = select ? select.value : '';
        if (to === '__custom__') {
          const custom = ((customInput && customInput.value) || '').trim();
          to = custom ? 'custom:' + custom.slice(0, 20) : '';
        }
        S.addNote({ name, text: body.slice(0, 600), personId: to });
        form.reset();
        if (customWrap) customWrap.hidden = true;
        syncPicker();
        sync();
        renderNotes('[data-notes]', isPersonPage ? personId : '');
        const list = $('[data-notes]');
        if (list && list.firstElementChild) list.firstElementChild.classList.add('is-in');
        toast('留言已留下，它会一直在这里');
      });
    }
  }

  function bindTimeline() {
    const box = $('[data-timeline]');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const item = e.target.closest('.tl');
      if (!item) return;
      const id = item.dataset.id;
      if (btn.dataset.act === 'remove') {
        if (!window.confirm('删除这个时刻？')) return;
        S.removeTimeline(id);
        renderTimeline('[data-timeline]', isPersonPage ? personId : '');
        editor.bindEditable();
        return;
      }
      if (btn.dataset.act === 'edit') {
        const rec = S.all.timeline.find((t) => t.id === id);
        if (!rec) return;
        const draft =
          window.prompt('按「年份 | 年龄 | 标题 | 一句话」修改：', [rec.year, rec.age, rec.title, rec.text].join(' | '));
        if (draft === null) return;
        const [year, age, title, text] = draft.split('|').map((s) => (s || '').trim());
        S.updateTimeline(id, { year, age, title, text });
        renderTimeline('[data-timeline]', isPersonPage ? personId : '');
      }
    });
  }

  function bindPortraits() {
    const picker = (key) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const src = f.size <= 12 * 1024 * 1024 ? await readAsDataURL(f) : '';
        const fileId = src ? '' : await M.putFile({ blob: f, name: f.name, kind: 'image', personId: key });
        try {
          localStorage.setItem('vic-memorial:portrait:' + key, JSON.stringify({ src, fileId }));
        } catch (err) {
          toast('这张照片太大，无法存为肖像，请换一张小一点的', 'warn');
          return;
        }
        S.clearSeed();
        S.save({ type: 'portrait', id: key });
        await applyPortraits();
        toast('已换上新的肖像');
      });
      input.click();
    };

    $$('[data-portrait]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (!editor.on || e.target.closest('[data-portrait-edit]')) return;
        picker(el.dataset.portrait);
      });
    });
    $$('[data-portrait-edit]').forEach((btn) => {
      btn.innerHTML = icon('image');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        picker(btn.dataset.portraitEdit);
      });
    });
  }

  async function applyPortraits() {
    const slots = $$('[data-portrait]');
    for (const el of slots) {
      const key = el.dataset.portrait;
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem('vic-memorial:portrait:' + key) || 'null');
      } catch (err) {
        saved = null;
      }
      const media = S.mediaOf(key);
      const latest = media.filter((m) => m.kind === 'image' && !m.seed).slice(-1)[0];
      let src = '';
      if (latest) {
        src = latest.src || (latest.fileId ? await M.useObjectURL(latest.fileId) : '');
      } else if (saved) {
        src = saved.src || (saved.fileId ? await M.useObjectURL(saved.fileId) : '');
      } else if (S.seeded) {
        const seed = media.find((m) => m.seed && m.kind === 'image');
        if (seed) src = seed.src;
      }
      const holder = $('[data-portrait-media]', el);
      if (!holder) continue;
      if (src) {
        holder.innerHTML = '<img src="' + esc(src) + '" alt="' + esc((S.person(key) || {}).name || '肖像') + '">';
        holder.classList.add('has-image');
        const hint = $('[data-portrait-hint]', el);
        if (hint) hint.style.display = 'none';
      }
    }
  }

  /* --------------------------------------------------------------- 启动 */
  async function boot() {
    // 调试/截图用：?smooth=0 关闭平滑滚动，让锚点跳转瞬时完成
    try {
      const params = new URLSearchParams(location.search);
      if (params.get('smooth') === '0' || params.get('preview') === '1') {
        document.documentElement.style.scrollBehavior = 'auto';
      }
    } catch (err) { /* 忽略 */ }

    await personInit();
    applyText();
    fillEditable();
    setupTheme();
    setupMasthead();
    setupAmbient();
    setupLamp();
    setupDust();

    renderTimeline('[data-timeline]', isPersonPage ? personId : '');
    renderNotes('[data-notes]', isPersonPage ? personId : '');
    await applyPortraits();
    await applyAvatars();

    editor.init();
    await wall.mount('[data-wall]', { personId: isPersonPage ? personId : '' });
    bindMediaGrid();
    bindNotes();
    bindTimeline();
    bindPortraits();

    if (isPersonPage) deck.mount();
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-track]')) {
        e.preventDefault();
        deck.addTrack();
      }
    });

    setupTracker();

    // 编辑模式的入口按钮
    $$('[data-edit-toggle]').forEach((b) => b.addEventListener('click', () => editor.toggle()));

    // 相册墙的显式上传按钮
    $$('[data-wall-upload]').forEach((b) => b.addEventListener('click', () => wall.pick()));

    // 计数器
    $$('[data-count-of]').forEach((el) => {
      const what = el.dataset.countOf;
      const scope = el.dataset.scope || (isPersonPage ? personId : '');
      let n = 0;
      if (what === 'media') n = S.mediaOf(scope).filter((m) => S.seeded || !m.seed).length;
      if (what === 'notes') n = S.notesOf(scope).length;
      if (what === 'timeline') n = S.timelineOf(scope).length;
      if (what === 'flowers') n = S.notesOf(scope).reduce((a, b) => a + (b.flowers || 0), 0);
      el.textContent = n;
    });

    setupReveal();

    if (S.seeded && !editor.on) {
      setTimeout(() => toast('这是示例内容：点右下角的锁形按钮，即可改成你们自己的故事', 'warn'), 1400);
    }

    M.player.setVolume(0.8);
    const vol = $('[data-deck-vol]');
    if (vol) vol.value = '0.8';

    S.onChange((evt) => {
      if (!evt) return;
      if (evt.type === 'media') wall.refresh();
      if (evt.type === 'track') deck.refresh();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.App = { toast, lightbox, wall, deck, editor, flowerBurst, icon };
})();
