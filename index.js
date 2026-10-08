const MODULE = 'sillytavern_music_widget';

const DEFAULT_THEME = {
  schemaVersion: 1,
  id: 'default',
  name: '默认主题',
  author: '元素四十七',
  version: '1.0.0',
  description: '基础播放器主题',
  variables: {
    accent: '#d8c8a8',
    panel: 'rgba(18,18,18,.96)',
    text: '#f2eee7',
    border: 'rgba(216,200,168,.38)',
    button: 'rgba(255,255,255,.08)',
    launcherImage: '',
    backgroundImage: '',
  },
  css: '',
};

const DEFAULTS = {
  enabled: true,
  floatingEnabled: true,
  autoCharacter: true,
  fallbackGlobal: true,
  autoplay: false,
  volume: 0.7,
  scope: 'global',
  globalVisible: true,
  globalSkinUrl: '',
  currentTheme: 'default',
  music: { global: { playlist: [] }, characters: {} },
  themes: { default: DEFAULT_THEME },
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

const ctx = () => {
  try { return SillyTavern.getContext(); } catch { return {}; }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function ensure() {
  const c = ctx();
  const store = c.extensionSettings || window.extension_settings || {};
  store[MODULE] ||= clone(DEFAULTS);
  S = store[MODULE];

  S.music ||= clone(DEFAULTS.music);
  S.music.global ||= { playlist: [] };
  S.music.global.playlist ||= [];
  S.music.characters ||= {};

  S.themes ||= { default: clone(DEFAULT_THEME) };
  S.themes.default ||= clone(DEFAULT_THEME);
  S.currentTheme = S.themes[S.currentTheme] ? S.currentTheme : 'default';

  S.enabled = S.enabled !== false;
  S.floatingEnabled = S.floatingEnabled !== false;
  S.autoCharacter = S.autoCharacter !== false;
  S.fallbackGlobal = S.fallbackGlobal !== false;
  S.autoplay = S.autoplay === true;
  S.globalVisible = S.globalVisible !== false;
  S.scope = S.scope === 'bound' ? 'bound' : 'global';
  S.globalSkinUrl = typeof S.globalSkinUrl === 'string' ? S.globalSkinUrl : '';
  S.volume = Number.isFinite(Number(S.volume)) ? Math.min(1, Math.max(0, Number(S.volume))) : 0.7;

  Object.values(S.music.characters).forEach((item) => {
    item.playlist ||= [];
    item.bound = !!item.bound;
    item.visible = item.visible !== false;
    item.enabled = item.enabled !== false;
    item.skinUrl = typeof item.skinUrl === 'string' ? item.skinUrl : '';
    item.name = item.name || '';
  });

  if (c.extensionSettings) c.extensionSettings[MODULE] = S;
}

function save() {
  try { ctx().saveSettingsDebounced?.(); } catch {}
}

function getCharacterList() {
  const c = ctx();
  return c.characters || window.characters || [];
}

function getCurrentCharacterIndex() {
  const c = ctx();
  if (Number.isInteger(c.this_chid)) return c.this_chid;
  if (Number.isInteger(window.this_chid)) return window.this_chid;
  return -1;
}

function charKey() {
  const list = getCharacterList();
  const i = getCurrentCharacterIndex();
  const ch = list[i];
  return ch ? String(ch.avatar || ch.name || i) : null;
}

function charName() {
  const list = getCharacterList();
  const i = getCurrentCharacterIndex();
  const ch = list[i];
  return ch?.name || ch?.data?.name || '';
}

function toTimestamp(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCharacter(ch, index) {
  return {
    raw: ch,
    key: String(ch.avatar || ch.name || index),
    name: ch.name || ch.data?.name || ('角色 ' + (index + 1)),
    avatar: ch.avatar || '',
    index,
    create_date: toTimestamp(ch.create_date),
    date_last_chat: toTimestamp(ch.date_last_chat),
    chat_size: Number(ch.chat_size) || 0,
    data_size: Number(ch.data_size) || 0,
    fav: !!ch.fav,
  };
}

function chars() {
  return getCharacterList().map(normalizeCharacter);
}

function sortCharacters(list, mode) {
  const result = [...list];

  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans');
  const byNumberDesc = (field) => (a, b) => b[field] - a[field];
  const byNumberAsc = (field) => (a, b) => a[field] - b[field];

  switch (mode) {
    case 'name-desc':
      return result.sort((a, b) => byName(b, a));
    case 'newest':
      return result.sort(byNumberDesc('create_date'));
    case 'oldest':
      return result.sort(byNumberAsc('create_date'));
    case 'favorites':
      return result.sort((a, b) => Number(b.fav) - Number(a.fav));
    case 'recent':
      return result.sort(byNumberDesc('date_last_chat'));
    case 'most-chats':
      return result.sort(byNumberDesc('chat_size'));
    case 'least-chats':
      return result.sort(byNumberAsc('chat_size'));
    case 'most-tokens':
      return result.sort(byNumberDesc('data_size'));
    case 'least-tokens':
      return result.sort(byNumberAsc('data_size'));
    case 'random':
      return result.sort(() => Math.random() - 0.5);
    case 'name-asc':
    default:
      return result.sort(byName);
  }
}

function ensureChar(key, name) {
  S.music.characters[key] ||= {
    name: name || key,
    playlist: [],
    bound: false,
    visible: true,
    enabled: true,
    skinUrl: '',
  };

  const item = S.music.characters[key];
  item.name = name || item.name || key;
  item.playlist ||= [];
  item.bound = !!item.bound;
  item.visible = item.visible !== false;
  item.enabled = item.enabled !== false;
  item.skinUrl = typeof item.skinUrl === 'string' ? item.skinUrl : '';
  return item;
}

function playlist() {
  const key = charKey();

  if (S.autoCharacter && key) {
    const own = S.music.characters[key]?.playlist || [];
    if (own.length || !S.fallbackGlobal) return own;
  }

  return S.music.global.playlist || [];
}

function scopeList(key) {
  if (key === 'global') return S.music.global.playlist;

  const item = ensureChar(key);
  return item.playlist;
}

function isPlayerVisible() {
  const key = charKey();
  const charSettings = key ? S.music.characters[key] : null;

  if (!S.enabled || !S.floatingEnabled || !S.globalVisible) return false;

  if (S.scope === 'bound') {
    return !!charSettings?.bound
      && charSettings.enabled !== false
      && charSettings.visible !== false;
  }

  return charSettings?.enabled !== false && charSettings?.visible !== false;
}

function bundledSkinUrl() {
  try {
    return new URL('./skins/lizhang.css', import.meta.url).href;
  } catch {
    return '/scripts/extensions/third-party/-/skins/lizhang.css';
  }
}

function applySkin() {
  const key = charKey();
  const charSettings = key ? S.music.characters[key] : null;
  const url = (charSettings?.bound && charSettings.skinUrl)
    || S.globalSkinUrl
    || bundledSkinUrl();

  let link = document.getElementById('element47-role-music-skin');
  if (!link) {
    link = document.createElement('link');
    link.id = 'element47-role-music-skin';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  if (link.href !== url) link.href = url;
}

function applyTheme() {
  const theme = S.themes[S.currentTheme] || DEFAULT_THEME;
  const v = theme.variables || {};

  let style = document.getElementById('stw-theme-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'stw-theme-style';
    document.head.appendChild(style);
  }

  const safeUrl = (value) => String(value || '').replace(/"/g, '\\"');
  const bg = safeUrl(v.backgroundImage);
  const launcher = safeUrl(v.launcherImage);

  style.textContent =
    ':root{' +
    '--stw-accent:' + (v.accent || '#d8c8a8') + ';' +
    '--stw-panel:' + (v.panel || 'rgba(18,18,18,.96)') + ';' +
    '--stw-text:' + (v.text || '#f2eee7') + ';' +
    '--stw-border:' + (v.border || 'rgba(216,200,168,.38)') + ';' +
    '--stw-button:' + (v.button || 'rgba(255,255,255,.08)') + ';' +
    '--stw-launcher-image:' + (launcher ? 'url("' + launcher + '")' : 'none') + ';' +
    '--stw-bg-image:' + (bg ? 'url("' + bg + '")' : 'none') + '}' +
    '\\n' + (theme.css || '');
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
        '<div class="stw-player-footer">',
          '<span data-role="scope">全局</span>',
          '<button type="button" class="stw-manage" data-act="manage">管理音乐 / 美化</button>',
        '</div>',
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

  root.querySelector('#stw-launcher').addEventListener('click', () => {
    player.classList.toggle('open');
  });

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

  applyTheme();
  applySkin();
  refresh();
}

function load(index, autoPlay) {
  const list = playlist();
  if (!list.length) {
    refresh();
    return;
  }

  songIndex = (index + list.length) % list.length;
  audio.src = list[songIndex].url;
  audio.load();
  refresh();

  if (autoPlay) audio.play().catch(() => {});
}

function toggle() {
  const list = playlist();
  if (!list.length) return;

  if (!audio.src) {
    load(0, true);
  } else if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }

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

function time(value) {
  if (!Number.isFinite(value)) return '0:00';
  return Math.floor(value / 60) + ':' + String(Math.floor(value % 60)).padStart(2, '0');
}

function progress() {
  if (!root) return;

  const seek = root.querySelector('[data-act="seek"]');
  if (audio.duration) seek.value = audio.currentTime / audio.duration * 100;

  root.querySelector('[data-time="cur"]').textContent = time(audio.currentTime);
  root.querySelector('[data-time="dur"]').textContent = time(audio.duration);
  root.querySelector('[data-act="play"]').textContent = audio.paused ? '▶' : 'Ⅱ';
}

function refresh() {
  if (!root) return;

  const list = playlist();
  const song = list[songIndex];

  root.querySelector('.stw-now-title').textContent = song?.title || '暂无歌曲';
  root.querySelector('.stw-now-sub').textContent = charName() || '全局歌单';
  root.querySelector('[data-role="scope"]').textContent =
    charName() && S.autoCharacter ? '角色歌单' : '全局';

  const cover = root.querySelector('.stw-cover');
  cover.src = song?.cover || '';
  cover.style.visibility = song?.cover ? 'visible' : 'hidden';

  progress();
  applyTheme();
  applySkin();

  root.style.display = isPlayerVisible() ? '' : 'none';
  root.querySelector('#stw-launcher').style.display =
    S.enabled && S.floatingEnabled ? '' : 'none';
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

async function loadSettingsPanel() {
  if (settingsLoaded) return;

  const c = ctx();
  let html = '';

  try {
    html = await c.renderExtensionTemplateAsync?.('third-party/-', 'settings', {});
  } catch {}

  if (!html) {
    try {
      html = await $.get(new URL('./settings.html', import.meta.url).href);
    } catch {}
  }

  if (!html) {
    console.error('[角色音乐播放器] settings.html 加载失败');
    return;
  }

  const host = $('#extensions_settings2').length
    ? $('#extensions_settings2')
    : $('#extensions_settings');

  if (!host.length) {
    console.error('[角色音乐播放器] 找不到扩展设置容器');
    return;
  }

  host.append(html);
  settingsLoaded = true;
  bindSettings();
  refreshSettings();
}

function formatCount(value) {
  return Number(value) > 0 ? String(Number(value)) : '0';
}

function renderCharacterBindings() {
  const box = document.querySelector('#stw-character-list');
  if (!box) return;

  const sortMode = document.querySelector('#stw-character-sort')?.value || 'name-asc';
  const searchText = (document.querySelector('#stw-character-search')?.value || '').trim().toLowerCase();
  const filtered = chars().filter((item) => !searchText || item.name.toLowerCase().includes(searchText));
  const list = sortCharacters(filtered, sortMode);

  box.innerHTML = '';

  if (!list.length) {
    box.innerHTML = '<div class="stw-empty">没有读取到角色卡。</div>';
    return;
  }

  const currentKey = charKey();

  list.forEach((item) => {
    const settings = ensureChar(item.key, item.name);
    const row = document.createElement('div');
    row.className = 'stw-character-row' + (item.key === currentKey ? ' is-current' : '');

    const avatar = document.createElement('div');
    avatar.className = 'stw-character-avatar';
    if (item.avatar) avatar.style.backgroundImage = 'url("' + item.avatar.replace(/"/g, '\\"') + '")';

    row.innerHTML = [
      '<div class="stw-character-main">',
        '<div class="stw-character-name"></div>',
        '<div class="stw-character-meta">聊天 ',
          formatCount(item.chat_size),
          ' · 最近聊天 ',
          item.date_last_chat ? new Date(item.date_last_chat).toLocaleDateString() : '无',
        '</div>',
      '</div>',
      '<label class="stw-character-bind"><input type="checkbox"> 绑定</label>',
      '<button type="button" class="stw-btn stw-character-edit">编辑</button>',
    ].join('');

    row.prepend(avatar);
    row.querySelector('.stw-character-name').textContent = item.name;

    const checkbox = row.querySelector('input');
    checkbox.checked = settings.bound;
    checkbox.addEventListener('change', () => {
      settings.bound = checkbox.checked;
      save();
      refresh();
      renderCharacterBindings();
      refreshSettings(false);
    });

    row.querySelector('.stw-character-edit').addEventListener('click', () => {
      const scope = document.querySelector('#stw-scope');
      if (!scope) return;
      scope.value = item.key;
      renderSelectedPlaylist();
      scope.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    box.appendChild(row);
  });
}

function renderSelectedPlaylist() {
  const scope = document.querySelector('#stw-scope');
  const box = document.querySelector('#stw-playlist');
  if (!scope || !box) return;

  const list = scopeList(scope.value);
  box.innerHTML = list.length ? '' : '<div class="stw-empty">这里还没有歌曲。</div>';

  list.forEach((song, index) => {
    const row = document.createElement('div');
    row.className = 'stw-song';
    row.innerHTML = [
      '<div class="stw-song-title"></div>',
      '<div class="stw-song-url"></div>',
      '<button type="button" class="stw-btn">播放</button>',
      '<button type="button" class="stw-btn stw-danger">删除</button>',
    ].join('');

    row.querySelector('.stw-song-title').textContent = song.title || '未命名歌曲';
    row.querySelector('.stw-song-url').textContent = song.url || '';
    row.querySelectorAll('button')[0].addEventListener('click', () => {
      songIndex = index;
      audio.src = song.url;
      audio.play().catch(() => {});
      refresh();
    });
    row.querySelectorAll('button')[1].addEventListener('click', () => {
      list.splice(index, 1);
      save();
      renderSelectedPlaylist();
      refresh();
    });

    box.appendChild(row);
  });
}

function refreshSettings(refreshCharacterList = true) {
  const q = (selector) => document.querySelector(selector);
  if (!q('#stw-scope')) return;

  q('#stw-enabled').checked = S.enabled;
  q('#stw-floating-enabled').checked = S.floatingEnabled;
  q('#stw-auto-character').checked = S.autoCharacter;
  q('#stw-fallback-global').checked = S.fallbackGlobal;
  q('#stw-autoplay').checked = S.autoplay;
  q('#stw-volume').value = S.volume;
  q('#stw-bound-only').checked = S.scope === 'bound';
  q('#stw-global-visible').checked = S.globalVisible;
  q('#stw-global-skin').value = S.globalSkinUrl || '';

  const currentKey = charKey();
  const currentSettings = currentKey ? ensureChar(currentKey, charName()) : null;

  q('#stw-current-character').textContent = charName() || '当前没有选择角色';
  q('#stw-bind').checked = !!currentSettings?.bound;
  q('#stw-char-enabled').checked = currentSettings?.enabled !== false;
  q('#stw-char-visible').checked = currentSettings?.visible !== false;
  q('#stw-char-skin').value = currentSettings?.skinUrl || '';

  const scope = q('#stw-scope');
  const oldValue = scope.value;
  scope.innerHTML = '<option value="global">全局歌单</option>';

  chars().forEach((item) => {
    const option = document.createElement('option');
    option.value = item.key;
    option.textContent = '角色：' + item.name;
    scope.appendChild(option);
  });

  if ([...scope.options].some((option) => option.value === oldValue)) {
    scope.value = oldValue;
  }

  renderSelectedPlaylist();

  const themeSelect = q('#stw-theme-select');
  themeSelect.innerHTML = '';
  Object.values(S.themes).forEach((theme) => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    themeSelect.appendChild(option);
  });
  themeSelect.value = S.currentTheme;

  const theme = S.themes[S.currentTheme] || DEFAULT_THEME;
  q('#stw-theme-name').value = theme.name || '';
  q('#stw-theme-author').value = theme.author || '';
  q('#stw-theme-version').value = theme.version || '1.0.0';
  q('#stw-theme-launcher').value = theme.variables?.launcherImage || '';
  q('#stw-theme-bg').value = theme.variables?.backgroundImage || '';
  q('#stw-theme-accent').value = theme.variables?.accent || '#d8c8a8';
  q('#stw-theme-css').value = theme.css || '';

  if (refreshCharacterList) renderCharacterBindings();
}

function bindSettings() {
  const q = (selector) => document.querySelector(selector);

  const tabs = document.querySelectorAll('.stw-tab');
  const panels = document.querySelectorAll('.stw-tab-panel');

  const activateTab = (tabName) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === tabName;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    panels.forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
      panel.hidden = panel.dataset.panel !== tabName;
    });
  };

  tabs.forEach((tab) => {
    tab.type = 'button';
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      activateTab(tab.dataset.tab);
    });
  });

  activateTab('music');

  q('#stw-enabled').addEventListener('change', (event) => {
    S.enabled = event.target.checked;
    save();
    refresh();
  });

  q('#stw-floating-enabled').addEventListener('change', (event) => {
    S.floatingEnabled = event.target.checked;
    save();
    refresh();
  });

  q('#stw-auto-character').addEventListener('change', (event) => {
    S.autoCharacter = event.target.checked;
    save();
    refresh();
  });

  q('#stw-fallback-global').addEventListener('change', (event) => {
    S.fallbackGlobal = event.target.checked;
    save();
    refresh();
  });

  q('#stw-autoplay').addEventListener('change', (event) => {
    S.autoplay = event.target.checked;
    save();
  });

  q('#stw-volume').addEventListener('input', (event) => {
    S.volume = Number(event.target.value);
    audio.volume = S.volume;
    save();
  });

  q('#stw-bound-only').addEventListener('change', (event) => {
    S.scope = event.target.checked ? 'bound' : 'global';
    save();
    refresh();
  });

  q('#stw-global-visible').addEventListener('change', (event) => {
    S.globalVisible = event.target.checked;
    save();
    refresh();
  });

  q('#stw-global-skin').addEventListener('change', (event) => {
    S.globalSkinUrl = event.target.value.trim();
    save();
    refresh();
  });

  q('#stw-bind').addEventListener('change', (event) => {
    const key = charKey();
    if (!key) return;
    ensureChar(key, charName()).bound = event.target.checked;
    save();
    refresh();
    refreshSettings();
  });

  q('#stw-char-visible').addEventListener('change', (event) => {
    const key = charKey();
    if (!key) return;
    ensureChar(key, charName()).visible = event.target.checked;
    save();
    refresh();
  });

  q('#stw-char-enabled').addEventListener('change', (event) => {
    const key = charKey();
    if (!key) return;
    ensureChar(key, charName()).enabled = event.target.checked;
    save();
    refresh();
  });

  q('#stw-char-skin').addEventListener('change', (event) => {
    const key = charKey();
    if (!key) return;
    ensureChar(key, charName()).skinUrl = event.target.value.trim();
    save();
    refresh();
  });

  q('#stw-character-sort').addEventListener('change', () => renderCharacterBindings());
  q('#stw-character-search').addEventListener('input', () => renderCharacterBindings());

  q('#stw-scope').addEventListener('change', () => {
    renderSelectedPlaylist();
  });

  q('#stw-use-current').addEventListener('click', () => {
    const key = charKey();
    if (!key) return;
    q('#stw-scope').value = key;
    renderSelectedPlaylist();
  });

  q('#stw-add-song').addEventListener('click', () => {
    const title = q('#stw-song-title').value.trim();
    const url = q('#stw-song-url').value.trim();
    const cover = q('#stw-song-cover').value.trim();

    if (!title || !url) return;

    scopeList(q('#stw-scope').value).push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title,
      url,
      cover,
    });

    q('#stw-song-title').value = '';
    q('#stw-song-url').value = '';
    q('#stw-song-cover').value = '';

    save();
    renderSelectedPlaylist();
    refresh();
    renderCharacterBindings();
  });

  q('#stw-theme-select').addEventListener('change', (event) => {
    S.currentTheme = event.target.value;
    save();
    applyTheme();
    refreshSettings(false);
  });

  q('#stw-theme-new').addEventListener('click', () => {
    const id = 'theme-' + Date.now().toString(36);
    S.themes[id] = { ...clone(DEFAULT_THEME), id, name: '我的主题', author: '', css: '' };
    S.currentTheme = id;
    save();
    applyTheme();
    refreshSettings(false);
  });

  q('#stw-theme-duplicate').addEventListener('click', () => {
    const theme = clone(S.themes[S.currentTheme] || DEFAULT_THEME);
    const id = 'theme-' + Date.now().toString(36);
    theme.id = id;
    theme.name = (theme.name || '主题') + ' 副本';
    S.themes[id] = theme;
    S.currentTheme = id;
    save();
    applyTheme();
    refreshSettings(false);
  });

  q('#stw-theme-save').addEventListener('click', () => {
    const theme = S.themes[S.currentTheme] || clone(DEFAULT_THEME);
    theme.name = q('#stw-theme-name').value.trim() || '未命名主题';
    theme.author = q('#stw-theme-author').value.trim();
    theme.version = q('#stw-theme-version').value.trim() || '1.0.0';
    theme.variables = {
      ...(theme.variables || {}),
      launcherImage: q('#stw-theme-launcher').value.trim(),
      backgroundImage: q('#stw-theme-bg').value.trim(),
      accent: q('#stw-theme-accent').value.trim() || '#d8c8a8',
    };
    theme.css = q('#stw-theme-css').value;
    S.themes[theme.id] = theme;
    save();
    applyTheme();
    refreshSettings(false);
  });

  q('#stw-theme-delete').addEventListener('click', () => {
    if (S.currentTheme === 'default') return;
    delete S.themes[S.currentTheme];
    S.currentTheme = 'default';
    save();
    applyTheme();
    refreshSettings(false);
  });

  q('#stw-theme-import').addEventListener('click', () => q('#stw-theme-file').click());

  q('#stw-theme-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const theme = JSON.parse(reader.result);
        if (!theme?.name || typeof theme.css !== 'string') return;

        theme.schemaVersion = 1;
        theme.id = String(theme.id || ('theme-' + Date.now().toString(36))).replace(/[^a-zA-Z0-9_-]/g, '-');
        S.themes[theme.id] = theme;
        S.currentTheme = theme.id;
        save();
        applyTheme();
        refreshSettings(false);
      } catch {}
      event.target.value = '';
    };
    reader.readAsText(file);
  });

  q('#stw-theme-export').addEventListener('click', () => {
    download(S.themes[S.currentTheme] || DEFAULT_THEME, 'music-widget-theme-' + S.currentTheme + '.json');
  });

  q('#stw-css-import').addEventListener('click', () => q('#stw-css-file').click());

  q('#stw-css-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const theme = S.themes[S.currentTheme] || clone(DEFAULT_THEME);
      theme.css = String(reader.result || '');
      S.themes[theme.id] = theme;
      save();
      applyTheme();
      refreshSettings(false);
      event.target.value = '';
    };
    reader.readAsText(file);
  });

  q('#stw-css-export').addEventListener('click', () => {
    const theme = S.themes[S.currentTheme] || DEFAULT_THEME;
    download(
      theme.css || '',
      (theme.name || 'music-widget-theme').replace(/[\\/:*?"<>|]/g, '_') + '.css',
      'text/css',
    );
  });

  q('#stw-data-export').addEventListener('click', () => {
    download(S.music, 'music-widget-data.json');
  });

  q('#stw-data-import').addEventListener('click', () => q('#stw-data-file').click());

  q('#stw-data-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data?.global && data?.characters) {
          S.music = data;
          save();
          refreshSettings();
          refresh();
        }
      } catch {}
      event.target.value = '';
    };
    reader.readAsText(file);
  });
}

