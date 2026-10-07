const MODULE = 'sillytavern_music_widget';
const DEFAULT_THEME = {
  schemaVersion: 1, id: 'default', name: '默认主题', author: '元素四十七',
  version: '1.0.0', description: '基础主题',
  variables: { accent:'#9acbff', panel:'rgba(10,16,28,.94)', text:'#eef4ff', border:'rgba(154,203,255,.35)', button:'rgba(255,255,255,.08)', launcherImage:'', backgroundImage:'' },
  css: ''
};
const DEFAULTS = {
  enabled:true, autoCharacter:true, fallbackGlobal:true, autoplay:false, volume:.7,
  scope:'global', globalVisible:true, globalSkinUrl:'',
  currentTheme:'default', music:{global:{playlist:[]},characters:{}}, themes:{default:DEFAULT_THEME}
};
let S, audio, root, player, songIndex=0, settingsLoaded=false, initialized=false;

const ctx=()=>{try{return SillyTavern.getContext()}catch{return {}}};
const clone=x=>JSON.parse(JSON.stringify(x));
function ensure(){
  const c=ctx(), store=c.extensionSettings||window.extension_settings||{};
  store[MODULE] ||= clone(DEFAULTS); S=store[MODULE];
  S.music ||= clone(DEFAULTS.music); S.music.global ||= {playlist:[]}; S.music.characters ||= {};
  S.themes ||= {default:clone(DEFAULT_THEME)}; S.themes.default ||= clone(DEFAULT_THEME);
  if(!S.themes[S.currentTheme])S.currentTheme='default';
  S.enabled=S.enabled!==false;
  S.globalVisible=S.globalVisible!==false;
  S.globalSkinUrl=typeof S.globalSkinUrl==='string'?S.globalSkinUrl:'';
  S.scope=S.scope==='bound'?'bound':'global';
  S.volume=Number.isFinite(Number(S.volume))?Number(S.volume):.7;
  Object.values(S.music.characters).forEach(x=>{
    x.playlist ||= [];
    x.bound=!!x.bound;
    x.visible=x.visible!==false;
    x.enabled=x.enabled!==false;
    x.skinUrl=typeof x.skinUrl==='string'?x.skinUrl:'';
  });
  if(c.extensionSettings)c.extensionSettings[MODULE]=S;
}
function save(){try{ctx().saveSettingsDebounced?.()}catch{}}
function charKey(){
  const c=ctx(), i=Number.isInteger(c.this_chid)?c.this_chid:(Number.isInteger(window.this_chid)?window.this_chid:-1);
  const list=c.characters||window.characters||[], ch=list[i]; return ch?String(ch.avatar||ch.name||i):null;
}
function charName(){
  const c=ctx(), i=Number.isInteger(c.this_chid)?c.this_chid:(Number.isInteger(window.this_chid)?window.this_chid:-1);
  const list=c.characters||window.characters||[], ch=list[i]; return ch?.name||ch?.data?.name||'';
}
function chars(){
  const c=ctx(), list=c.characters||window.characters||[];
  return list.map((x,i)=>({key:String(x.avatar||x.name||i),name:x.name||x.data?.name||('角色 '+(i+1))}));
}
function playlist(){
  const k=charKey();
  if(S.autoCharacter&&k){
    const p=S.music.characters[k]?.playlist||[];
    if(p.length||!S.fallbackGlobal)return p;
  }
  return S.music.global.playlist||[];
}
function scopeList(k){
  if(k==='global')return S.music.global.playlist;
  S.music.characters[k] ||= {name:k,playlist:[],bound:false,visible:true,enabled:true,skinUrl:''};
  const x=S.music.characters[k];x.playlist ||= [];x.bound=!!x.bound;x.visible=x.visible!==false;x.enabled=x.enabled!==false;x.skinUrl=x.skinUrl||'';
  return x.playlist;
}
function isPlayerVisible(){const k=charKey(),cs=k?S.music.characters[k]:null;if(!S.enabled||!S.globalVisible)return false;if(S.scope==='bound')return !!cs?.bound&&cs?.enabled!==false&&cs?.visible!==false;return cs?.enabled!==false&&cs?.visible!==false;}
function bundledSkinUrl(){try{return new URL('./skins/lizhang.css',import.meta.url).href}catch{return '/scripts/extensions/third-party/-/skins/lizhang.css'}}
function applySkin(){const k=charKey(),cs=k?S.music.characters[k]:null,url=(cs?.bound&&cs.skinUrl)||S.globalSkinUrl||bundledSkinUrl();let l=document.getElementById('element47-role-music-skin');if(!l){l=document.createElement('link');l.id='element47-role-music-skin';l.rel='stylesheet';document.head.appendChild(l)}if(l.href!==url)l.href=url;}
function id(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function time(v){if(!Number.isFinite(v))return'0:00';return Math.floor(v/60)+':'+String(Math.floor(v%60)).padStart(2,'0')}

function applyTheme(){
  const t=S.themes[S.currentTheme]||DEFAULT_THEME,v=t.variables||{};
  let el=document.getElementById('stw-theme-style');
  if(!el){el=document.createElement('style');el.id='stw-theme-style';document.head.appendChild(el)}
  const bg=v.backgroundImage?String(v.backgroundImage).replace(/"/g,'\\\"'):'';
  const launch=v.launcherImage?String(v.launcherImage).replace(/"/g,'\\\"'):'';
  el.textContent=':root{--stw-accent:'+ (v.accent||'#9acbff') +';--stw-panel:'+(v.panel||'rgba(10,16,28,.94)')+';--stw-text:'+(v.text||'#eef4ff')+';--stw-border:'+(v.border||'rgba(154,203,255,.35)')+';--stw-button:'+(v.button||'rgba(255,255,255,.08)')+';--stw-launcher-image:'+(launch?'url("'+launch+'")':'none')+';--stw-bg-image:'+(bg?'url("'+bg+'")':'none')+';}#stw-root{'+(t.css||'')+'}';
}
function build(){
  if(root)return;
  root=document.createElement('div');root.id='stw-root';
  root.innerHTML='<div id="stw-player"><div class="stw-player-inner"><div class="stw-now"><img class="stw-cover" alt=""><div class="stw-now-main"><div class="stw-now-title">暂无歌曲</div><div class="stw-now-sub">酒馆音乐小组件</div></div></div><div class="stw-controls"><button class="stw-control" data-act="prev">⏮</button><button class="stw-control play" data-act="play">▶</button><button class="stw-control" data-act="next">⏭</button></div><input class="stw-progress" data-act="seek" type="range" min="0" max="100" value="0"><div class="stw-time"><span data-time="cur">0:00</span><span data-time="dur">0:00</span></div><input class="stw-volume" data-act="volume" type="range" min="0" max="1" step=".01" value="'+S.volume+'"><div class="stw-player-footer"><span data-role="scope">全局</span><button class="stw-manage" data-act="manage">管理音乐 / 美化</button></div></div></div><button id="stw-launcher" aria-label="音乐">♫</button>';
  document.body.appendChild(root);player=root.querySelector('#stw-player');
  audio=new Audio();audio.preload='metadata';audio.volume=S.volume;
  audio.addEventListener('timeupdate',progress);audio.addEventListener('loadedmetadata',progress);audio.addEventListener('ended',next);
  root.querySelector('#stw-launcher').onclick=()=>player.classList.toggle('open');
  root.onclick=e=>{const a=e.target.closest('[data-act]')?.dataset.act;if(a==='play')toggle();if(a==='prev')prev();if(a==='next')next();if(a==='manage')openSettings()};
  root.querySelector('[data-act="seek"]').oninput=e=>{if(audio.duration)audio.currentTime=audio.duration*Number(e.target.value)/100};
  root.querySelector('[data-act="volume"]').oninput=e=>{S.volume=Number(e.target.value);audio.volume=S.volume;save()};
  applyTheme();applySkin();refresh();
}
function load(i,auto){
  const p=playlist();if(!p.length){refresh();return}
  songIndex=(i+p.length)%p.length;audio.src=p[songIndex].url;audio.load();refresh();
  if(auto)audio.play().catch(()=>{});
}
function toggle(){if(!playlist().length)return;if(!audio.src)load(0,true);else if(audio.paused)audio.play().catch(()=>{});else audio.pause();refresh()}
function next(){const p=playlist();if(p.length)load(songIndex+1,true)}
function prev(){const p=playlist();if(!p.length)return;if(audio.currentTime>3){audio.currentTime=0;return}load(songIndex-1,true)}
function progress(){if(!root)return;const p=root.querySelector('[data-act="seek"]');if(audio.duration)p.value=audio.currentTime/audio.duration*100;root.querySelector('[data-time="cur"]').textContent=time(audio.currentTime);root.querySelector('[data-time="dur"]').textContent=time(audio.duration);root.querySelector('[data-act="play"]').textContent=audio.paused?'▶':'Ⅱ'}
function refresh(){
  if(!root)return;const p=playlist(),s=p[songIndex];
  root.querySelector('.stw-now-title').textContent=s?.title||'暂无歌曲';
  root.querySelector('.stw-now-sub').textContent=charName()||'全局歌单';
  root.querySelector('[data-role="scope"]').textContent=charName()&&S.autoCharacter?'角色歌单':'全局';
  const cover=root.querySelector('.stw-cover');cover.src=s?.cover||'';cover.style.visibility=s?.cover?'visible':'hidden';
  progress();applyTheme();root.style.display=S.enabled?'':'none';
}
function setScope(k){if(k==='global')return S.music.global.playlist;return scopeList(k)}
function download(data,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function fileInput(cb){const i=document.createElement('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>{const f=i.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{cb(JSON.parse(r.result))}catch{}};r.readAsText(f)};i.click()}
async function loadSettingsPanel(){
  if(settingsLoaded)return;
  const c=ctx();let html='';
  try{html=await c.renderExtensionTemplateAsync?.('third-party/-','settings',{})}catch{}
  if(!html)try{html=await $.get('scripts/extensions/third-party/-/settings.html')}catch{}
  if(!html)return;
  const host=$('#extensions_settings2').length?$('#extensions_settings2'):$('#extensions_settings');
  if(!host.length)return;
  host.append(html);settingsLoaded=true;bindSettings();refreshSettings();
}
function refreshSettings(){
  const q=x=>document.querySelector(x);if(!q('#stw-scope'))return;
  q('#stw-enabled').checked=S.enabled;q('#stw-auto-character').checked=S.autoCharacter;q('#stw-fallback-global').checked=S.fallbackGlobal;q('#stw-autoplay').checked=S.autoplay;q('#stw-volume').value=S.volume;
  if(q('#stw-bound-only'))q('#stw-bound-only').checked=S.scope==='bound';if(q('#stw-global-visible'))q('#stw-global-visible').checked=S.globalVisible;if(q('#stw-global-skin'))q('#stw-global-skin').value=S.globalSkinUrl||'';
  const ck=charKey(),cs=ck?(S.music.characters[ck]||{}):{};if(q('#stw-current-character'))q('#stw-current-character').textContent=charName()||'当前没有选择角色';if(q('#stw-bind'))q('#stw-bind').checked=!!cs.bound;if(q('#stw-char-visible'))q('#stw-char-visible').checked=cs.visible!==false;if(q('#stw-char-enabled'))q('#stw-char-enabled').checked=cs.enabled!==false;if(q('#stw-char-skin'))q('#stw-char-skin').value=cs.skinUrl||'';
  const sel=q('#stw-scope'),old=sel.value;sel.innerHTML='<option value="global">全局歌单</option>';
  chars().forEach(x=>{const o=document.createElement('option');o.value=x.key;o.textContent='角色：'+x.name;sel.appendChild(o)});
  if([...sel.options].some(x=>x.value===old))sel.value=old;
  const list=setScope(sel.value),box=q('#stw-playlist');box.innerHTML=list.length?'':'<div class="stw-help">这里还没有歌曲。</div>';
  list.forEach((s,i)=>{const r=document.createElement('div');r.className='stw-song';r.innerHTML='<span class="stw-song-title"></span><span class="stw-song-url"></span><button class="stw-btn">播放</button><button class="stw-btn">删除</button>';r.children[0].textContent=s.title;r.children[1].textContent=s.url;r.children[2].onclick=()=>{songIndex=i;audio.src=s.url;audio.play().catch(()=>{});refresh()};r.children[3].onclick=()=>{list.splice(i,1);save();refreshSettings();refresh()};box.appendChild(r)});
  const ts=q('#stw-theme-select');ts.innerHTML='';Object.values(S.themes).forEach(t=>{const o=document.createElement('option');o.value=t.id;o.textContent=t.name;ts.appendChild(o)});ts.value=S.currentTheme;
  const t=S.themes[S.currentTheme]||DEFAULT_THEME;q('#stw-theme-name').value=t.name||'';q('#stw-theme-author').value=t.author||'';q('#stw-theme-version').value=t.version||'1.0.0';q('#stw-theme-launcher').value=t.variables?.launcherImage||'';q('#stw-theme-bg').value=t.variables?.backgroundImage||'';q('#stw-theme-accent').value=t.variables?.accent||'#9acbff';q('#stw-theme-css').value=t.css||'';
}
function bindSettings(){
  const q=x=>document.querySelector(x);
  document.querySelectorAll('.stw-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.stw-tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.stw-tab-panel').forEach(x=>x.classList.toggle('active',x.dataset.panel===b.dataset.tab))});
  q('#stw-enabled').onchange=e=>{S.enabled=e.target.checked;save();refresh()};q('#stw-auto-character').onchange=e=>{S.autoCharacter=e.target.checked;save();refresh()};q('#stw-fallback-global').onchange=e=>{S.fallbackGlobal=e.target.checked;save();refresh()};q('#stw-autoplay').onchange=e=>{S.autoplay=e.target.checked;save()};q('#stw-volume').oninput=e=>{S.volume=Number(e.target.value);audio.volume=S.volume;save()};
  q('#stw-scope').onchange=refreshSettings;
  if(q('#stw-bound-only'))q('#stw-bound-only').onchange=e=>{S.scope=e.target.checked?'bound':'global';save();refresh()};if(q('#stw-global-visible'))q('#stw-global-visible').onchange=e=>{S.globalVisible=e.target.checked;save();refresh()};if(q('#stw-global-skin'))q('#stw-global-skin').onchange=e=>{S.globalSkinUrl=e.target.value.trim();save();refresh()};
  if(q('#stw-bind'))q('#stw-bind').onchange=e=>{const k=charKey();if(!k)return;(S.music.characters[k]||={name:charName(),playlist:[],bound:false,visible:true,enabled:true,skinUrl:''}).bound=e.target.checked;save();refreshSettings();refresh()};if(q('#stw-char-visible'))q('#stw-char-visible').onchange=e=>{const k=charKey();if(!k)return;(S.music.characters[k]||={name:charName(),playlist:[],bound:false,visible:true,enabled:true,skinUrl:''}).visible=e.target.checked;save();refresh()};if(q('#stw-char-enabled'))q('#stw-char-enabled').onchange=e=>{const k=charKey();if(!k)return;(S.music.characters[k]||={name:charName(),playlist:[],bound:false,visible:true,enabled:true,skinUrl:''}).enabled=e.target.checked;save();refresh()};if(q('#stw-char-skin'))q('#stw-char-skin').onchange=e=>{const k=charKey();if(!k)return;(S.music.characters[k]||={name:charName(),playlist:[],bound:false,visible:true,enabled:true,skinUrl:''}).skinUrl=e.target.value.trim();save();refresh()};
  q('#stw-use-current').onclick=()=>{const k=charKey();if(!k)return;const s=q('#stw-scope');s.value=k;scopeList(k);refreshSettings()};
  q('#stw-add-song').onclick=()=>{const title=q('#stw-song-title').value.trim(),url=q('#stw-song-url').value.trim(),cover=q('#stw-song-cover').value.trim();if(!title||!url)return;setScope(q('#stw-scope').value).push({id:id(),title,url,cover});q('#stw-song-title').value='';q('#stw-song-url').value='';q('#stw-song-cover').value='';save();refreshSettings();refresh()};
  q('#stw-theme-select').onchange=e=>{S.currentTheme=e.target.value;save();refreshSettings();applyTheme()};
  q('#stw-theme-new').onclick=()=>{const i='theme-'+id();S.themes[i]={...clone(DEFAULT_THEME),id:i,name:'我的主题',author:'',css:''};S.currentTheme=i;save();refreshSettings();applyTheme()};
  q('#stw-theme-duplicate').onclick=()=>{const t=clone(S.themes[S.currentTheme]||DEFAULT_THEME),i='theme-'+id();t.id=i;t.name=t.name+' 副本';S.themes[i]=t;S.currentTheme=i;save();refreshSettings();applyTheme()};
  q('#stw-theme-save').onclick=()=>{const t=S.themes[S.currentTheme]||clone(DEFAULT_THEME);t.name=q('#stw-theme-name').value.trim()||'未命名主题';t.author=q('#stw-theme-author').value.trim();t.version=q('#stw-theme-version').value.trim()||'1.0.0';t.variables={...(t.variables||{}),launcherImage:q('#stw-theme-launcher').value.trim(),backgroundImage:q('#stw-theme-bg').value.trim(),accent:q('#stw-theme-accent').value.trim()||'#9acbff'};t.css=q('#stw-theme-css').value;S.themes[t.id]=t;save();applyTheme();refreshSettings()};
  q('#stw-theme-delete').onclick=()=>{if(S.currentTheme==='default')return;delete S.themes[S.currentTheme];S.currentTheme='default';save();refreshSettings();applyTheme()};
  q('#stw-theme-import').onclick=()=>q('#stw-theme-file').click();q('#stw-theme-file').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const t=JSON.parse(r.result);if(t?.schemaVersion===1&&t?.name&&typeof t.css==='string'){t.id=String(t.id||('theme-'+id())).replace(/[^a-zA-Z0-9_-]/g,'-');S.themes[t.id]=t;S.currentTheme=t.id;save();refreshSettings();applyTheme()}}catch{}};r.readAsText(f)};
  q('#stw-theme-export').onclick=()=>download(S.themes[S.currentTheme],'music-widget-theme-'+S.currentTheme+'.json');
  q('#stw-data-export').onclick=()=>download(S.music,'music-widget-data.json');q('#stw-data-import').onclick=()=>q('#stw-data-file').click();q('#stw-data-file').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(d?.global&&d?.characters){S.music=d;save();refreshSettings();refresh()}}catch{}};r.readAsText(f)};
}
function openSettings(){const b=document.querySelector('#extensionsMenuButton');if(b)b.click();setTimeout(()=>document.querySelector('.stw-settings')?.scrollIntoView({behavior:'smooth',block:'start'}),250)}
function bindEvents(){
  const c=ctx(),es=c.eventSource,et=c.event_types||{};
  if(es&&et.CHAT_CHANGED)es.on(et.CHAT_CHANGED,()=>{songIndex=0;audio.pause();if(S.autoplay&&playlist().length)load(0,true);else refresh();refreshSettings()});
  let last=charKey();setInterval(()=>{const k=charKey();if(k!==last){last=k;songIndex=0;audio.pause();if(S.autoCharacter&&S.autoplay&&playlist().length)load(0,true);else refresh();refreshSettings()}},1000);
}
export async function init(){
  if(initialized)return;
  initialized=true;
  ensure();
  build();
  await loadSettingsPanel();
  bindEvents();
  refresh();
  console.info('[角色音乐播放器] v0.1.1 已加载');
}

// 兼容没有执行 manifest hooks.activate 的酒馆版本，同时用 initialized 防止重复初始化。
if(typeof jQuery==='function'){
  jQuery(()=>{init().catch(err=>console.error('[酒馆音乐小组件] 初始化失败',err));});
}
