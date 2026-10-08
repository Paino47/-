const MODULE = 'sillytavern_music_widget';
const VERSION = '0.6.0';

const DEFAULT_SKIN = {
  id: 'default',
  name: '黎奖·逍遥留白',
  author: '元素四十七',
  version: '1.0.0',
  type: 'bundled',
  css: '',
  url: '',
  global: true,
  characters: [],
};

const DEFAULTS = {
  enabled: true,
  floatingEnabled: true,
  autoCharacter: true,
  fallbackGlobal: true,
  autoplay: false,
  volume: 0.7,
  showOnlyBound: false,
  songs: {},
  skins: {
    items: {},
    activeGlobal: 'default',
    activeCharacters: {},
  },
};

let S;
let audio;
let root;
let player;
let settingsLoaded = false;
let initialized = false;
let songIndex = 0;
let characterPollTimer = null;
let lastCharacterKey = null;
let coreCharacters = [];
let coreCharacterId = -1;
let selectedSongRoleKey = null;
let selectedSkinRoleKey = null;
let selectedSkinId = 'default';

const clone = (value) => JSON.parse(JSON.stringify(value));

const ctx = () => {
  try { return SillyTavern.getContext(); } catch { return {}; }
};

function save() {
  try { ctx().saveSettingsDebounced?.(); } catch {}
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))];
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getCharacterList() {
  const c = ctx();
  if (Array.isArray(c.characters)) return c.characters;
  if (Array.isArray(window.characters)) return window.characters;
  return coreCharacters;
}

function getCurrentCharacterIndex() {
  const c = ctx();
  if (Number.isInteger(c.characterId)) return c.characterId;
  if (Number.isInteger(c.this_chid)) return c.this_chid;
  if (Number.isInteger(window.this_chid)) return window.this_chid;
  return coreCharacterId;
}

function charKey() {
  const list = getCharacterList();
  const index = getCurrentCharacterIndex();
  const character = list[index];
  return character ? String(character.avatar || character.name || index) : null;
}

function charName() {
  const list = getCharacterList();
  const index = getCurrentCharacterIndex();
  const character = list[index];
  return character?.name || character?.data?.name || '';
}

async function syncCoreContext() {
  const c = ctx();
  if (Array.isArray(c.characters)) coreCharacters = c.characters;
  else if (Array.isArray(window.characters)) coreCharacters = window.characters;

  if (Number.isInteger(c.characterId)) coreCharacterId = c.characterId;
  else if (Number.isInteger(c.this_chid)) coreCharacterId = c.this_chid;
  else if (Number.isInteger(window.this_chid)) coreCharacterId = window.this_chid;

  if (!coreCharacters.length || coreCharacterId < 0) {
    try {
      const mod = await import('/script.js');
      if (!coreCharacters.length && Array.isArray(mod.characters)) coreCharacters = mod.characters;
      if (coreCharacterId < 0 && Number.isInteger(mod.this_chid)) coreCharacterId = mod.this_chid;
    } catch {}
  }
}

