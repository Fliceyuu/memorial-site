/* ============================================================================
 * store.js — 数据层
 *   默认内容 · localStorage 持久化 · 点路径读写 · 导入导出
 *   媒体二进制在 IndexedDB（见 media.js），这里只保存文字与引用。
 * ==========================================================================*/
(function () {
  'use strict';

  const KEY = 'vic-memorial:v1';
  const YEAR = new Date().getFullYear();

  /* 空音轨占位：一段合法但静音的 wav（约 0.3 秒），让示例音轨可点击、可讲解 */
  const SILENT_WAV =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

  /* ----------------------------------------------------- 示例素材占位图 */
  function placeholderSVG(opts) {
    const o = opts || {};
    const numeral = o.numeral || 'I';
    const title = o.title || '待补充';
    const sub = o.sub || 'SAMPLE PLATE';
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">',
      '<defs>',
      '<linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">',
      '<stop offset="0" stop-color="#1c1725"/><stop offset="0.55" stop-color="#100d15"/><stop offset="1" stop-color="#08070a"/>',
      '</linearGradient>',
      '<radialGradient id="r" cx="0.5" cy="0.62" r="0.62">',
      '<stop offset="0" stop-color="#c3a05a" stop-opacity="0.16"/><stop offset="1" stop-color="#c3a05a" stop-opacity="0"/>',
      '</radialGradient>',
      '<pattern id="h" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
      '<line x1="0" y1="0" x2="0" y2="18" stroke="#c3a05a" stroke-opacity="0.07" stroke-width="1"/>',
      '</pattern>',
      '</defs>',
      '<rect width="900" height="1200" fill="url(#g)"/>',
      '<rect width="900" height="1200" fill="url(#h)"/>',
      '<rect width="900" height="1200" fill="url(#r)"/>',
      '<g fill="none" stroke="#c3a05a" stroke-opacity="0.4">',
      '<rect x="46" y="46" width="808" height="1108" stroke-width="1"/>',
      '<rect x="66" y="66" width="768" height="1068" stroke-width="1" stroke-opacity="0.28"/>',
      '</g>',
      '<g stroke="#c3a05a" stroke-opacity="0.55" stroke-width="1.4" fill="none">',
      '<path d="M70 210 h120 M70 210 v-120"/><path d="M830 210 h-120 M830 210 v-120"/>',
      '<path d="M70 990 h120 M70 990 v120"/><path d="M830 990 h-120 M830 990 v120"/>',
      '</g>',
      '<g stroke="#c3a05a" stroke-opacity="0.5" fill="none" stroke-width="1.2">',
      '<circle cx="450" cy="520" r="150"/>',
      '<circle cx="450" cy="520" r="176" stroke-opacity="0.22"/>',
      '<path d="M450 330 l132 190 -132 190 -132 -190 z" stroke-opacity="0.35"/>',
      '<path d="M300 520 h300 M450 344 v352" stroke-opacity="0.18"/>',
      '</g>',
      '<text x="450" y="576" text-anchor="middle" font-family="Georgia,serif" font-size="150" fill="#c3a05a" fill-opacity="0.85">' + numeral + '</text>',
      '<text x="450" y="820" text-anchor="middle" font-family="Georgia,serif" font-size="46" letter-spacing="10" fill="#ece2cd" fill-opacity="0.72">' + title + '</text>',
      '<text x="450" y="880" text-anchor="middle" font-family="Georgia,serif" font-size="22" letter-spacing="7" fill="#c3a05a" fill-opacity="0.6">' + sub + '</text>',
      '<text x="450" y="1092" text-anchor="middle" font-family="Georgia,serif" font-size="19" letter-spacing="6" fill="#ece2cd" fill-opacity="0.3">A PLACE FOR YOUR OWN PHOTOGRAPH</text>',
      '</svg>',
    ].join('');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* --------------------------------------------------------------- 默认内容 */
  function defaults() {
    return {
      seeded: true,
      site: {
        title: '四人纪念',
        titleEn: 'In Memoriam Quattuor',
        eyebrow: 'A Vigil for Four · 青春纪念',
        heroVerse:
          '谨以此册，纪念我们的青春 —— 纪念那四个曾在同一条走廊里、把彼此的名字写进生命的人。',
        story:
          '我们从同一段年月里走出来：一起逃过的晚自习，一起守过的天台与星空，一起把校服穿旧、把校歌跑调。后来各自远行，散落在不同的城市与季节；可是有些东西没有散 —— 那四张脸一凑齐，十五岁的风就重新吹过来。',
        years: '2014 — ' + YEAR,
        footerVerse: '凡我们记得的，都不会真正离去。',
        mottoVow: '四人不散，散必重逢。',
      },
      people: {
        p1: {
          name: '阿尘',
          nameEn: 'Chen',
          dates: '1999 — 2017',
          epithet: '我们的锚',
          quote: '我不擅长说想念，只擅长等你们回来。',
          words: '我们四个里，你最先学会把话说轻。天台的铁门是你发现的那把备用钥匙；每一次散场，都是你最后一个走、把灯关掉。你总说"没事"，然后把所有事都做完。',
          sigil: 'I',
          verse: '记住风，记住天台风大。',
        },
        p2: {
          name: '阿屿',
          nameEn: 'Yu',
          dates: '1999 — 2019',
          epithet: '把沉默说得好听的人',
          quote: '有些人不必大声，风也会替她传信。',
          words: '你话最少，心思最密。你记得每个人不吃什么、怕什么、哪首歌听到一半会哭。你把想说的话折成纸船放进抽屉，我们后来才一封一封读到。',
          sigil: 'II',
          verse: '有些话，交给海。',
        },
        p3: {
          name: '小满',
          nameEn: 'Xiaoman',
          dates: '2000 — 2018',
          epithet: '最亮的那一瞬',
          quote: '青春太短了，所以要笑得很响。',
          words: '你的笑声是那几年最响的东西。课间十分钟你能讲完一个完整的故事，晚自习你能把六十个人的困都逗散。你把照片拍得很歪，却是我们唯一留下来的一批现场。',
          sigil: 'III',
          verse: '愿笑声先于我们抵达明天。',
        },
        p4: {
          name: '鹿野',
          nameEn: 'Luye',
          dates: '1999 — ' + YEAR,
          epithet: '把青春过成一场远征',
          quote: '山河尚远，我先替你们去看看。',
          words: '你退学、远行、翻过很多山，寄回来一些很难看的明信片和很好看的字。你说等我们老了，你要用这些年的路，换我们三个一整个下午。',
          sigil: 'IV',
          verse: '路还长，我们替彼此走。',
        },
      },
      timeline: [
        {
          id: 't1',
          year: '2014',
          age: '十五岁',
          title: '停电的晚自习·初识',
          text: '整栋教学楼停电的四十分钟。你在讲台上点了一支蜡烛，我们四个第一次把名字凑齐。',
          personId: 'p1',
        },
        {
          id: 't2',
          year: '2015',
          age: '十六岁',
          title: '天台计划',
          text: '撬开天台那把锁，从此有了属于四个人的秘密基地。啤酒、吉他、和一整片不肯睡的城市。',
          personId: 'p2',
        },
        {
          id: 't3',
          year: '2016',
          age: '十七岁',
          title: '第一次把校歌跑调唱完',
          text: '毕业晚会前一夜，我们把校歌唱成了自己的版本，第二天被罚站整整两小时 —— 谁也没有后悔。',
          personId: 'p3',
        },
        {
          id: 't4',
          year: '2017',
          age: '十八岁',
          title: '毕业照与那句"别断联"',
          text: '六月，操场，四人合影。快门按下之前，你说了那句后来被我们重复了十年的话。',
          personId: 'p4',
        },
        {
          id: 't5',
          year: '2018',
          age: '十九岁',
          title: '第一个人先走',
          text: '春天最短的那几天，我们学会了怎么把一个人留在照片里。有些告别来不及彩排。',
          personId: 'p3',
        },
        {
          id: 't6',
          year: '2019',
          age: '二十岁',
          title: '未完的信',
          text: '我们把没来得及寄出去的信，一封一封读给了风听。从此每年这天，天台都亮一盏灯。',
          personId: 'p2',
        },
        {
          id: 't7',
          year: '2021',
          age: '二十二岁',
          title: '第一次以"我们三个"重聚',
          text: '在陌生的城市点了一桌四个人的菜。服务员问几位，我们谁也没有回答。',
          personId: 'p1',
        },
        {
          id: 't8',
          year: '2024',
          age: '二十五岁',
          title: '把这个地方建起来',
          text: '照片会黄，音乐会停，人会走散。所以我们决定造一座房子，把青春原样收好。',
          personId: 'p4',
        },
      ],
      notes: [
        { id: 'n1', name: '小满', personId: '', text: '喂，四个人的群我又建了一个。这次谁都不许退。', at: '2024-06-01T21:14:00', flowers: 12 },
        { id: 'n2', name: '鹿野', personId: '', text: '我在海拔三千七的地方替你们看了星星。真的比天台亮，但没有你们吵。', at: '2024-06-02T02:03:00', flowers: 21 },
        { id: 'n3', name: '匿名', personId: 'p1', text: '你借我的那本《百年孤独》还压在我桌上。我知道你已经不看了，但我一直没舍得还。', at: '2024-06-07T19:48:00', flowers: 9 },
        { id: 'n4', name: '阿屿', personId: 'p3', text: '今年也在你的生日订了蛋糕，插了蜡烛，然后我们三个替你吹了。', at: '2024-06-11T23:59:00', flowers: 34 },
        { id: 'n5', name: '阿尘', personId: 'p2', text: '你说的那首歌我找到了，在旧磁带里。等我转成 mp3 传上来。', at: '2024-06-15T07:22:00', flowers: 7 },
        { id: 'n6', name: '路过的同学', personId: '', text: '我不认识他们，但看完这一页哭了。愿你们都被记得。', at: '2024-06-20T14:05:00', flowers: 5 },
      ],
      media: [
        { id: 'i-seed-1', kind: 'image', title: '四人合影·第一版', caption: '天台，黄昏，我们没有一个人在看镜头。', personId: 'p1', seed: true, src: placeholderSVG({ numeral: 'I', title: '四人合影', sub: 'THE FOUR · SAMPLE' }) },
        { id: 'i-seed-2', kind: 'image', title: '停电的晚自习', caption: '四十支蜡烛，和整整一栋楼的安静。', personId: 'p2', seed: true, src: placeholderSVG({ numeral: 'II', title: '晚自习', sub: 'CANDLELIGHT · SAMPLE' }) },
        { id: 'i-seed-3', kind: 'image', title: '毕业照', caption: '快门按下之前，你说了那句不要断联。', personId: 'p3', seed: true, src: placeholderSVG({ numeral: 'III', title: '毕业照', sub: 'GRADUATION · SAMPLE' }) },
        { id: 'i-seed-4', kind: 'image', title: '远行寄回的明信片', caption: '字很好看，照片很难看，这就是你。', personId: 'p4', seed: true, src: placeholderSVG({ numeral: 'IV', title: '明信片', sub: 'POSTCARD · SAMPLE' }) },
        { id: 'v-seed-1', kind: 'video', title: '天台夜谈·片段', caption: '示例视频位 —— 点相册墙右下角，换成你们真正的视频。', personId: 'p2', seed: true, src: '' },
      ],
      tracks: [
        { id: 'a1', personId: 'p1', title: '那年的校歌（跑调版）', note: '示例音轨 · 请替换为你们的文件', src: SILENT_WAV, seed: true },
        { id: 'a2', personId: 'p1', title: '深夜电台片头', note: '示例音轨 · 请替换为你们的文件', src: SILENT_WAV, seed: true },
        { id: 'a3', personId: 'p2', title: '旧磁带 · A 面', note: '示例音轨 · 请替换为你们的文件', src: SILENT_WAV, seed: true },
        { id: 'a4', personId: 'p3', title: '毕业晚会现场', note: '示例音轨 · 请替换为你们的文件', src: SILENT_WAV, seed: true },
        { id: 'a5', personId: 'p4', title: '路上的风（自己录的）', note: '示例音轨 · 请替换为你们的文件', src: SILENT_WAV, seed: true },
      ],
    };
  }

  /* --------------------------------------------------------------- 存取 */
  function deepClone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      const base = defaults();
      const data = Object.assign(base, parsed);
      data.site = Object.assign(base.site, parsed.site || {});
      data.people = Object.assign(base.people, parsed.people || {});
      ['timeline', 'notes', 'media', 'tracks'].forEach((k) => {
        if (!Array.isArray(data[k])) data[k] = base[k];
      });
      return data;
    } catch (err) {
      console.warn('读取本地数据失败，回退到默认内容：', err);
      return defaults();
    }
  }

  let data = load();
  const listeners = new Set();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('保存失败（可能是隐私模式或容量超限）：', err);
      return false;
    }
  }

  function emit(evt) {
    listeners.forEach((fn) => {
      try {
        fn(evt, data);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function save(evt) {
    const ok = persist();
    emit(evt || { type: 'save' });
    return ok;
  }

  /* 点路径读写：'site.title' / 'people.p1.name' */
  function getPath(path, fallback) {
    const parts = String(path).split('.');
    let cur = data;
    for (const p of parts) {
      if (cur === null || cur === undefined || !(p in cur)) return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  }

  function setPath(path, value) {
    const parts = String(path).split('.');
    let cur = data;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    return value;
  }

  /* ----------------------------------------------------- 收藏级操作 */
  function people() {
    return ['p1', 'p2', 'p3', 'p4'].map((id) => Object.assign({ id }, data.people[id]));
  }

  function person(id) {
    return data.people[id] ? Object.assign({ id }, data.people[id]) : null;
  }

  function timelineOf(personId) {
    const list = personId ? data.timeline.filter((t) => t.personId === personId || !t.personId) : data.timeline;
    return list.slice().sort((a, b) => String(a.year).localeCompare(String(b.year)));
  }

  function addTimeline(entry) {
    const item = Object.assign({ id: 't' + Date.now().toString(36), year: String(YEAR), age: '', title: '新的时刻', text: '', personId: '' }, entry);
    data.timeline.push(item);
    save({ type: 'timeline', action: 'add', id: item.id });
    return item;
  }

  function updateTimeline(id, patch) {
    const item = data.timeline.find((t) => t.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    save({ type: 'timeline', action: 'update', id });
    return item;
  }

  function removeTimeline(id) {
    data.timeline = data.timeline.filter((t) => t.id !== id);
    save({ type: 'timeline', action: 'remove', id });
  }

  /* 从草稿创建：年份/年龄/标题/正文 用 | 分隔单行输入 */
  function addTimelineFromDraft(personId) {
    const draft = window.prompt('按「年份 | 年龄 | 标题 | 一句话」填写，用竖线分隔：', YEAR + ' |  | 新的时刻 | ');
    if (draft === null) return null;
    const [year, age, title, text] = draft.split('|').map((s) => (s || '').trim());
    return addTimeline({ year: year || String(YEAR), age: age || '', title: title || '新的时刻', text: text || '', personId: personId || '' });
  }

  function mediaOf(personId) {
    const list = personId ? data.media.filter((m) => m.personId === personId) : data.media.slice();
    return list;
  }

  function addMedia(rec) {
    const item = Object.assign({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'image' }, rec);
    data.media.push(item);
    save({ type: 'media', action: 'add', id: item.id });
    return item;
  }

  function updateMedia(id, patch) {
    const item = data.media.find((m) => m.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    save({ type: 'media', action: 'update', id });
    return item;
  }

  function removeMedia(id) {
    const item = data.media.find((m) => m.id === id);
    data.media = data.media.filter((m) => m.id !== id);
    save({ type: 'media', action: 'remove', id });
    return item;
  }

  function hasRealMedia(personId) {
    return data.media.some((m) => !m.seed && (!personId || m.personId === personId));
  }

  function notesOf(personId) {
    const list = personId ? data.notes.filter((n) => n.personId === personId) : data.notes.slice();
    return list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  function addNote(rec) {
    const item = Object.assign(
      { id: 'n' + Date.now().toString(36), name: '匿名', personId: '', text: '', at: new Date().toISOString(), flowers: 0 },
      rec
    );
    data.notes.push(item);
    save({ type: 'note', action: 'add', id: item.id });
    return item;
  }

  function removeNote(id) {
    data.notes = data.notes.filter((n) => n.id !== id);
    save({ type: 'note', action: 'remove', id });
  }

  function flowerNote(id, delta) {
    const item = data.notes.find((n) => n.id === id);
    if (!item) return 0;
    item.flowers = Math.max(0, (item.flowers || 0) + (delta || 1));
    save({ type: 'note', action: 'flower', id });
    return item.flowers;
  }

  function tracksOf(personId) {
    return data.tracks.filter((t) => !personId || t.personId === personId);
  }

  function hasRealTracks(personId) {
    return data.tracks.some((t) => !t.seed && (!personId || t.personId === personId));
  }

  function addTrack(rec) {
    const item = Object.assign({ id: 'a' + Date.now().toString(36), personId: '', title: '未命名音轨', note: '' }, rec);
    data.tracks.push(item);
    save({ type: 'track', action: 'add', id: item.id });
    return item;
  }

  function removeTrack(id) {
    const item = data.tracks.find((t) => t.id === id);
    data.tracks = data.tracks.filter((t) => t.id !== id);
    save({ type: 'track', action: 'remove', id });
    return item;
  }

  /* ------------------------------------------------------- 导入 / 导出 */
  function exportData() {
    return JSON.stringify(data, null, 2);
  }

  function importData(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.people) throw new Error('文件格式不正确');
    data = Object.assign(defaults(), parsed);
    save({ type: 'import' });
    return data;
  }

  function reset() {
    data = defaults();
    save({ type: 'reset' });
    return data;
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.Store = {
    KEY,
    placeholderSVG,
    SILENT_WAV,
    defaults,
    get all() {
      return data;
    },
    get seeded() {
      return !!data.seeded;
    },
    clearSeed() {
      data.seeded = false;
      persist();
    },
    getPath,
    setPath,
    save,
    onChange,
    people,
    person,
    timelineOf,
    addTimeline,
    updateTimeline,
    removeTimeline,
    addTimelineFromDraft,
    mediaOf,
    addMedia,
    updateMedia,
    removeMedia,
    hasRealMedia,
    notesOf,
    addNote,
    removeNote,
    flowerNote,
    tracksOf,
    hasRealTracks,
    addTrack,
    removeTrack,
    exportData,
    importData,
    reset,
  };
})();