function openSettings() {
  const button = document.querySelector('#extensionsMenuButton');
  if (button) button.click();

  setTimeout(() => {
    const drawer = document.querySelector('.stw-extension-drawer');
    drawer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}

function bindEvents() {
  const c = ctx();
  const es = c.eventSource;
  const et = c.event_types || {};

  if (es && et.CHAT_CHANGED) {
    es.on(et.CHAT_CHANGED, () => {
      songIndex = 0;
      audio.pause();
      if (S.autoplay && playlist().length) load(0, true);
      else refresh();
      refreshSettings();
    });
  }

  lastCharacterKey = charKey();
  clearInterval(characterPollTimer);

  characterPollTimer = setInterval(() => {
    const currentKey = charKey();
    if (currentKey === lastCharacterKey) return;

    lastCharacterKey = currentKey;
    songIndex = 0;
    audio.pause();

    if (S.autoCharacter && S.autoplay && playlist().length) load(0, true);
    else refresh();

    refreshSettings();
  }, 700);
}

export async function init() {
  if (initialized) return;
  initialized = true;

  ensure();
  build();
  await loadSettingsPanel();
  bindEvents();
  refresh();

  console.info('[角色音乐播放器] v0.3.1 已加载');
}

if (typeof jQuery === 'function') {
  jQuery(() => {
    init().catch((error) => console.error('[角色音乐播放器] 初始化失败', error));
  });
}