function toTimestamp(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedCharacters() {
  return getCharacterList().map((item, index) => ({
    key: String(item.avatar || item.name || index),
    name: item.name || item.data?.name || ('角色 ' + (index + 1)),
    avatar: item.avatar || '',
    create_date: toTimestamp(item.create_date),
    date_last_chat: toTimestamp(item.date_last_chat),
    chat_size: Number(item.chat_size) || 0,
    data_size: Number(item.data_size) || 0,
    fav: !!item.fav,
  }));
}

function sortCharacters(list, mode) {
  const result = [...list];
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans');
  const desc = (field) => (a, b) => b[field] - a[field];
  const asc = (field) => (a, b) => a[field] - b[field];

  switch (mode) {
    case 'name-desc': return result.sort((a, b) => byName(b, a));
    case 'newest': return result.sort(desc('create_date'));
    case 'oldest': return result.sort(asc('create_date'));
    case 'favorites': return result.sort((a, b) => Number(b.fav) - Number(a.fav));
    case 'recent': return result.sort(desc('date_last_chat'));
    case 'most-chats': return result.sort(desc('chat_size'));
    case 'least-chats': return result.sort(asc('chat_size'));
    case 'most-tokens': return result.sort(desc('data_size'));
    case 'least-tokens': return result.sort(asc('data_size'));
    case 'random': return result.sort(() => Math.random() - 0.5);
    default: return result.sort(byName);
  }
}

function ensureSong(id, patch = {}) {
  S.songs[id] ||= {
    id,
    title: patch.title || '未命名歌曲',
    url: patch.url || '',
    cover: patch.cover || '',
    global: false,
    characters: [],
  };
  const song = S.songs[id];
  song.title = song.title || patch.title || '未命名歌曲';
  song.url = typeof song.url === 'string' ? song.url : (patch.url || '');
  song.cover = typeof song.cover === 'string' ? song.cover : (patch.cover || '');
  song.global = !!song.global;
  song.characters = unique(song.characters);
  return song;
}

function ensureSkin(id, patch = {}) {
  S.skins.items[id] ||= { ...clone(DEFAULT_SKIN), ...patch, id };
  const skin = S.skins.items[id];
  skin.id = id;
  skin.name = skin.name || patch.name || '未命名皮肤';
  skin.author = skin.author || patch.author || '';
  skin.version = skin.version || patch.version || '1.0.0';
  skin.type = skin.type === 'url' ? 'url' : (skin.type === 'bundled' ? 'bundled' : 'css');
  skin.css = typeof skin.css === 'string' ? skin.css : '';
  skin.url = typeof skin.url === 'string' ? skin.url : '';
  skin.global = !!skin.global;
  skin.characters = unique(skin.characters);
  return skin;
}

function migrateLegacyData() {
  if (!S.songs || typeof S.songs !== 'object' || Array.isArray(S.songs)) S.songs = {};
  if (!S.skins || typeof S.skins !== 'object') S.skins = clone(DEFAULTS.skins);
  S.skins.items ||= {};
  S.skins.activeCharacters ||= {};
  S.skins.activeGlobal ||= 'default';

  const oldMusic = S.music;
  if (oldMusic && Object.keys(S.songs).length === 0) {
    (oldMusic.global?.playlist || []).forEach((item) => {
      const id = item.id ? 'song-' + item.id : makeId('song');
      const song = ensureSong(id, item);
      song.global = true;
    });

    Object.entries(oldMusic.characters || {}).forEach(([key, data]) => {
      (data?.playlist || []).forEach((item) => {
        const existing = Object.values(S.songs).find((song) => song.title === item.title && song.url === item.url);
        const id = existing?.id || (item.id ? 'song-' + item.id : makeId('song'));
        const song = ensureSong(id, item);
        song.characters = unique([...song.characters, key]);
      });
    });
  }

  const oldThemes = S.themes;
  if (oldThemes && typeof oldThemes === 'object' && Object.keys(S.skins.items).length === 0) {
    Object.values(oldThemes).forEach((theme) => {
      const id = theme.id || makeId('skin');
      ensureSkin(id, {
        ...theme,
        id,
        type: 'css',
        global: id === (S.currentTheme || 'default'),
      });
    });
  }

  if (S.globalSkinUrl) {
    const id = 'legacy-global-url';
    ensureSkin(id, {
      id,
      name: '外部全局皮肤',
      author: '',
      version: '1.0.0',
      type: 'url',
      url: S.globalSkinUrl,
      global: true,
    });
    S.skins.activeGlobal = id;
  }

  Object.entries(oldMusic?.characters || {}).forEach(([key, data]) => {
    if (!data?.skinUrl) return;
    const existing = Object.values(S.skins.items).find((skin) => skin.type === 'url' && skin.url === data.skinUrl);
    const id = existing?.id || makeId('skin');
    const skin = ensureSkin(id, {
      id,
      name: data.name ? data.name + '皮肤' : '角色皮肤',
      type: 'url',
      url: data.skinUrl,
      global: false,
      characters: [key],
    });
    skin.characters = unique([...skin.characters, key]);
    S.skins.activeCharacters[key] = id;
  });

  S.skins.items.default ||= clone(DEFAULT_SKIN);
  if (!S.skins.items[S.skins.activeGlobal]) S.skins.activeGlobal = 'default';
}

function ensure() {
  const c = ctx();
  const store = c.extensionSettings || window.extension_settings || {};
  store[MODULE] ||= clone(DEFAULTS);
  S = store[MODULE];

  S.enabled = S.enabled !== false;
  S.floatingEnabled = S.floatingEnabled !== false;
  S.autoCharacter = S.autoCharacter !== false;
  S.fallbackGlobal = S.fallbackGlobal !== false;
  S.autoplay = S.autoplay === true;
  S.showOnlyBound = S.showOnlyBound === true;
  S.volume = Number.isFinite(Number(S.volume)) ? Math.min(1, Math.max(0, Number(S.volume))) : 0.7;

  migrateLegacyData();
  Object.keys(S.songs).forEach((id) => ensureSong(id));
  Object.keys(S.skins.items).forEach((id) => ensureSkin(id));

  if (c.extensionSettings) c.extensionSettings[MODULE] = S;
}

function songsForCharacter(key) {
  return Object.values(S.songs).filter((song) => song.characters.includes(String(key)));
}

function globalSongs() {
  return Object.values(S.songs).filter((song) => song.global);
}

function playlist() {
  const key = charKey();
  if (S.autoCharacter && key) {
    const own = songsForCharacter(key);
    if (own.length || !S.fallbackGlobal) return own;
  }
  return globalSongs();
}

function currentSkin() {
  const key = charKey();
  const roleId = key ? S.skins.activeCharacters[key] : null;
  const roleSkin = roleId ? S.skins.items[roleId] : null;
  if (roleSkin && roleSkin.characters.includes(String(key))) return roleSkin;

  const globalSkin = S.skins.items[S.skins.activeGlobal];
  if (globalSkin?.global || globalSkin?.id === 'default') return globalSkin;
  return S.skins.items.default;
}

function applySkin() {
  const skin = currentSkin();
  let link = document.getElementById('element47-role-music-skin');
  let css = document.getElementById('element47-role-music-skin-css');

  if (!link) {
    link = document.createElement('link');
    link.id = 'element47-role-music-skin';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (!css) {
    css = document.createElement('style');
    css.id = 'element47-role-music-skin-css';
    document.head.appendChild(css);
  }

  link.disabled = true;
  if (skin?.type === 'url' && skin.url) {
    css.textContent = '';
    link.disabled = false;
    link.href = skin.url;
    return;
  }

  if (skin?.type === 'bundled' || skin?.id === 'default') {
    css.textContent = '';
    link.disabled = false;
    link.href = new URL('./skins/lizhang.css', import.meta.url).href;
    return;
  }

  css.textContent = skin?.css || '';
}

function refresh() {
  if (!root) return;
  const list = playlist();
  if (songIndex >= list.length) songIndex = 0;
  const song = list[songIndex];

  root.querySelector('.stw-now-title').textContent = song?.title || '暂无歌曲';
  root.querySelector('.stw-now-sub').textContent =
    charName() && songsForCharacter(charKey()).length ? charName() : '全局歌单';
  root.querySelector('[data-role="scope"]').textContent =
    charName() && songsForCharacter(charKey()).length ? '角色歌曲' : '全局歌曲';

  const cover = root.querySelector('.stw-cover');
  cover.src = song?.cover || '';
  cover.style.visibility = song?.cover ? 'visible' : 'hidden';

  applySkin();

  const hasRoleSongs = !!charKey() && songsForCharacter(charKey()).length > 0;
  const hasGlobalSongs = globalSongs().length > 0;
  const visible = S.enabled && S.floatingEnabled &&
    (!S.showOnlyBound || hasRoleSongs) &&
    (hasRoleSongs || hasGlobalSongs || !S.showOnlyBound);

  root.style.display = visible ? '' : 'none';
  root.querySelector('#stw-launcher').style.display =
    S.enabled && S.floatingEnabled ? '' : 'none';

  if (audio) {
    root.querySelector('[data-act="volume"]').value = S.volume;
  }
  progress();
}

function build() {
  if (root) return;

  root = document.createElement('div');
  root.id = 'stw-root';
  root.innerHTML = [
    '<div id="stw-player">',
      '<div class="stw-player-inner">',
        '<div class="stw-now">',
          '<img class="stw-cover" alt="">',
          '<div class="stw-now-main">',
            '<div class="stw-now-title">暂无歌曲</div>',
            '<div class="stw-now-sub">全局歌单</div>',
          '</div>',
        '</div>',
        '<div class="stw-controls">',
          '<button type="button" class="stw-control" data-act="prev">⏮</button>',
          '<button type="button" class="stw-control play" data-act="play">▶</button>',
          '<button type="button" class="stw-control" data-act="next">⏭</button>',
        '</div>',
        '<input class="stw-progress" data-act="seek" type="range" min="0" max="100" value="0">',
        '<div class="stw-time"><span data-time="cur">0:00</span><span data-time="dur">0:00</span></div>',
        '<input class="stw-volume" data-act="volume" type="range" min="0" max="1" step="0.01" value="' + S.volume + '">',
        '<div class="stw-player-footer"><span data-role="scope">全局歌曲</span><button type="button" class="stw-manage" data-act="manage">管理</button></div>',
      '</div>',
    '</div>',
    '<button type="button" id="stw-launcher" aria-label="打开音乐播放器">♫</button>',
  ].join('');

  document.body.appendChild(root);
  player = root.querySelector('#stw-player');
  audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = S.volume;
  audio.addEventListener('timeupdate', progress);
  audio.addEventListener('loadedmetadata', progress);
  audio.addEventListener('ended', next);

  root.querySelector('#stw-launcher').addEventListener('click', () => player.classList.toggle('open'));
  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (action === 'play') toggle();
    if (action === 'prev') prev();
    if (action === 'next') next();
    if (action === 'manage') openSettings();
  });
  root.querySelector('[data-act="seek"]').addEventListener('input', (event) => {
    if (audio.duration) audio.currentTime = audio.duration * Number(event.target.value) / 100;
  });
  root.querySelector('[data-act="volume"]').addEventListener('input', (event) => {
    S.volume = Number(event.target.value);
    audio.volume = S.volume;
    save();
  });
}

