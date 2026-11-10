codexPlus.extension((ctx) => {
  'use strict';
  const ID = 'live-wallpaper-studio';
  const $ = (tag, cls, value) => { const e = document.createElement(tag); e.setAttribute('data-codex-plus-ext', ID); if (cls) e.className = cls; if (value != null) e.textContent = value; return e; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  const friendlyError = error => String(error?.message || error || '未知错误').split('\n')[0].replace(/^Error:\s*/, '').slice(0, 220);
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1"/><path d="m5 17 5-5 4 4 2-2 3 3"/></svg>';
  const sourceNames = {all:'全部数据源',mixkit:'Mixkit',moe:'MoeWalls',motion:'MotionBgs',waifu:'WallpaperWaifu',free:'LiveWallpapers4Free'};
  const topics=[{"id":"all","label":"全部分类","routes":{"mixkit":"","moe":"","motion":"","waifu":"","free":""}},{"id":"nature","label":"自然风景","routes":{"mixkit":"nature","moe":"landscape","motion":"nature","waifu":"landscape","free":"nature-live-wallpapers"}},{"id":"human","label":"人文 / 生活","routes":{"mixkit":"people","moe":"lifestyle","waifu":"lifestyle","free":"people-live-wallpapers"}},{"id":"city","label":"城市 / 建筑","routes":{"mixkit":"city","motion":"city","free":"world-live-wallpapers"}},{"id":"abstract","label":"抽象 / 几何","routes":{"mixkit":"abstract","moe":"abstract","motion":"abstract","waifu":"abstract","free":"abstract-live-wallpapers"}},{"id":"anime","label":"动漫 / 二次元","routes":{"moe":"anime","motion":"anime","waifu":"anime","free":"anime-live-wallpapers"}},{"id":"games","label":"游戏","routes":{"moe":"games","motion":"games","waifu":"games","free":"games-live-wallpapers"}},{"id":"fantasy","label":"幻想 / 科幻","routes":{"moe":"fantasy","motion":"space","waifu":"fantasy","free":"fantasy-live-wallpapers"}},{"id":"pixel","label":"像素艺术","routes":{"moe":"pixel-art","waifu":"pixel-art"}}];
  const sourceLabels = [["all","全部数据源 · 聚合"],["mixkit","Mixkit · 实拍 / 抽象素材"],["moe","MoeWalls · 动态壁纸"],["motion","MotionBgs · HD / 4K"],["waifu","WallpaperWaifu · 动态壁纸"],["free","LiveWallpapers4Free · HD / 4K"]];
  const defaults = { enabled: true, dim: ctx.config.dim ?? 38, blur: ctx.config.blur ?? 0, glass: ctx.config.glass ?? 62, fit: ctx.config.fit ?? 'contain', quality:ctx.config.quality ?? 'auto', glassBlur:ctx.config.glassBlur ?? 8, focalX:50, focalY:50, speed: 1, paused: false, pauseHidden: ctx.config.pauseHidden ?? true, respectMotion: ctx.config.respectMotion ?? true, motionConsent: false, interval: 0 };
  let settings = { ...defaults, ...ctx.storage.get('settings', {}) };
  let favorites = ctx.storage.get('favorites', []), locals = ctx.storage.get('locals', []);
  const builtins = [
    { id: 'builtin:rain', source: 'builtin', title: '深蓝雨幕', scene: 'rain', kind: 'scene' },
    { id: 'builtin:stars', source: 'builtin', title: '远航星空', scene: 'stars', kind: 'scene' },
    { id: 'builtin:matrix', source: 'builtin', title: '代码之雨', scene: 'matrix', kind: 'scene' }
  ];
  let current = ctx.storage.get('current', null), activeMedia = null, activeBlob = '', loadVersion = 0, busy = false, playback = '等待选择', lastError = '', disposed = false;
  let root, layer, canvas, shade, mediaBox, style, panel;
  let uiListeners = new Set(), fpsAt = 0, frame = 0, raf = 0, lastFrame = 0, motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const marked = new Set(), glassOverrides = new Map();
  const thumbPromises = new Map(); let thumbnailQueue = [], thumbnailWorkers = 0, playbackRevision = 0;
  const thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const image = entry.target; thumbnailObserver.unobserve(image);
      thumbnail(image.dataset.thumbnail).then(src => { if (image.isConnected) image.src = src; }).catch(() => { if (image.isConnected) { image.parentElement.prepend($('div', 'lws-scene-art', '▷')); image.remove(); } });
    }
  }, { rootMargin: '160px' });
  function thumbnail(url) {
    if (!thumbPromises.has(url)) {
      thumbPromises.set(url, new Promise((resolve, reject) => { thumbnailQueue.push({ url, resolve, reject }); pumpThumbnails(); }));
    }
    return thumbPromises.get(url);
  }
  function pumpThumbnails() {
    while (!disposed && thumbnailWorkers < 3 && thumbnailQueue.length) {
      const task = thumbnailQueue.shift(); thumbnailWorkers++;
      ctx.backend.call('thumbnail', { url: task.url }, { timeout: 24000 }).then(task.resolve, error => { thumbPromises.delete(task.url); task.reject(error); }).finally(() => { thumbnailWorkers--; pumpThumbnails(); });
    }
  }
  const storeSettings = () => ctx.storage.set('settings', settings);
  const storeList = () => { ctx.storage.set('favorites', favorites); ctx.storage.set('locals', locals); };
  const notify = () => { if (layer) { layer.dataset.playback = playback; layer.dataset.wallpaper = current?.title || '未选择'; layer.dataset.busy = String(busy); } for (const fn of [...uiListeners]) fn(); };
  const reduced = () => settings.respectMotion && motionQuery.matches && !settings.motionConsent;
  const shouldPause = () => settings.paused || !settings.enabled || (settings.pauseHidden && document.hidden) || reduced();
  function saveSettings() { storeSettings(); applyAppearance(); syncPlayback(); notify(); }
  const button = (label, fn, cls = '') => { const b = $('button', 'lws-btn ' + cls, label); b.type = 'button'; b.onclick = fn; return b; };
  function stateLine(message, error = false) { playback = message; lastError = error ? message : ''; notify(); }

  ctx.effect(() => {
    style = $('style'); style.id = 'codex-plus-ext-live-wallpaper-studio-style';
    style.textContent = `
      html[data-live-wallpaper="on"] body{isolation:isolate}
      #lws-background{position:fixed;inset:0;z-index:0;pointer-events:none!important;overflow:hidden;background:#07111d;contain:strict}
      #lws-background>*{position:absolute;inset:0;width:100%;height:100%;pointer-events:none!important}
      #lws-media>*{position:absolute;inset:0;width:100%;height:100%;object-fit:var(--lws-fit,contain);object-position:var(--lws-x,50%) var(--lws-y,50%);filter:blur(var(--lws-blur,0px));transform:none}
      #lws-canvas{filter:blur(var(--lws-blur,0px))}
      #lws-shade{background:rgba(0,0,0,var(--lws-dim,.38))}
      html[data-live-wallpaper="on"] #root{position:relative;z-index:1;background:transparent!important}
      html[data-live-wallpaper="on"] #root:before,html[data-live-wallpaper="on"] #root:after{background:none!important;background-image:none!important}
      html[data-live-wallpaper="on"] [data-lws-clear="true"]{background:transparent!important;background-image:none!important}
      html[data-live-wallpaper="on"] [data-app-shell-frame="true"],html[data-live-wallpaper="on"] [data-app-shell-workspace-row="true"],html[data-live-wallpaper="on"] [data-app-shell-main-surface],html[data-live-wallpaper="on"] [data-app-shell-main-content-layout],html[data-live-wallpaper="on"] [data-app-shell-thread-edge-divider],html[data-live-wallpaper="on"] [data-ds-part="thread"]{background:transparent!important;background-image:none!important}
      html[data-live-wallpaper="on"] [data-app-shell-main-surface]:before,html[data-live-wallpaper="on"] [data-app-shell-main-surface]:after{background:transparent!important;background-image:none!important}
      html[data-live-wallpaper="on"] body #root aside[data-app-shell-left-panel-appearance]{background:rgba(10,14,20,calc(var(--lws-glass,.62)*.55))!important;backdrop-filter:blur(var(--lws-glass-blur,8px))!important}
      html[data-live-wallpaper="on"] [data-app-shell-titlebar="true"]{background:rgba(9,13,20,.18)!important}
      html[data-live-wallpaper="on"] body #root [data-ds-part="composer"]{background:rgba(15,20,28,var(--lws-glass,.62))!important;backdrop-filter:blur(var(--lws-glass-blur,8px))!important;border:1px solid rgba(225,238,250,.19)!important;border-radius:22px;box-shadow:0 8px 32px #0002}
      html[data-live-wallpaper="on"] [data-local-conversation-final-assistant="true"]{background:rgba(12,18,26,calc(var(--lws-glass,.62)*.64));border:1px solid rgba(200,221,240,.14);border-radius:18px;padding:18px}
      html[data-live-wallpaper="on"] body #root [data-user-message-bubble]{background:rgba(45,55,67,calc(var(--lws-glass,.62)*.8))!important;backdrop-filter:blur(var(--lws-glass-blur,8px))!important}
      .lws{font:13px/1.55 var(--font-sans,system-ui,sans-serif);color:var(--codex-plus-text,#e9eef5);background:var(--codex-plus-bg-elevated,#14181f);padding:20px;min-height:100%;box-sizing:border-box;color-scheme:dark;overflow-x:hidden}
      .lws *{box-sizing:border-box}.lws h2,.lws h3,.lws p{margin:0}.lws h2{font-size:19px;letter-spacing:.02em;font-weight:650}.lws h3{font-size:13px;font-weight:600}
      .lws-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.lws-kicker{font-size:10px;letter-spacing:.16em;color:#87a1b6;margin-bottom:3px}.lws-sub{font-size:12px;color:var(--codex-plus-text-muted,#9aa8b7)}
      .lws-btn{font:inherit;color:inherit;border:1px solid var(--codex-plus-border,#ffffff20);border-radius:9px;background:color-mix(in srgb,var(--codex-plus-bg-elevated,#242c36) 90%,white 5%);padding:7px 11px;cursor:pointer;min-height:34px;transition:background .15s;white-space:nowrap}
      .lws-btn:hover{background:color-mix(in srgb,var(--codex-plus-bg-elevated,#243342) 78%,#8bc9df 22%)}.lws-btn:disabled{opacity:.4;cursor:wait}.lws button:focus-visible,.lws input:focus-visible,.lws select:focus-visible,.lws summary:focus-visible{outline:2px solid #87d6e9;outline-offset:3px}
      .lws-primary{background:#b6dce3;color:#10252c;border-color:#b6dce3;font-weight:600}.lws-primary:hover{background:#d0f1f4}.lws-small{font-size:11px;padding:4px 8px;min-height:29px}.lws-icon{padding:4px 9px;min-width:32px}
      .lws-now{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--codex-plus-border,#ffffff1a);padding-bottom:16px;margin-bottom:16px}.lws-now-art{width:80px;height:52px;object-fit:cover;border-radius:7px;background:linear-gradient(130deg,#0a344a,#1e243e)}.lws-now-meta{flex:1;min-width:0}.lws-current-title{font-weight:600;overflow-wrap:anywhere}.lws-status{font-size:11px;color:#a7cbd3;overflow-wrap:anywhere;margin-top:3px}.lws-status[data-error="true"]{color:#ffb8a4}
      .lws-controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}.lws-motion{padding:9px 11px;background:#9acbd810;border:1px solid #9acbd830;border-radius:8px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;gap:8px}.lws-motion span{flex:1}
      .lws-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:0 0 12px}.lws-tab{border-color:transparent;background:transparent;color:#9eacb8;font-size:12px}.lws-tab[aria-pressed="true"]{color:#d8f2f5;background:#74c7d91a;border-color:#74c7d94d}
      .lws-filters{display:grid;grid-template-columns:1fr 115px;gap:7px;margin-bottom:8px}.lws-search{display:flex;gap:6px;grid-column:1/-1}.lws input[type="search"],.lws input[type="text"],.lws select{font:inherit;background:#10182088;color:inherit;border:1px solid var(--codex-plus-border,#ffffff24);padding:8px 10px;border-radius:8px;min-width:0;max-width:100%;height:35px}.lws input[type="search"]{flex:1;width:100%}.lws select{width:100%}
      .lws-source-note{font-size:11px;color:#8f9da9;margin-bottom:10px}.lws-result-status{display:flex;align-items:center;gap:8px;font-size:12px;min-height:35px;color:#a8b7c4;margin:4px 0 10px;overflow-wrap:anywhere}.lws-result-status[data-error="true"]{color:#ffb8a4}
      .lws-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 10px}.lws-card{min-width:0;position:relative}.lws-card-cover{width:100%;border:1px solid #ffffff18;border-radius:10px;padding:0;overflow:hidden;display:block;background:#0d1c2b;cursor:pointer;aspect-ratio:16/9;position:relative;color:inherit}.lws-card-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}.lws-card-cover:hover img{transform:scale(1.045)}.lws-card[data-active="true"] .lws-card-cover{outline:2px solid #a6e3ec;outline-offset:2px}.lws-play{position:absolute;right:7px;bottom:6px;padding:2px 7px;border-radius:5px;background:#08121bbb;color:#f3fbff;font-size:10px}.lws-card-title{font-size:12px;font-weight:500;margin:7px 0 1px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.45;overflow-wrap:anywhere;padding-right:24px;min-height:35px}.lws-credit{font-size:10px;color:#91a3af}.lws-fav{position:absolute;right:0;bottom:15px;background:transparent;border:0;color:#a6cbd6;cursor:pointer;font-size:19px;padding:3px;line-height:1;min-width:27px;min-height:29px}.lws-scene-art{width:100%;height:100%;background:radial-gradient(ellipse at 70% 0,#2c6d8250,transparent 65%),linear-gradient(150deg,#071422,#163b50 60%,#111a30);display:flex;align-items:center;justify-content:center;color:#bfe9f8;font-size:28px;letter-spacing:.25em}
      .lws-empty{grid-column:1/-1;padding:25px 12px;text-align:center;color:#a7b8c7;border:1px dashed #ffffff25;border-radius:10px}.lws-pagination{display:flex;align-items:center;justify-content:center;gap:12px;margin:18px 0}.lws-divider{border:0;border-top:1px solid var(--codex-plus-border,#ffffff1c);margin:18px 0}.lws details{margin:14px 0}.lws summary{cursor:pointer;font-size:13px;padding:6px 0;list-style-position:inside}.lws-settings{display:grid;gap:13px;margin-top:12px}.lws-range-row{display:grid;grid-template-columns:80px 1fr 36px;align-items:center;gap:8px;font-size:12px}.lws-range-row input{width:100%;accent-color:#a8dce6}.lws-range-row output{text-align:right;font-variant-numeric:tabular-nums;color:#b1c8d0}.lws-check{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer}.lws-check input{accent-color:#a8dce6}.lws-field{display:flex;align-items:center;gap:10px;font-size:12px}.lws-field>span{min-width:80px}.lws-field select{flex:1}.lws-import{display:flex;flex-direction:column;gap:8px;margin-top:12px}.lws-inline{display:flex;gap:6px;flex-wrap:wrap}.lws-import input{width:100%}.lws a{color:#9bd6e1;text-decoration:none}.lws a:hover{text-decoration:underline}.lws-foot{font-size:11px;color:#899ba8;line-height:1.65;margin-top:18px}.lws-foot a{margin-right:10px}.lws .lws-badge{font-size:10px;letter-spacing:.06em;background:#8ed1df17;border:1px solid #8ed1df2b;border-radius:5px;padding:3px 6px;color:#b4dbe3}
      .lws-clarity{border-bottom:1px solid var(--codex-plus-border,#ffffff20);padding-bottom:12px}.lws-diagnostic{font-size:12px;font-variant-numeric:tabular-nums;color:#b9d9df;overflow-wrap:anywhere}.lws-range-row{grid-template-columns:70px minmax(0,1fr) 40px}.lws-field select{min-width:0}.lws-origin{font-size:12px}
      .lws-filter-section{margin:12px 0}.lws-filter-section h3{margin-bottom:10px}.lws-filter-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.85fr);gap:8px}.lws-filter-field{display:flex;min-width:0;flex-direction:column;gap:5px;font-size:11px;color:var(--codex-plus-text-muted,#a9b8c5)}.lws-filter-field select{color:var(--codex-plus-text,#e9eef5)}.lws-category-chips{display:flex;gap:5px;flex-wrap:wrap;margin:10px 0}.lws-category-chip[aria-pressed="true"]{background:#74c7d91a;border-color:#74c7d94d;color:#d8f2f5}.lws-filter-section .lws-source-note{margin:8px 0 0}.lws-result-status{flex-wrap:wrap}.lws-partial{font-size:11px;color:#e5c88c}.lws-clarity{margin-top:20px!important}
      @media(max-width:700px){.lws{padding:14px}.lws-grid{gap:10px 8px}.lws-card-title{font-size:11px}}
      @media(prefers-reduced-motion:reduce){.lws *{transition:none!important}}
      html[data-theme="light"] .lws{--codex-plus-text-muted:#536574}.lws [hidden]{display:none!important}
    `;
    document.head.append(style);
    layer = $('div'); layer.id = 'lws-background'; layer.setAttribute('aria-hidden', 'true');
    canvas = $('canvas'); canvas.id = 'lws-canvas';
    mediaBox = $('div'); mediaBox.id = 'lws-media'; shade = $('div'); shade.id = 'lws-shade';
    layer.append(canvas, mediaBox, shade); document.body.prepend(layer);
    return () => { restoreGlass(); disposed = true; loadVersion++; playbackRevision++; thumbnailObserver.disconnect(); cancelAnimationFrame(raf); activeMedia?.pause?.(); if (activeBlob) URL.revokeObjectURL(activeBlob); mediaBox.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); }); layer.remove(); style.remove(); document.documentElement.removeAttribute('data-live-wallpaper'); for (const e of marked) { if (e.getAttribute('data-lws-clear') === 'true') e.removeAttribute('data-lws-clear'); } for (const k of ['--lws-dim', '--lws-blur', '--lws-glass', '--lws-fit', '--lws-glass-blur','--lws-x','--lws-y']) document.documentElement.style.removeProperty(k); uiListeners.clear(); };
  });

  function restoreGlass() {
    for(const [node,original] of glassOverrides) {
      if(node.style.getPropertyValue('backdrop-filter')===original.applied) {
        if(original.value)node.style.setProperty('backdrop-filter',original.value,original.priority);else node.style.removeProperty('backdrop-filter');
      }
    }
    glassOverrides.clear();
  }
  function syncGlass() {
    if(!settings.enabled){restoreGlass();return;}
    // Inline important is necessary here: some installed themes use important rules in cascade layers.
    // Preserve prior inline styles, touch only these three inspected glass surfaces, restore on disable/unload.
    const value='blur('+clamp(settings.glassBlur,0,24)+'px)';
    for(const [node,original] of glassOverrides)if(!node.isConnected){if(node.style.getPropertyValue('backdrop-filter')===original.applied){if(original.value)node.style.setProperty('backdrop-filter',original.value,original.priority);else node.style.removeProperty('backdrop-filter');}glassOverrides.delete(node);}
    for(const node of document.querySelectorAll('[data-ds-part="composer"],aside[data-app-shell-left-panel-appearance],[data-user-message-bubble]')){
      if(!glassOverrides.has(node))glassOverrides.set(node,{value:node.style.getPropertyValue('backdrop-filter'),priority:node.style.getPropertyPriority('backdrop-filter'),applied:value});
      const entry=glassOverrides.get(node);entry.applied=value;
      if(node.style.getPropertyValue('backdrop-filter')!==value||node.style.getPropertyPriority('backdrop-filter')!=='important')node.style.setProperty('backdrop-filter',value,'important');
    }
  }
  function clearSurface(e) { if (!e || e === document.body || e === document.documentElement || marked.has(e)) return; e.setAttribute('data-lws-clear', 'true'); marked.add(e); }
  function scanSurfaces() {
    for (const selector of ['[data-ds-part="main"]', '[data-ds-part="thread"]', '[data-app-shell-left-panel-appearance]']) {
      const el = document.querySelector(selector); let e = selector.includes('left-panel') ? el?.parentElement : el;
      while (e && e !== document.body && e !== document.documentElement) { clearSurface(e); e = e.parentElement; }
    }
    // The native composer keeps its own glass; only its outer layout ancestors are cleared.
    let e = document.querySelector('[data-ds-part="composer"]')?.parentElement;
    while (e && e !== document.body && e !== document.documentElement) { clearSurface(e); e = e.parentElement; }
  }
  ctx.onScan(()=>{scanSurfaces();syncGlass();}); scanSurfaces(); syncGlass();
  function applyAppearance() {
    root = document.documentElement; root.setAttribute('data-live-wallpaper', settings.enabled ? 'on' : 'off');
    root.style.setProperty('--lws-dim', clamp(settings.dim, 0, 85) / 100); root.style.setProperty('--lws-blur', clamp(settings.blur, 0, 18) + 'px'); root.style.setProperty('--lws-glass', clamp(settings.glass, 15, 95) / 100); root.style.setProperty('--lws-fit', ['cover', 'contain', 'fill'].includes(settings.fit) ? settings.fit : 'contain');
    syncGlass();
    root.style.setProperty('--lws-glass-blur',clamp(settings.glassBlur,0,24)+'px'); root.style.setProperty('--lws-x',clamp(settings.focalX,0,100)+'%'); root.style.setProperty('--lws-y',clamp(settings.focalY,0,100)+'%');
    layer.hidden = !settings.enabled; if (activeMedia?.tagName === 'VIDEO') activeMedia.playbackRate = clamp(settings.speed, .25, 2);
  }
  let w = 1, h = 1, points = [];
  function resize() { w = innerWidth; h = innerHeight; const d = Math.min(devicePixelRatio || 1, 1.4); canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); canvas.getContext('2d')?.setTransform(d, 0, 0, d, 0, 0); points = Array.from({ length: 90 }, () => ({ x: Math.random() * w, y: Math.random() * h, z: .2 + Math.random() * .8, length: 8 + Math.random() * 25 })); drawScene(0); notify(); }
  function drawScene(dt) {
    const c = canvas.getContext('2d'); if (!c) return;
    const scene = current?.scene || 'rain';
    c.fillStyle = scene === 'matrix' ? '#031011' : '#071321'; c.fillRect(0, 0, w, h);
    const glow = c.createRadialGradient(w * .72, h * .22, 0, w * .7, h * .35, w * .8); glow.addColorStop(0, scene === 'matrix' ? '#0c363b' : '#15394e'); glow.addColorStop(1, '#030914'); c.fillStyle = glow; c.fillRect(0, 0, w, h);
    for (let i = 0; i < points.length; i++) {
      const p = points[i]; if (dt) { p.y += (scene === 'stars' ? 4 : 120) * p.z * dt / 1000; if (p.y > h + 30) p.y = -30; }
      if (scene === 'stars') { c.fillStyle = `rgba(199,229,248,${p.z * .8})`; c.beginPath(); c.arc(p.x, p.y, p.z * 1.5, 0, Math.PI * 2); c.fill(); }
      else if (scene === 'matrix') { c.font = `${12 + p.z * 7}px monospace`; c.fillStyle = `rgba(80,211,203,${p.z * .55})`; c.fillText('01<>/{}'[Math.floor((i + frame / 15) % 7)], p.x, p.y); }
      else { c.strokeStyle = `rgba(127,202,236,${p.z * .45})`; c.lineWidth = p.z; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - 3, p.y + p.length); c.stroke(); }
    }
  }
  function tick(now) { raf = 0; if (disposed || shouldPause() || activeMedia || !settings.enabled) return; if (now - lastFrame >= 40) { drawScene(Math.min(80, now - lastFrame)); lastFrame = now; frame++; } raf = requestAnimationFrame(tick); }
  function syncPlayback() {
    const revision = ++playbackRevision, target = activeMedia;
    cancelAnimationFrame(raf); raf = 0;
    if (activeMedia?.tagName === 'VIDEO') {
      if (shouldPause()) { activeMedia.pause(); stateLine(reduced() ? '已按系统“减少动态效果”暂停' : settings.enabled ? '已暂停' : '壁纸已关闭'); }
      else { activeMedia.play().then(() => { if (!disposed && revision === playbackRevision && activeMedia === target && !shouldPause()) stateLine('静音循环播放'); }).catch(e => { if (!disposed && revision === playbackRevision && !shouldPause()) stateLine('播放被阻止，请点击“播放”重试', true); }); }
    } else if (activeMedia) stateLine(settings.enabled ? '图片壁纸' : '壁纸已关闭');
    else if (settings.enabled) { stateLine(shouldPause() ? reduced() ? '已按系统“减少动态效果”暂停' : '已暂停' : '内置动态场景 · 低负载'); drawScene(0); if (!shouldPause()) { lastFrame = performance.now(); raf = requestAnimationFrame(tick); } }
    else stateLine('壁纸已关闭');
  }
  ctx.listen(window, 'resize', resize); ctx.listen(document, 'visibilitychange', syncPlayback); ctx.listen(motionQuery, 'change', syncPlayback); resize();
  function acceptMotion() { settings.motionConsent = true; settings.paused = false; storeSettings(); }
  async function localBlobUrl(localId, version) {
    let offset = 0, total = 1, type = '', chunks = [];
    while (offset < total) {
      if (disposed || version !== loadVersion) throw new Error('已切换其他壁纸');
      const r = await ctx.backend.call('mediaChunk', { localId, offset }, { timeout: 24000 }); total = r.total; type = r.type;
      if (total > 256 * 1024 * 1024) throw new Error('当前页面本地播放上限 256 MB，请先压缩视频');
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0)); chunks.push(bytes); offset += r.bytesRead;
      if (!r.bytesRead && offset < total) throw new Error('媒体文件读取不完整');
    }
    return URL.createObjectURL(new Blob(chunks, { type }));
  }
  async function choose(item, userGesture = true) {
    const version = ++loadVersion; playbackRevision++; const previous = current; busy = true; lastError = ''; if (userGesture) acceptMotion(); stateLine('正在准备壁纸，保留当前画面…');
    let candidateBlob = '';
    try {
      if (item.kind === 'scene') {
        activeMedia?.pause?.(); mediaBox.replaceChildren(); activeMedia = null; if (activeBlob) URL.revokeObjectURL(activeBlob); activeBlob = ''; current = { ...item }; canvas.hidden = false;
      } else {
        let resource = item;
        if (resource.page && sourceNames[resource.source] && resource.resolvedQuality !== settings.quality) {
          const resolved=await ctx.backend.call('resolve',{source:resource.source,page:resource.page,quality:settings.quality},{timeout:24000});
          resource={...resource,...resolved}; delete resource.localId;
        } else if (!resource.url && !resource.localId) resource = { ...resource, ...(await ctx.backend.call('resolve', { source: item.source, page: item.page, quality:settings.quality }, {timeout:24000})) };
        if (disposed || version !== loadVersion) return;
        // Remote videos stream directly; local files and restricted sources use cached Blob media.
        let playbackUrl = resource.url;
        if (resource.localId) playbackUrl = candidateBlob = await localBlobUrl(resource.localId, version);
        const makeMedia = url => new Promise((resolve, reject) => {
          const isVideo = resource.kind !== 'image', m = $(isVideo ? 'video' : 'img');
          if (isVideo) { m.muted = true; m.defaultMuted = true; m.loop = true; m.playsInline = true; m.preload = 'auto'; m.playbackRate = clamp(settings.speed, .25, 2); }
          m.style.opacity = '0'; mediaBox.append(m); let timer;
          const done = error => { clearTimeout(timer); m.onload = m.onloadeddata = m.onerror = null; if (error) { m.pause?.(); m.remove(); reject(error); } else resolve(m); };
          m.onload = m.onloadeddata = () => done(); m.onerror = () => done(new Error('该视频暂时无法播放')); timer = setTimeout(() => done(new Error('视频加载超时')), 18000); m.src = url;
        });
        let m;
        try { m = await makeMedia(playbackUrl); } catch (firstError) {
          if (disposed || version !== loadVersion) return;
          stateLine('直连失败，正在通过本地缓存重试…');
          if (resource.localId) throw firstError;
          try {
            const cached = await ctx.backend.call('prepare', { url: resource.url }, { timeout: 24000 }); resource.localId = cached.localId; candidateBlob = await localBlobUrl(cached.localId, version); m = await makeMedia(candidateBlob);
          } catch(cacheError) {
            const preview=resource.variants?.find(x=>x.quality==='preview');
            if (!preview || resource.selectedQuality==='preview') throw cacheError;
            if(disposed||version!==loadVersion)throw Error('已切换其他壁纸');
            if(candidateBlob)URL.revokeObjectURL(candidateBlob);candidateBlob='';
            resource={...resource,url:preview.url,selectedQuality:'preview',qualityLabel:'预览',qualityNotice:'高清版本未能播放，已回退预览：'+friendlyError(cacheError)};delete resource.localId;
            stateLine('高清未能播放，正在回退预览…');m=await makeMedia(resource.url);
          }
        }
        if (disposed || version !== loadVersion) { m.pause?.(); m.remove(); return; }
        activeMedia?.pause?.(); for (const old of [...mediaBox.children]) if (old !== m) { old.pause?.(); old.remove(); }
        if (activeBlob) URL.revokeObjectURL(activeBlob); activeBlob = candidateBlob; candidateBlob = ''; activeMedia = m; m.style.opacity = '1'; canvas.hidden = true; current = resource;
        if (m.tagName === 'VIDEO') m.addEventListener('error', () => { if (activeMedia === m) stateLine('视频连接中断，请重试或换一张壁纸', true); });
      }
      if (userGesture) settings.enabled = true; ctx.storage.set('current', current); storeSettings(); applyAppearance(); resize(); syncPlayback();
      if (userGesture) ctx.toast('已应用：' + item.title, { type: 'success' });
    } catch (e) { if (version === loadVersion && !disposed) { current = previous; stateLine('加载失败：' + friendlyError(e), true); ctx.toast('壁纸加载失败，已保留原背景', { type: 'error' }); } }
    finally { if (candidateBlob) URL.revokeObjectURL(candidateBlob); if (version === loadVersion) { busy = false; notify(); } }
  }
  function mediaDiagnostics() {
    const vw=activeMedia?.videoWidth||activeMedia?.naturalWidth||0, vh=activeMedia?.videoHeight||activeMedia?.naturalHeight||0;
    if (!vw||!vh) return {text:current?.kind==='scene'?'内置实时场景 · 与视频分辨率无关':'读取媒体尺寸…', hint:'背景模糊影响整幅画面；玻璃模糊仅影响本拓展的侧栏与输入框。'};
    const bw=layer.clientWidth||innerWidth,bh=layer.clientHeight||innerHeight;
    const fit=settings.fit,scale=fit==='contain'?Math.min(bw/vw,bh/vh):Math.max(bw/vw,bh/vh);
    const cropX=fit==='cover'?Math.max(0,1-bw/(vw*scale))*100:0,cropY=fit==='cover'?Math.max(0,1-bh/(vh*scale))*100:0;
    const factor=(fit==='fill'?Math.max(bw/vw,bh/vh):scale)*(devicePixelRatio||1);
    let hint=fit==='cover'?'填充会裁切：横向约 '+cropX.toFixed(1)+'%，纵向约 '+cropY.toFixed(1)+'%。可切完整显示，或调整主体位置。':fit==='fill'?'拉伸会改变视频原始比例，人物与圆形可能变形。':'保持原比例，完整显示；比例不同会留边，不裁切。';
    if(factor>1.05)hint+=' 当前原片需放大约 '+factor.toFixed(2)+'×（含屏幕缩放），建议换高清原片。';
    if(settings.blur>0)hint+=' 整体模糊 '+settings.blur+'px。';
    if(current?.qualityNotice)hint+=' '+current.qualityNotice;
    return {width:vw,height:vh,scale:factor,cropX,cropY,text:vw+' × '+vh+' · '+(current?.qualityLabel||'原始媒体')+' · 窗口 '+bw+' × '+bh,hint};
  }
  function isFavorite(item) { return favorites.some(x => x.id === item.id); }
  function toggleFavorite(item) { if (isFavorite(item)) favorites = favorites.filter(x => x.id !== item.id); else favorites = [...favorites, { ...item }].slice(-200); storeList(); notify(); }
  function randomWallpaper(items) { const pool = (items?.length ? items : favorites.length ? favorites : builtins).filter(x => x.id !== current?.id); if (pool.length) choose(pool[Math.floor(Math.random() * pool.length)]); }
  ctx.setInterval(() => { if (!settings.interval || shouldPause() || busy) return; if (Date.now() - fpsAt < settings.interval * 60000) return; fpsAt = Date.now(); randomWallpaper(favorites.length ? favorites : builtins); }, 15000);

  function render({ container }) {
    container.replaceChildren(); const ui = $('div', 'lws'); ui.id = 'lws-panel'; container.append(ui);
    const savedFilters=ctx.storage.get('browseFilters',{}); let source=savedFilters.source||'all';if(!sourceNames[source])source='all';
    let tab = 'gallery', category = savedFilters.topic||'nature', page = 1, cursor = '', cursors = [''], query = savedFilters.query||'', resultItems = [], next = '', request = 0, browsing = false;
    const top = $('div', 'lws-top'), titleWrap = $('div'); titleWrap.append($('div', 'lws-kicker', 'CODEX / LIVE CANVAS'), $('h2', '', '动态壁纸')); top.append(titleWrap, $('span', 'lws-badge', '整窗背景')); ui.append(top);
    const now = $('div', 'lws-now'), thumb = $('img', 'lws-now-art'); thumb.alt = ''; const meta = $('div', 'lws-now-meta'), title = $('div', 'lws-current-title'), status = $('div', 'lws-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const playbackControls = $('div', 'lws-controls'); const play = button('暂停', null, 'lws-small'); play.dataset.action = 'playback';
    play.onclick = () => { const wasPaused = shouldPause(); acceptMotion(); settings.paused = !wasPaused; saveSettings(); };
    const random = button('随机一张', () => randomWallpaper(tab === 'gallery' ? resultItems : tab === 'favorites' ? favorites : builtins), 'lws-small');
    const off = button('关闭壁纸', () => { settings.enabled = !settings.enabled; saveSettings(); }, 'lws-small'); const retryCurrent = button('重试', () => current && choose(current), 'lws-small'); playbackControls.append(play, random, off, retryCurrent); meta.append(title, status, playbackControls); now.append(thumb, meta); ui.append(now);
    const clarity=$('details','lws-clarity');clarity.open=ctx.storage.get('clarityExpanded',false);clarity.ontoggle=()=>ctx.storage.set('clarityExpanded',clarity.open);clarity.append($('summary','','清晰度与画面适配'));const clarityBox=$('div','lws-settings');clarity.append(clarityBox);ui.append(clarity);
    const diagnostic=$('div','lws-diagnostic'), fitHint=$('div','lws-sub');diagnostic.setAttribute('role','status');diagnostic.setAttribute('aria-live','polite');clarityBox.append(diagnostic,fitHint);
    const motionBox = $('div', 'lws-motion'), motionText = $('span', '', '系统开启了“减少动态效果”，壁纸默认静止。'); motionBox.append(motionText, button('仍然播放', () => { acceptMotion(); saveSettings(); }, 'lws-small')); ui.append(motionBox);
    const tabs = $('div', 'lws-tabs'), tabButtons = [];
    const filterArea=$('section','lws-filter-section');filterArea.id='lws-filter-section';filterArea.setAttribute('aria-label','视频源与分类筛选');
    filterArea.append($('h3','','筛选视频壁纸'));
    const fields=$('div','lws-filter-fields');
    const sourceSelect=$('select');sourceSelect.setAttribute('aria-label','壁纸数据源');for(const [value,label]of sourceLabels){const o=$('option','',label);o.value=value;sourceSelect.append(o);}sourceSelect.value=source;
    const categorySelect=$('select');categorySelect.setAttribute('aria-label','壁纸分类');
    const field=(label,input)=>{const row=$('label','lws-filter-field');row.append($('span','',label),input);fields.append(row);};field('视频数据源',sourceSelect);field('内容分类',categorySelect);filterArea.append(fields);
    const chips=$('div','lws-category-chips');chips.setAttribute('aria-label','常用分类');const chipButtons=[];
    function fillCategories(){categorySelect.replaceChildren();const available=topics.filter(t=>source==='all'||Object.hasOwn(t.routes,source));if(!available.some(t=>t.id===category))category=available.find(t=>t.id==='nature')?.id||available[0].id;for(const t of available){const o=$('option','',t.label);o.value=t.id;categorySelect.append(o);}categorySelect.value=category;for(const [id,b]of chipButtons){b.hidden=!available.some(t=>t.id===id);b.setAttribute('aria-pressed',String(id===category));}}
    for(const [id,label]of [['nature','自然风景'],['human','人文生活'],['city','城市建筑'],['abstract','抽象几何'],['anime','动漫']]){const b=button(label,()=>{category=id;query='';search.value='';fillCategories();resetBrowse();},'lws-small lws-category-chip');b.dataset.category=id;chips.append(b);chipButtons.push([id,b]);}filterArea.append(chips);fillCategories();
    const searchForm=$('form','lws-search'),search=$('input');search.type='search';search.value=query;search.placeholder='搜索：forest / street / abstract';search.setAttribute('aria-label','搜索壁纸，英文关键词');const submit=button('搜索',null,'lws-small');submit.type='submit';const reset=button('重置',()=>{source='all';category='nature';query='';search.value='';sourceSelect.value=source;fillCategories();resetBrowse();},'lws-small');searchForm.append(search,submit,reset);filterArea.append(searchForm);
    const sourceNote=$('div','lws-source-note');filterArea.append(sourceNote);
    function filterNote(){const name=topics.find(t=>t.id===category)?.label||'全部分类';sourceNote.textContent=query?'关键词搜索覆盖所选源的全站内容；选择分类会清空关键词。':source==='mixkit'?'Mixkit 提供实拍与抽象素材；部分短片并非无缝循环，许可以原站为准。':source==='all'?'跨源浏览 · Mixkit 优先展示实拍 / 素材 · 其他源的风景与生活分类可能包含插画。':name+' · 按原站分类，可能包含插画；真实风景、人文推荐选择 Mixkit。';}
    function persistFilters(){ctx.storage.set('browseFilters',{source,topic:category,query});ctx.storage.set('browseSource',source==='all'?'moe':source);filterNote();}
    ui.append(tabs,filterArea);filterNote();
    const catalogStatus = $('div', 'lws-result-status'); catalogStatus.setAttribute('role', 'status'); catalogStatus.setAttribute('aria-live', 'polite');
    let committed = { page: 1, cursor: '', next: '', items: [] };
    const grid = $('div', 'lws-grid'); grid.setAttribute('aria-label', '壁纸图库'); const pagination = $('div', 'lws-pagination'), prev = button('上一页', () => { if (page > 1) { page--; cursor = cursors[page - 1] || ''; browse(); } }, 'lws-small'), pageLabel = $('span', 'lws-sub'), nextButton = button('下一页', () => { if (next) { cursors[page] = next; cursor = next; page++; browse(); } }, 'lws-small'); pagination.append(prev, pageLabel, nextButton); ui.append(catalogStatus, grid, pagination);
    function drawGrid(items) {
      grid.querySelectorAll('img[data-thumbnail]').forEach(i => thumbnailObserver.unobserve(i));
      grid.replaceChildren(); if (!items.length) { const empty = $('div', 'lws-empty', browsing ? '正在读取图库…' : tab === 'favorites' ? '还没有收藏。点击壁纸旁的 ☆ 加入。' : tab === 'local' ? '还没有本地壁纸。在下方选择视频或填写文件路径。' : '没有找到结果，换个关键词试试。'); grid.append(empty); return; }
      for (const item of items) {
        const card = $('div', 'lws-card'); card.dataset.active = String(current?.id === item.id); card.dataset.wallpaperId = item.id;
        const cover = button('', () => choose(item), 'lws-card-cover'); cover.className = 'lws-card-cover'; cover.setAttribute('aria-label', '应用壁纸：' + item.title);
        if (item.thumb) { const image = $('img'); image.alt = item.title; image.loading = 'lazy'; image.dataset.thumbnail = item.thumb; image.style.opacity = '0'; image.onload = () => { image.style.opacity = '1'; }; image.onerror = () => { if (image.isConnected) { cover.prepend($('div', 'lws-scene-art', '▷')); image.remove(); } }; cover.append(image); thumbnailObserver.observe(image); }
        else cover.append($('div', 'lws-scene-art', item.scene === 'stars' ? '✦ · ✧' : item.scene === 'matrix' ? '01 /' : '╱ ╱ ╱'));
        cover.append($('span', 'lws-play', current?.id === item.id ? '使用中' : item.kind === 'scene' ? '内置' : '▷ 应用'));
        const name = $('div', 'lws-card-title', item.title); name.title = item.title;
        const credit = $('div', 'lws-credit', sourceNames[item.source] ? sourceNames[item.source] + (item.source==='mixkit'?' · 实拍 / 素材': ['motion','free'].includes(item.source)?' · HD / 4K 可选':' · 公开预览') : item.source === 'local' ? '本地资源' : item.source === 'custom' ? '自定义媒体' : '内置 · 离线可用');
        const fav = button(isFavorite(item) ? '★' : '☆', () => toggleFavorite(item), 'lws-fav'); fav.className = 'lws-fav'; fav.setAttribute('aria-label', (isFavorite(item) ? '取消收藏：' : '收藏：') + item.title); fav.setAttribute('aria-pressed', String(isFavorite(item)));
        card.append(cover, name, credit, fav); grid.append(card);
      }
    }
    async function browse(refresh = false) {
      const seq = ++request, targetPage = page, targetCursor = cursor; browsing = true; ui.setAttribute('aria-busy', 'true'); catalogStatus.dataset.error = 'false'; catalogStatus.replaceChildren($('span', '', '正在连接 ' + sourceNames[source] + '…')); drawGrid(resultItems); prev.disabled = nextButton.disabled = true;
      try {
        const r = await ctx.backend.call('browseCatalog', { source, topic:category, query, page, cursor, refresh }, { timeout: 24000 });
        if (!container.isConnected || seq !== request || tab !== 'gallery') return;
        resultItems = r.items; next = r.next; committed = { page, cursor, next, items: resultItems }; catalogStatus.replaceChildren($('span', '', r.stale ? `第 ${page} 页 · 网络异常，正在显示上次缓存。` : `${r.items.length} 个视频 · ${sourceNames[source]} · ${topics.find(t=>t.id===category)?.label||''} · 第 ${page} 页${r.cached ? ' · 缓存' : ''}`));
        if(r.partial){catalogStatus.append($('span','lws-partial','部分源暂不可用：'+r.warnings.map(w=>w.name).join('、')));}
        if (r.stale||r.partial) catalogStatus.append(button('重试', () => browse(true), 'lws-small'));
        filterNote();
      } catch (e) {
        if (!container.isConnected || seq !== request || tab !== 'gallery') return;
        page = committed.page; cursor = committed.cursor; next = committed.next; resultItems = committed.items;
        catalogStatus.dataset.error = 'true'; catalogStatus.replaceChildren($('span', '', '第 ' + targetPage + ' 页加载失败：' + e.message), button('重试', () => { page = targetPage; cursor = targetCursor; browse(true); }, 'lws-small'));
      } finally { if (seq === request && tab === 'gallery' && container.isConnected) { browsing = false; ui.setAttribute('aria-busy', 'false'); drawGrid(resultItems); prev.disabled = page <= 1; nextButton.disabled = !next; pageLabel.textContent = '第 ' + page + ' 页'; } }
    }
    function showTab(t) { tab = t; request++; browsing = false; for (const [key, b] of tabButtons) b.setAttribute('aria-pressed', String(t === key)); filterArea.hidden = t !== 'gallery'; sourceNote.hidden = t !== 'gallery'; pagination.hidden = t !== 'gallery'; catalogStatus.textContent = t === 'favorites' ? `${favorites.length} 张收藏 · 随机切换优先使用收藏` : t === 'local' ? `${locals.length} 个本地资源` : t === 'builtin' ? '离线可用 · 无需下载' : ''; catalogStatus.dataset.error = 'false'; if (t === 'gallery') browse(); else drawGrid(t === 'favorites' ? favorites : t === 'local' ? locals : builtins); }
    for (const [t, name] of [['gallery', '在线图库'], ['favorites', '我的收藏'], ['builtin', '内置场景'], ['local', '本地壁纸']]) { const b = button(name, () => showTab(t), 'lws-tab'); b.setAttribute('aria-pressed', String(tab === t)); tabs.append(b); tabButtons.push([t, b]); }
    function resetBrowse() { persistFilters(); page = 1; cursor = ''; cursors = ['']; resultItems = []; next = ''; committed = { page: 1, cursor: '', next: '', items: [] }; browse(); }
    sourceSelect.onchange=()=>{source=sourceSelect.value;fillCategories();resetBrowse();};
    categorySelect.onchange=()=>{category=categorySelect.value;query='';search.value='';fillCategories();resetBrowse();};
    searchForm.onsubmit=e=>{e.preventDefault();query=search.value.trim();if(query)category='all';fillCategories();resetBrowse();};

    const imports = $('details'); imports.append($('summary', '', '导入本地视频 / 视频直链')); const importBox = $('div', 'lws-import');
    const localInput = $('input'); localInput.type = 'file'; localInput.accept = 'video/mp4,video/webm,image/gif,image/png,image/jpeg,image/webp'; localInput.hidden = true;
    localInput.onchange = async () => {
      const file = localInput.files?.[0]; if (!file) return;
      if (file.path) { await importPath(file.path); return; }
      let upload;
      try {
        selectFile.disabled = true; importFeedback.textContent = '正在导入 0%…';
        upload = await ctx.backend.call('beginUpload', { name: file.name, size: file.size });
        for (let offset = 0; offset < file.size; offset += 192 * 1024) {
          const chunk = file.slice(offset, offset + 192 * 1024);
          const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('读取本地文件失败')); reader.readAsDataURL(chunk); });
          await ctx.backend.call('uploadChunk', { id: upload.id, offset, base64: data });
          importFeedback.textContent = '正在导入 ' + Math.round(Math.min(file.size, offset + chunk.size) / file.size * 100) + '%…';
        }
        const item = await ctx.backend.call('finishUpload', { id: upload.id }); locals = [...locals.filter(x => x.id !== item.id), item]; storeList(); await choose(item); importFeedback.textContent = '已保存到壁纸库，重启后仍可使用'; showTab('local');
      } catch (e) { importFeedback.textContent = '导入失败：' + e.message; if (upload) ctx.backend.call('cancelUpload', { id: upload.id }).catch(() => {}); }
      finally { selectFile.disabled = false; localInput.value = ''; }
    };
    const selectFile = button('选择视频 / GIF 文件', () => localInput.click());
    const pathInput = $('input'); pathInput.type = 'text'; pathInput.placeholder = '完整本地路径，例如 D:\\Wallpapers\\rain.mp4'; pathInput.setAttribute('aria-label', '本地壁纸完整路径');
    async function importPath(input) { importFeedback.textContent = '正在复制到壁纸库…'; try { const item = await ctx.backend.call('importLocal', { path: input }, { timeout: 24000 }); locals = [...locals.filter(x => x.id !== item.id), item]; storeList(); await choose(item); importFeedback.textContent = '已导入，重启后仍可使用'; showTab('local'); } catch (e) { importFeedback.textContent = e.message; } }
    const importPathButton = button('导入并记住', () => importPath(pathInput.value));
    const urlInput = $('input'); urlInput.type = 'text'; urlInput.placeholder = 'https://…/wallpaper.mp4 或 .webm'; urlInput.setAttribute('aria-label', '自定义壁纸媒体直链');
    const urlButton = button('应用直链', async () => { try { const r = await ctx.backend.call('resolve', { url: urlInput.value.trim() }); const ext = new URL(r.url).pathname.split('.').pop().toLowerCase(); const item = { id: r.url, source: 'custom', title: decodeURIComponent(new URL(r.url).pathname.split('/').pop()) || '自定义壁纸', kind: ['mp4', 'webm'].includes(ext) ? 'video' : 'image', url: r.url }; await choose(item); if (current?.id === item.id && !isFavorite(item)) toggleFavorite(item); } catch (e) { importFeedback.textContent = e.message; } });
    const importFeedback = $('div', 'lws-sub'); importFeedback.setAttribute('role', 'status'); importBox.append(selectFile, localInput, pathInput, importPathButton, urlInput, urlButton, importFeedback); imports.append(importBox); ui.append(imports);
    const appearance = $('details'); appearance.open = false; appearance.append($('summary', '', '画面与播放设置')); const settingsBox = $('div', 'lws-settings');
    const rangeValues = [], selectValues=[];
    function slider(label, key, min, max, unit) { const row = $('label', 'lws-range-row'), input = $('input'); input.type = 'range'; input.min = min; input.max = max; input.value = settings[key]; input.dataset.setting=key; const output = $('output', '', settings[key] + unit); input.setAttribute('aria-label', label); input.oninput = () => { settings[key] = +input.value; output.textContent = input.value + unit; saveSettings(); }; row.append($('span', '', label), input, output); (['dim','blur','glassBlur','fit','quality','focalX','focalY'].includes(key)?clarityBox:settingsBox).append(row); rangeValues.push([input, key,unit]); }
    slider('背景遮罩', 'dim', 0, 85, '%'); slider('背景模糊', 'blur', 0, 18, 'px'); slider('玻璃模糊', 'glassBlur', 0, 24, 'px'); slider('面板遮罩', 'glass', 15, 95, '%'); slider('主体横向','focalX',0,100,'%'); slider('主体纵向','focalY',0,100,'%');
    function selectSetting(label, key, values, numeric = false) { const row = $('label', 'lws-field'), select = $('select'); for (const [value, name] of values) { const o = $('option', '', name); o.value = value; select.append(o); } select.value = settings[key]; select.dataset.setting=key; select.setAttribute('aria-label',label);selectValues.push([select,key]); select.onchange = () => { settings[key] = numeric ? +select.value : select.value; fpsAt = Date.now(); saveSettings(); if(key==='quality'&&current?.page) choose(current); }; row.append($('span', '', label), select); (['fit','quality'].includes(key)?clarityBox:settingsBox).append(row); }
    selectSetting('视频画质','quality',[['auto','自动 · 优先 1080p'],['preview','预览 · 节省流量'],['hd','1080p · 原版'],['2k','2K · 原版（若可用）'],['4k','4K · 原版（更高负载）']]);
    selectSetting('画面适配', 'fit', [['contain', '完整显示 · 不裁切（推荐）'], ['cover', '填充整窗 · 保持比例但裁切'], ['fill', '拉伸铺满 · 可能变形']]); selectSetting('播放速度', 'speed', [[.5, '0.5×'], [.75, '0.75×'], [1, '1×'], [1.25, '1.25×'], [1.5, '1.5×']], true); selectSetting('自动轮换', 'interval', [[0, '关闭'], [5, '每 5 分钟'], [15, '每 15 分钟'], [30, '每 30 分钟']], true);
    for (const [key, label] of [['pauseHidden', '窗口不可见时暂停'], ['respectMotion', '首次使用尊重系统“减少动态效果”']]) { const row = $('label', 'lws-check'), input = $('input'); input.type = 'checkbox'; input.checked = settings[key]; input.onchange = () => { settings[key] = input.checked; saveSettings(); }; row.append(input, $('span', '', label)); settingsBox.append(row); }
    settingsBox.append(button('恢复推荐遮罩', () => { settings = { ...settings, dim: 38, blur: 0, glass: 62 }; saveSettings(); for (const [input,key,unit] of rangeValues) {input.value=settings[key];input.nextSibling.textContent=settings[key]+unit;} }, 'lws-small')); appearance.append(settingsBox); ui.append(appearance);
    const presets=$('div','lws-inline');presets.append(button('清晰完整',()=>{settings={...settings,blur:0,glassBlur:0,fit:'contain',focalX:50,focalY:50};saveSettings();},'lws-small'),button('柔和填充',()=>{settings={...settings,blur:4,glassBlur:12,fit:'cover'};saveSettings();},'lws-small'));clarityBox.append(presets,$('div','lws-sub','模糊不会提升原片画质。1080p / 4K 仅在原站提供时可用；失败会提示回退预览。完整显示可能留边。'));
    const originalLink=$('a','lws-origin','打开当前壁纸原站 ↗');originalLink.target='_blank';originalLink.rel='noopener noreferrer';clarityBox.append(originalLink);
    const foot = $('div', 'lws-foot'); foot.append($('div', '', '已接入 5 家视频源。Mixkit 提供实拍 / 抽象素材；其余为动态壁纸站。搜索支持英文关键词，搜索时覆盖全站分类。部分短片循环时可能有跳变。MotionBgs / LiveWallpapers4Free 支持原版画质选择；高清版可从原站下载后导入。MP4 / WebM 支持取决于浏览器解码器；本地上限 256 MB，不转码、不压缩。'));
    for (const [label, url] of [['Mixkit ↗','https://mixkit.co/free-stock-video/'],['MoeWalls ↗', 'https://moewalls.com/'], ['MotionBgs ↗', 'https://motionbgs.com/'],['WallpaperWaifu ↗','https://wallpaperwaifu.com/'],['LiveWallpapers4Free ↗','https://livewallpapers4free.com/']]) { const a = $('a', '', label); a.href = url; a.target = '_blank'; a.rel = 'noreferrer noopener'; foot.append(a); } ui.append(foot);
    let previousCurrent = '';
    function update() {
      if (!container.isConnected) { uiListeners.delete(update); return; }
      const d=mediaDiagnostics();diagnostic.textContent=d.text;fitHint.textContent=d.hint;
      for(const [input,key,unit] of rangeValues){if(document.activeElement!==input)input.value=settings[key];input.nextSibling.textContent=settings[key]+unit;input.closest('label').hidden=['focalX','focalY'].includes(key)&&settings.fit!=='cover';}
      for(const [input,key] of selectValues)input.value=settings[key];
      originalLink.hidden=!current?.page;originalLink.href=current?.page||'#';
      title.textContent = current?.title || '深蓝雨幕'; status.textContent = busy ? playback : lastError || playback; status.dataset.error = String(!!lastError); play.textContent = shouldPause() ? '播放' : '暂停'; off.textContent = settings.enabled ? '关闭壁纸' : '开启壁纸'; retryCurrent.hidden = !lastError; motionBox.hidden = !reduced();
      if (current?.thumb && thumb.dataset.original !== current.thumb) { thumb.dataset.original = current.thumb; thumbnail(current.thumb).then(src => { if (thumb.isConnected) thumb.src = src; }).catch(() => {}); } thumb.hidden = !current?.thumb;
      const key = current?.id + ':' + favorites.map(x => x.id).join('|');
      if (key !== previousCurrent) { previousCurrent = key; if (tab !== 'gallery' || resultItems.length) drawGrid(tab === 'gallery' ? resultItems : tab === 'favorites' ? favorites : tab === 'local' ? locals : builtins); }
    }
    uiListeners.add(update);ui.append(clarity);persistFilters();update();browse();
    const stop = ctx.setInterval(() => { if (!container.isConnected) { uiListeners.delete(update); request++; stop(); } }, 2000);
  }
  panel = ctx.registerSidePanel({ title: '动态壁纸', icon, width: 480, render });
  ctx.registerNavEntry({ label: '动态壁纸', icon, onActivate: () => panel.open() });
  ctx.registerMenuItem({ label: '动态壁纸图库', description: '五源分类图库 · 风景 / 人文 / 抽象 · 原版画质 · 本地视频', buttonLabel: '打开图库', onActivate: ({ close }) => { close(); panel.open(); } });
  ctx.registerMenuItem({ label: '启用动态壁纸', description: '关闭立即恢复原界面，壁纸和设置会保留', toggleValue: () => settings.enabled, onChange: next => { settings.enabled = next; saveSettings(); } });
  ctx.registerCommand({ name: 'wallpaper', description: '打开动态壁纸图库', run: () => panel.open() });
  ctx.registerShortcut({ key: 'Mod+Shift+W', run: () => panel.open() });
  if(!ctx.storage.get('introducedCategories120',false)){ctx.storage.set('introducedCategories120',true);ctx.setTimeout(()=>{if(!disposed)panel.open();},600);}
  applyAppearance();
  if (!current || current.url?.startsWith('blob:')) current = builtins[0];
  choose(current, false);
  // Show the library once on first install; subsequent reloads restore quietly.
  if (!ctx.storage.get('introduced', false) || ctx.storage.get('installedVersion', '') !== '1.2.0') { ctx.storage.set('introduced', true); ctx.storage.set('installedVersion', '1.2.0'); ctx.setTimeout(() => { if (!disposed) panel.open(); }, 600); }
});
