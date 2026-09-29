(() => {
    'use strict';

    const KEY = 'st_music_widget_v01';
    const THEMES = ['default', 'gufeng', 'blue-black', 'sakura'];
    const state = load();
    let currentIndex = 0;
    let audio = null;
    let root = null;
    let panelOpen = false;

    function load() {
        try { return Object.assign({ mode: 'character', theme: 'default', autoSwitch: true, volume: 0.7, global: [], characters: {} }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
        catch { return { mode:'character', theme:'default', autoSwitch:true, volume:0.7, global:[], characters:{} }; }
    }
    function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
    function esc(v='') { return String(v).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\':'&#92;'}[c])); }
    function currentCharacter() {
        const name = window.this_chid != null && Array.isArray(window.characters) && window.characters[window.this_chid] ? (window.characters[window.this_chid].name || '') : '';
        const id = window.this_chid != null ? String(window.this_chid) : name;
        return { id, name };
    }
    function list() { return state.mode === 'global' ? state.global : (state.characters[currentCharacter().id] || []); }
    function ensureChar() { const id = currentCharacter().id; if (!state.characters[id]) state.characters[id] = []; return state.characters[id]; }
    function ensureAudio() {
        if (!audio) {
            audio = new Audio(); audio.preload='metadata'; audio.volume=Number(state.volume)||0.7;
            audio.addEventListener('timeupdate', renderProgress); audio.addEventListener('loadedmetadata', renderProgress);
            audio.addEventListener('ended', () => { if (list().length > 1) { currentIndex=(currentIndex+1)%list().length; playCurrent(); } else { render(); } });
            audio.addEventListener('error', () => setStatus('无法播放：请检查 URL 是否为可直接播放的音频文件。'));
        }
        return audio;
    }
    function setStatus(s) { const el=root?.querySelector('.stmw-status'); if(el) el.textContent=s; }
    function playCurrent() {
        const songs=list(); if(!songs.length){ render(); return; }
        if(currentIndex >= songs.length) currentIndex=0;
        const song=songs[currentIndex], a=ensureAudio(); a.src=song.url; a.volume=Number(state.volume)||0.7;
        a.play().then(()=>setStatus('')).catch(()=>setStatus('浏览器阻止了自动播放，请点击播放。'));
        render();
    }
    function renderProgress(){ if(!root||!audio)return; const p=root.querySelector('.stmw-progress'); const time=root.querySelector('.stmw-time'); if(p&&audio.duration) p.value=(audio.currentTime/audio.duration)*100; if(time) time.textContent=`${fmt(audio.currentTime)} / ${fmt(audio.duration)}`; }
    function fmt(n){ if(!Number.isFinite(n))return '00:00'; const m=Math.floor(n/60),s=Math.floor(n%60); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }

    function build() {
        root=document.createElement('div'); root.id='st-music-widget';
        document.body.appendChild(root); render();
    }
    function render() {
        if(!root)return;
        root.dataset.theme=state.theme;
        const songs=list(), char=currentCharacter(), song=songs[currentIndex] || null;
        root.innerHTML=`
          <button class="stmw-fab" title="音乐播放器">♫</button>
          <section class="stmw-panel ${panelOpen?'is-open':''}">
            <header><div><strong>音乐播放器</strong><small>${esc(state.mode==='global'?'全局音乐':(char.name||'当前角色'))}</small></div><button class="stmw-close">×</button></header>
            <div class="stmw-cover">${song?.cover ? `<img src="${esc(song.cover)}">` : '<span>♫</span>'}</div>
            <div class="stmw-title">${esc(song?.name || '还没有歌曲')}</div>
            <div class="stmw-status"></div>
            <input class="stmw-progress" type="range" min="0" max="100" value="0">
            <div class="stmw-time">00:00 / 00:00</div>
            <div class="stmw-controls"><button data-act="prev">⏮</button><button class="stmw-play" data-act="play">${audio&&!audio.paused?'❚❚':'▶'}</button><button data-act="next">⏭</button></div>
            <div class="stmw-volume"><span>🔊</span><input class="stmw-vol" type="range" min="0" max="1" step="0.01" value="${Number(state.volume)||0.7}"></div>
            <div class="stmw-tabs"><button class="${state.mode==='character'?'active':''}" data-mode="character">角色</button><button class="${state.mode==='global'?'active':''}" data-mode="global">全局</button><button data-open="settings">⚙ 美化/管理</button></div>
            <div class="stmw-list">${songs.map((x,i)=>`<button class="stmw-song ${i===currentIndex?'active':''}" data-song="${i}"><span>${i+1}. ${esc(x.name||'未命名')}</span><b>▶</b></button>`).join('') || '<div class="stmw-empty">暂无歌曲</div>'}</div>
          </section>`;
        bind(); renderProgress();
    }
    function bind(){
        root.querySelector('.stmw-fab').onclick=()=>{panelOpen=!panelOpen; root.querySelector('.stmw-panel').classList.toggle('is-open',panelOpen);};
        root.querySelector('.stmw-close').onclick=()=>{panelOpen=false;root.querySelector('.stmw-panel').classList.remove('is-open');};
        root.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{ const songs=list(); if(!songs.length)return; if(b.dataset.act==='play'){ensureAudio(); if(audio.src&&audio.paused)audio.play();else if(audio.src)audio.pause();else playCurrent();} if(b.dataset.act==='prev'){currentIndex=(currentIndex-1+songs.length)%songs.length;playCurrent();} if(b.dataset.act==='next'){currentIndex=(currentIndex+1)%songs.length;playCurrent();} render(); });
        root.querySelectorAll('[data-song]').forEach(b=>b.onclick=()=>{currentIndex=Number(b.dataset.song);playCurrent();});
        root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;currentIndex=0;save();render();});
        root.querySelector('[data-open="settings"]').onclick=openSettings;
        root.querySelector('.stmw-progress').oninput=e=>{if(audio?.duration)audio.currentTime=audio.duration*(Number(e.target.value)/100);};
        root.querySelector('.stmw-vol').oninput=e=>{state.volume=Number(e.target.value);ensureAudio().volume=state.volume;save();};
    }
    function openSettings(){
        const old=root.querySelector('.stmw-modal'); old?.remove();
        const songs=list();
        const modal=document.createElement('div'); modal.className='stmw-modal';
        modal.innerHTML=`<div class="stmw-dialog"><header><strong>音乐管理 / 美化</strong><button class="stmw-modal-close">×</button></header>
          <label>播放器美化 <select class="stmw-theme">${THEMES.map(t=>`<option value="${t}" ${t===state.theme?'selected':''}>${label(t)}</option>`).join('')}</select></label>
          <label class="stmw-check"><input class="stmw-auto" type="checkbox" ${state.autoSwitch?'checked':''}> 切换角色时自动切换角色歌单</label>
          <div class="stmw-form"><input class="stmw-name" placeholder="歌曲名字"><input class="stmw-url" placeholder="音频 URL（mp3/ogg/wav/m4a）"><input class="stmw-cover" placeholder="封面 URL（可选）"><button class="stmw-add">＋ 添加歌曲</button></div>
          <div class="stmw-manage">${songs.map((x,i)=>`<div><span>${esc(x.name||'未命名')}</span><button data-del="${i}">删除</button></div>`).join('') || '<em>暂无歌曲</em>'}</div>
          <p class="stmw-hint">当前编辑：${esc(state.mode==='global'?'全局音乐':(currentCharacter().name||'当前角色'))}</p>
        </div>`;
        root.appendChild(modal);
        modal.querySelector('.stmw-modal-close').onclick=()=>modal.remove();
        modal.querySelector('.stmw-theme').onchange=e=>{state.theme=e.target.value;save();render();openSettings();};
        modal.querySelector('.stmw-auto').onchange=e=>{state.autoSwitch=e.target.checked;save();};
        modal.querySelector('.stmw-add').onclick=()=>{const n=modal.querySelector('.stmw-name').value.trim(),u=modal.querySelector('.stmw-url').value.trim(),c=modal.querySelector('.stmw-cover').value.trim();if(!n||!u)return; (state.mode==='global'?state.global:ensureChar()).push({name:n,url:u,cover:c});save();render();openSettings();};
        modal.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{(state.mode==='global'?state.global:ensureChar()).splice(Number(b.dataset.del),1);currentIndex=0;save();render();openSettings();});
    }
    function label(t){return ({'default':'默认','gufeng':'古风','blue-black':'蓝黑','sakura':'樱花'})[t]||t;}

    function hookCharacterSwitch(){
        let last=currentCharacter().id;
        setInterval(()=>{const now=currentCharacter().id;if(now!==last){last=now;currentIndex=0;if(state.autoSwitch&&state.mode==='character'&&list().length)playCurrent();else render();}},800);
    }
    function init(){ if(document.getElementById('st-music-widget'))return; build(); hookCharacterSwitch(); }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