function load(index, autoPlay) {
  const list = playlist();
  if (!list.length) return refresh();
  songIndex = (index + list.length) % list.length;
  audio.src = list[songIndex].url;
  audio.load();
  refresh();
  if (autoPlay) audio.play().catch(() => {});
}

function toggle() {
  if (!playlist().length) return;
  if (!audio.src) load(0, true);
  else if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  refresh();
}

function next() {
  const list = playlist();
  if (list.length) load(songIndex + 1, true);
}

function prev() {
  const list = playlist();
  if (!list.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  load(songIndex - 1, true);
}

function progress() {
  if (!root || !audio) return;
  const seek = root.querySelector('[data-act="seek"]');
  if (audio.duration) seek.value = audio.currentTime / audio.duration * 100;
  root.querySelector('[data-time="cur"]').textContent = time(audio.currentTime);
  root.querySelector('[data-time="dur"]').textContent = time(audio.duration);
  root.querySelector('[data-act="play"]').textContent = audio.paused ? '▶' : 'Ⅱ';
}

function time(value) {
  if (!Number.isFinite(value)) return '0:00';
  return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0');
}

function download(data, filename, mime = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadExtensionStyle() {
  if (document.getElementById('stw-extension-inline-style')) return;
  try {
    const url = new URL('./style.css?v=' + VERSION, import.meta.url).href;
    const css = await fetch(url, { cache: 'no-store' }).then((response) => response.ok ? response.text() : '');
    if (!css) return;
    const style = document.createElement('style');
    style.id = 'stw-extension-inline-style';
    style.textContent = css;
    document.head.appendChild(style);
  } catch {}
}

async function loadSettingsPanel() {
  if (settingsLoaded) return;
  let html = '';
  const c = ctx();

  try {
    html = await c.renderExtensionTemplateAsync?.('', '', {});
  } catch {}

  if (!html) {
    try { html = await $.get(new URL('./settings.html', import.meta.url).href); } catch {}
  }

  if (!html) {
    console.error('[角色音乐播放器] settings.html 加载失败');
    return;
  }

  const host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
  if (!host.length) return;

  host.append(html);
  settingsLoaded = true;
  bindSettings();
  refreshSettings();
}

function renderSettings() {
  const q = (selector) => document.querySelector(selector);
  q('#stw-enabled').checked = S.enabled;
  q('#stw-floating-enabled').checked = S.floatingEnabled;
  q('#stw-show-only-bound').checked = S.showOnlyBound;
  q('#stw-auto-character').checked = S.autoCharacter;
  q('#stw-fallback-global').checked = S.fallbackGlobal;
  q('#stw-autoplay').checked = S.autoplay;
  q('#stw-volume').value = S.volume;
}

function renderSongLibrary() {
  const box = document.querySelector('#stw-song-library');
  if (!box) return;
  const songs = Object.values(S.songs);
  box.innerHTML = songs.length ? '' : '<div class="stw-empty">还没有歌曲。</div>';

  songs.forEach((song) => {
    const row = document.createElement('div');
    row.className = 'stw-song-library-row';
    row.innerHTML = '<div class="stw-song-main"><div class="stw-song-title"></div><div class="stw-song-meta"></div></div><label class="stw-setting-inline"><span>全局</span><label class="stw-switch"><input type="checkbox"><i></i></label></label><button type="button" class="stw-btn stw-danger">删除</button>';
    row.querySelector('.stw-song-title').textContent = song.title;
    row.querySelector('.stw-song-meta').textContent = '角色绑定 ' + song.characters.length + ' 个';
    const globalBox = row.querySelector('input');
    globalBox.checked = song.global;
    globalBox.addEventListener('change', () => { song.global = globalBox.checked; save(); renderSongLibrary(); refresh(); });
    row.querySelector('.stw-danger').addEventListener('click', () => {
      delete S.songs[song.id];
      save();
      renderSongLibrary();
      renderSongRoleEditor();
      refresh();
    });
    box.appendChild(row);
  });
}

function renderSongRoleCharacters() {
  const box = document.querySelector('#stw-song-characters');
  if (!box) return;
  const search = (document.querySelector('#stw-song-role-search')?.value || '').trim().toLowerCase();
  const sort = document.querySelector('#stw-song-role-sort')?.value || 'name-asc';
  const list = sortCharacters(normalizedCharacters().filter((x) => !search || x.name.toLowerCase().includes(search)), sort);
  box.innerHTML = list.length ? '' : '<div class="stw-empty">没有匹配角色。</div>';

  list.forEach((character) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'stw-character-row' + (selectedSongRoleKey === character.key ? ' is-selected' : '');
    row.innerHTML = '<span class="stw-character-avatar"></span><span class="stw-character-main"><span class="stw-character-name"></span><span class="stw-character-meta"></span></span><span class="stw-character-arrow">›</span>';
    if (character.avatar) row.querySelector('.stw-character-avatar').style.backgroundImage = 'url("' + character.avatar.replace(/"/g, '\\"') + '")';
    row.querySelector('.stw-character-name').textContent = character.name;
    row.querySelector('.stw-character-meta').textContent = songsForCharacter(character.key).length + ' 首绑定歌曲 · 聊天 ' + character.chat_size;
    row.addEventListener('click', () => {
      selectedSongRoleKey = character.key;
      renderSongRoleCharacters();
      renderSongRoleEditor();
    });
    box.appendChild(row);
  });
}

function renderSongRoleEditor() {
  const box = document.querySelector('#stw-song-role-editor');
  if (!box) return;

  if (!selectedSongRoleKey) {
    box.innerHTML = '<div class="stw-empty">选择一个角色后，在这里勾选歌曲。一个角色可以很多歌曲，同一首歌曲也可以绑定很多角色。</div>';
    return;
  }

  const character = normalizedCharacters().find((x) => x.key === selectedSongRoleKey);
  if (!character) {
    selectedSongRoleKey = null;
    renderSongRoleEditor();
    return;
  }

  const bound = new Set(songsForCharacter(character.key).map((song) => song.id));
  const songs = Object.values(S.songs);

  box.innerHTML = '<div class="stw-editor-head"><div><div class="stw-card-title">角色：<span></span></div><div class="stw-help">勾选即绑定；取消勾选即解除。不会复制歌曲。</div></div></div><div class="stw-assignment-list"></div>';
  box.querySelector('.stw-card-title span').textContent = character.name;

  const listBox = box.querySelector('.stw-assignment-list');
  listBox.innerHTML = songs.length ? '' : '<div class="stw-empty">还没有歌曲，请先在「歌曲 → 全局」添加歌曲。</div>';

  songs.forEach((song) => {
    const row = document.createElement('label');
    row.className = 'stw-assignment-row';
    row.innerHTML = '<span class="stw-assignment-main"><span class="stw-assignment-title"></span><span class="stw-assignment-meta"></span></span><span class="stw-check-wrap"><input type="checkbox"><i></i></span>';
    row.querySelector('.stw-assignment-title').textContent = song.title;
    row.querySelector('.stw-assignment-meta').textContent = (song.global ? '全局歌曲' : '角色歌曲') + ' · 已绑定 ' + song.characters.length + ' 个角色';
    const checkbox = row.querySelector('input');
    checkbox.checked = bound.has(song.id);
    checkbox.addEventListener('change', () => {
      song.characters = checkbox.checked
        ? unique([...song.characters, character.key])
        : song.characters.filter((key) => key !== character.key);
      save();
      renderSongRoleCharacters();
      renderSongRoleEditor();
      renderSongLibrary();
      refresh();
    });
    listBox.appendChild(row);
  });
}

function renderSkinGlobalList() {
  const box = document.querySelector('#stw-skin-library');
  if (!box) return;
  const skins = Object.values(S.skins.items);
  box.innerHTML = skins.length ? '' : '<div class="stw-empty">还没有皮肤。</div>';

  skins.forEach((skin) => {
    const row = document.createElement('div');
    row.className = 'stw-skin-library-row' + (S.skins.activeGlobal === skin.id ? ' is-selected' : '');
    row.innerHTML = '<div class="stw-skin-main"><div class="stw-skin-title"></div><div class="stw-skin-meta"></div></div><button type="button" class="stw-btn" data-use>设为全局</button><button type="button" class="stw-btn stw-danger" data-delete>删除</button>';
    row.querySelector('.stw-skin-title').textContent = skin.name;
    row.querySelector('.stw-skin-meta').textContent = skin.author ? skin.author + ' · ' + skin.version : skin.version;
    row.querySelector('[data-use]').textContent = S.skins.activeGlobal === skin.id ? '当前全局' : '设为全局';
    row.querySelector('[data-use]').disabled = S.skins.activeGlobal === skin.id;
    row.querySelector('[data-use]').addEventListener('click', () => {
      skin.global = true;
      S.skins.activeGlobal = skin.id;
      selectedSkinId = skin.id;
      save();
      refreshSkinEditor();
      renderSkinGlobalList();
      refresh();
    });
    row.querySelector('[data-delete]').addEventListener('click', () => {
      if (skin.id === 'default') return;
      delete S.skins.items[skin.id];
      if (S.skins.activeGlobal === skin.id) S.skins.activeGlobal = 'default';
      Object.keys(S.skins.activeCharacters).forEach((key) => {
        if (S.skins.activeCharacters[key] === skin.id) delete S.skins.activeCharacters[key];
      });
      selectedSkinId = S.skins.activeGlobal;
      save();
      refreshSettings();
      refresh();
    });
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      selectedSkinId = skin.id;
      refreshSkinEditor();
      renderSkinGlobalList();
    });
    box.appendChild(row);
  });
}

function refreshSkinEditor() {
  const q = (selector) => document.querySelector(selector);
  if (!q('#stw-skin-name')) return;
  const skin = ensureSkin(selectedSkinId || S.skins.activeGlobal || 'default');

  q('#stw-skin-id').value = skin.id;
  q('#stw-skin-name').value = skin.name || '';
  q('#stw-skin-author').value = skin.author || '';
  q('#stw-skin-version').value = skin.version || '1.0.0';
  q('#stw-skin-type').value = skin.type;
  q('#stw-skin-url').value = skin.url || '';
  q('#stw-skin-css').value = skin.css || '';
}

function renderSkinRoleCharacters() {
  const box = document.querySelector('#stw-skin-characters');
  if (!box) return;
  const search = (document.querySelector('#stw-skin-role-search')?.value || '').trim().toLowerCase();
  const sort = document.querySelector('#stw-skin-role-sort')?.value || 'name-asc';
  const list = sortCharacters(normalizedCharacters().filter((x) => !search || x.name.toLowerCase().includes(search)), sort);
  box.innerHTML = list.length ? '' : '<div class="stw-empty">没有匹配角色。</div>';

  list.forEach((character) => {
    const activeId = S.skins.activeCharacters[character.key];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'stw-character-row' + (selectedSkinRoleKey === character.key ? ' is-selected' : '');
    row.innerHTML = '<span class="stw-character-avatar"></span><span class="stw-character-main"><span class="stw-character-name"></span><span class="stw-character-meta">当前：' + (S.skins.items[activeId]?.name || '跟随全局') + '</span></span><span class="stw-character-arrow">›</span>';
    if (character.avatar) row.querySelector('.stw-character-avatar').style.backgroundImage = 'url("' + character.avatar.replace(/"/g, '\\"') + '")';
    row.querySelector('.stw-character-name').textContent = character.name;
    row.addEventListener('click', () => {
      selectedSkinRoleKey = character.key;
      renderSkinRoleCharacters();
      renderSkinRoleEditor();
    });
    box.appendChild(row);
  });
}

function renderSkinRoleEditor() {
  const box = document.querySelector('#stw-skin-role-editor');
  if (!box) return;

  if (!selectedSkinRoleKey) {
    box.innerHTML = '<div class="stw-empty">选择一个角色，在右侧绑定/切换皮肤。</div>';
    return;
  }

  const character = normalizedCharacters().find((x) => x.key === selectedSkinRoleKey);
  if (!character) {
    selectedSkinRoleKey = null;
    renderSkinRoleEditor();
    return;
  }

  const active = S.skins.activeCharacters[character.key] || 'default';
  const skins = Object.values(S.skins.items);

  box.innerHTML = '<div class="stw-editor-head"><div><div class="stw-card-title">角色：<span></span></div><div class="stw-help">一个皮肤可以绑定多个角色；每个角色可选择自己的当前皮肤。</div></div></div><div class="stw-assignment-list"></div>';
  box.querySelector('.stw-card-title span').textContent = character.name;

  const listBox = box.querySelector('.stw-assignment-list');

  skins.forEach((skin) => {
    const bound = skin.id === 'default' || skin.characters.includes(character.key);
    const row = document.createElement('div');
    row.className = 'stw-assignment-row';
    row.innerHTML = '<span class="stw-assignment-main"><span class="stw-assignment-title"></span><span class="stw-assignment-meta"></span></span><span class="stw-assignment-actions"><button type="button" class="stw-btn" data-bind></button><label class="stw-radio"><input type="radio" name="stw-role-skin"><i></i></label></span>';
    row.querySelector('.stw-assignment-title').textContent = skin.name;
    row.querySelector('.stw-assignment-meta').textContent = skin.global ? '全局可用' : '角色绑定皮肤';
    const bindButton = row.querySelector('[data-bind]');
    const radio = row.querySelector('input');
    bindButton.textContent = bound ? '已绑定' : '绑定';
    bindButton.disabled = bound;
    radio.checked = bound && active === skin.id;
    bindButton.addEventListener('click', () => {
      skin.characters = unique([...skin.characters, character.key]);
      S.skins.activeCharacters[character.key] = skin.id;
      save();
      renderSkinRoleCharacters();
      renderSkinRoleEditor();
      refresh();
    });
    radio.addEventListener('change', () => {
      if (!radio.checked || !bound) return;
      S.skins.activeCharacters[character.key] = skin.id;
      save();
      renderSkinRoleCharacters();
      refresh();
    });
    listBox.appendChild(row);
  });
}

function refreshSettings() {
  renderSettings();
  renderSongLibrary();
  renderSongRoleCharacters();
  renderSongRoleEditor();
  renderSkinGlobalList();
  renderSkinRoleCharacters();
  renderSkinRoleEditor();
  refreshSkinEditor();
}

function bindSettings() {
  const q = (selector) => document.querySelector(selector);
  const tabs = document.querySelectorAll('.stw-tab');
  const subtabs = document.querySelectorAll('.stw-subtab');
  const panels = document.querySelectorAll('.stw-tab-panel');
  const subpanels = document.querySelectorAll('.stw-subpanel');

  const activateTab = (name) => {
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  };
  const activateSub = (name) => {
    subtabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.subtab === name));
    subpanels.forEach((panel) => { panel.hidden = panel.dataset.subpanel !== name; });
  };

  tabs.forEach((tab) => tab.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation(); activateTab(tab.dataset.tab);
  }));
  subtabs.forEach((tab) => tab.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation(); activateSub(tab.dataset.subtab);
  }));
  activateTab('songs');
  activateSub('songs-global');

  q('#stw-enabled').addEventListener('change', (e) => { S.enabled = e.target.checked; save(); refresh(); });
  q('#stw-floating-enabled').addEventListener('change', (e) => { S.floatingEnabled = e.target.checked; save(); refresh(); });
  q('#stw-show-only-bound').addEventListener('change', (e) => { S.showOnlyBound = e.target.checked; save(); refresh(); });
  q('#stw-auto-character').addEventListener('change', (e) => { S.autoCharacter = e.target.checked; save(); refresh(); });
  q('#stw-fallback-global').addEventListener('change', (e) => { S.fallbackGlobal = e.target.checked; save(); refresh(); });
  q('#stw-autoplay').addEventListener('change', (e) => { S.autoplay = e.target.checked; save(); });
  q('#stw-volume').addEventListener('input', (e) => { S.volume = Number(e.target.value); audio.volume = S.volume; save(); });

  q('#stw-song-add').addEventListener('click', () => {
    const title = q('#stw-song-title').value.trim();
    const url = q('#stw-song-url').value.trim();
    const cover = q('#stw-song-cover').value.trim();
    if (!title || !url) return;
    const id = makeId('song');
    S.songs[id] = { id, title, url, cover, global: true, characters: [] };
    selectedSongRoleKey = selectedSongRoleKey || null;
    save();
    q('#stw-song-title').value = '';
    q('#stw-song-url').value = '';
    q('#stw-song-cover').value = '';
    renderSongLibrary();
    renderSongRoleEditor();
    refresh();
  });

  q('#stw-song-role-search').addEventListener('input', renderSongRoleCharacters);
  q('#stw-song-role-sort').addEventListener('change', renderSongRoleCharacters);

  q('#stw-skin-role-search').addEventListener('input', renderSkinRoleCharacters);
  q('#stw-skin-role-sort').addEventListener('change', renderSkinRoleCharacters);

  q('#stw-skin-new').addEventListener('click', () => {
    const id = makeId('skin');
    S.skins.items[id] = { id, name: '我的皮肤', author: '', version: '1.0.0', type: 'css', css: '', url: '', global: true, characters: [] };
    S.skins.activeGlobal = id;
    selectedSkinId = id;
    save();
    refreshSettings();
  });

  q('#stw-skin-save').addEventListener('click', () => {
    const id = q('#stw-skin-id').value || selectedSkinId || 'default';
    const skin = ensureSkin(id);
    skin.name = q('#stw-skin-name').value.trim() || '未命名皮肤';
    skin.author = q('#stw-skin-author').value.trim();
    skin.version = q('#stw-skin-version').value.trim() || '1.0.0';
    skin.type = q('#stw-skin-type').value;
    skin.url = q('#stw-skin-url').value.trim();
    skin.css = q('#stw-skin-css').value;
    skin.global = true;
    S.skins.activeGlobal = skin.id;
    selectedSkinId = skin.id;
    save();
    refreshSettings();
    refresh();
  });

  q('#stw-skin-import').addEventListener('click', () => q('#stw-skin-file').click());
  q('#stw-skin-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const skin = JSON.parse(reader.result);
        if (!skin?.name) return;
        skin.schemaVersion = 1;
        skin.id = String(skin.id || makeId('skin')).replace(/[^a-zA-Z0-9_-]/g, '-');
        skin.type = skin.type === 'url' ? 'url' : 'css';
        skin.characters = unique(skin.characters);
        skin.global = !!skin.global;
        S.skins.items[skin.id] = skin;
        selectedSkinId = skin.id;
        if (skin.global) S.skins.activeGlobal = skin.id;
        save();
        refreshSettings();
        refresh();
      } catch {}
      event.target.value = '';
    };
    reader.readAsText(file);
  });

  q('#stw-skin-export').addEventListener('click', () => {
    download(S.skins.items[selectedSkinId] || DEFAULT_SKIN, 'music-skin-' + selectedSkinId + '.json');
  });

  q('#stw-css-import').addEventListener('click', () => q('#stw-css-file').click());
  q('#stw-css-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const skin = ensureSkin(selectedSkinId || 'default');
      skin.type = 'css';
      skin.css = String(reader.result || '');
      skin.global = true;
      S.skins.activeGlobal = skin.id;
      save();
      selectedSkinId = skin.id;
      refreshSettings();
      refresh();
      event.target.value = '';
    };
    reader.readAsText(file);
  });

  q('#stw-css-export').addEventListener('click', () => {
    const skin = S.skins.items[selectedSkinId] || DEFAULT_SKIN;
    download(skin.css || '', (skin.name || 'music-skin').replace(/[\\/:*?"<>|]/g, '_') + '.css', 'text/css');
  });

  q('#stw-skin-select').addEventListener('change', (e) => {
    selectedSkinId = e.target.value;
    refreshSkinEditor();
  });
}

export async function init() {
  if (initialized) return;
  initialized = true;
  ensure();
  await syncCoreContext();
  await loadExtensionStyle();
  build();
  await loadSettingsPanel();
  refreshSettings();
  refresh();
  bindEvents();
  console.info('[角色音乐播放器] v' + VERSION + ' 已加载');
}

function bindEvents() {
  const c = ctx();
  const es = c.eventSource;
  const et = c.event_types || c.eventTypes || {};

  if (es && et.CHAT_CHANGED) {
    es.on(et.CHAT_CHANGED, async () => {
      await syncCoreContext();
      songIndex = 0;
      audio.pause();
      if (S.autoplay && playlist().length) load(0, true);
      else refresh();
      refreshSettings();
    });
  }

  lastCharacterKey = charKey();
  clearInterval(characterPollTimer);
  characterPollTimer = setInterval(async () => {
    await syncCoreContext();
    const key = charKey();
    if (key === lastCharacterKey) return;
    lastCharacterKey = key;
    songIndex = 0;
    audio.pause();
    if (S.autoplay && playlist().length) load(0, true);
    else refresh();
    refreshSettings();
  }, 700);
}
