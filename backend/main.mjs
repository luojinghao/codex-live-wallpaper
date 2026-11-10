import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UA = 'Mozilla/5.0 CodexLiveWallpaper/1.0';
const MAX = 180 * 1024 * 1024;
export const SOURCES = {
  mixkit: {host:'mixkit.co',name:'Mixkit'},
  moe: { host: 'moewalls.com', name: 'MoeWalls' },
  motion: { host: 'motionbgs.com', name: 'MotionBgs' },
  waifu: { host: 'wallpaperwaifu.com', name: 'WallpaperWaifu' },
  free: { host: 'livewallpapers4free.com', name: 'LiveWallpapers4Free' }
};
export const decode = s => String(s || '').replace(/&#(x?[\da-f]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = s => decode(s.replace(/<[^>]*>/g, '')).trim();
export function attr(tag, name) {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return decode(m?.[1] ?? m?.[2] ?? m?.[3] ?? '');
}
function absolute(s, base) { try { const u = new URL(s, base); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } }
export const TOPICS=[{"id":"all","label":"全部分类","routes":{"mixkit":"","moe":"","motion":"","waifu":"","free":""}},{"id":"nature","label":"自然风景","routes":{"mixkit":"nature","moe":"landscape","motion":"nature","waifu":"landscape","free":"nature-live-wallpapers"}},{"id":"human","label":"人文 / 生活","routes":{"mixkit":"people","moe":"lifestyle","waifu":"lifestyle","free":"people-live-wallpapers"}},{"id":"city","label":"城市 / 建筑","routes":{"mixkit":"city","motion":"city","free":"world-live-wallpapers"}},{"id":"abstract","label":"抽象 / 几何","routes":{"mixkit":"abstract","moe":"abstract","motion":"abstract","waifu":"abstract","free":"abstract-live-wallpapers"}},{"id":"anime","label":"动漫 / 二次元","routes":{"moe":"anime","motion":"anime","waifu":"anime","free":"anime-live-wallpapers"}},{"id":"games","label":"游戏","routes":{"moe":"games","motion":"games","waifu":"games","free":"games-live-wallpapers"}},{"id":"fantasy","label":"幻想 / 科幻","routes":{"moe":"fantasy","motion":"space","waifu":"fantasy","free":"fantasy-live-wallpapers"}},{"id":"pixel","label":"像素艺术","routes":{"moe":"pixel-art","waifu":"pixel-art"}}];
export function parseCatalog(source, html, base) {
  if(source==='mixkit')return parseMixkit(html,base);
  if (source === 'waifu' || source === 'free') return parseWordpress(source, html, base);
  const blocks = source === 'moe' ? [...html.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map(x => x[0]) : [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)].map(x => x[0]).filter(x => /<span\b[^>]*class=["']?ttl\b/i.test(x));
  const seen = new Set(), items = [];
  for (const b of blocks) {
    const a = source === 'moe' ? (b.match(/<h[23]\b[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i) || []) : (b.match(/^<a\b([^>]*)>([\s\S]*)<\/a>/i) || []);
    if (!a[1]) continue;
    const page = absolute(attr(a[1], 'href'), base);
    const img = b.match(/<img\b[^>]*>/i)?.[0] || '';
    const thumb = absolute(attr(img, 'data-src') || attr(img, 'src'), base);
    const title = source === 'moe' ? text(a[2]) : text(b.match(/<span\b[^>]*class=["']?ttl\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || attr(a[1], 'title'));
    if (!page || !thumb || !title || seen.has(page)) continue;
    seen.add(page);
    items.push({ id: page, source, title: title.replace(/ Live Wallpaper$/i, ''), page, thumb, kind: 'video' });
  }
  const nextTag = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].map(x => x[0]).find(x => attr(x, 'rel').split(/\s/).includes('next'));
  return { items: items.slice(0, 60), next: nextTag ? absolute(attr(nextTag, 'href'), base) : '' };
}
export function parseMedia(html, base) {
  for (const tag of [...html.matchAll(/<(?:source|video)\b[^>]*>/gi)].map(x => x[0])) {
    const src = attr(tag, 'src');
    if (/\.(webm|mp4)(?:[?#]|$)/i.test(src)) return absolute(src, base);
  }
  throw new Error('页面没有可播放的 MP4 / WebM 预览，可到原站下载后导入本地视频。');
}

export function parseWordpress(source, html, base) {
  const blocks = source === 'waifu'
    ? [...html.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map(x => x[0])
    : html.split(/(?=<div\b[^>]*\bid=["']post-\d+["'])/i).slice(1);
  const seen = new Set(), items = [];
  for (const block of blocks) {
    const a = source === 'waifu' ? block.match(/<a\b([^>]*)>/i) : block.match(/<h2\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const page = absolute(attr(a[1], 'href'), base);
    const image = block.match(/<img\b[^>]*>/i)?.[0] || '';
    const thumb = absolute(attr(image, 'data-src') || attr(image, 'src'), base);
    const title = source === 'waifu' ? attr(a[1], 'title') || text(block.match(/class=["']wall-caption["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '') : text(a[2]);
    if (!page || !thumb || !title || seen.has(page) || new URL(page).hostname !== SOURCES[source].host) continue;
    seen.add(page); items.push({ id:page, page, title:title.replace(/ Live Wallpaper$/i,''), thumb, source, kind:'video' });
  }
  const nextTag = [...html.matchAll(/<(?:a|link)\b[^>]*>/gi)].map(x=>x[0]).find(x=>attr(x,'rel').split(/\s/).includes('next'));
  return {items:items.slice(0,60),next:nextTag ? absolute(attr(nextTag,'href'),base) : ''};
}

function mixkitVideo(url) {try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='assets.mixkit.co'&&!u.username&&!u.password&&(/^\/(?:videos\/\d+|active_storage\/video_items\/\d+\/\d+)\/[^/]+\.mp4$/.test(u.pathname)||/^\/[a-z\d]{16,80}$/.test(u.pathname))?u.href:'';}catch{return '';}}
function mixkitObjects(html){const found=[];const walk=o=>{if(!o||typeof o!=='object')return;if(o['@type']==='VideoObject')found.push(o);for(const v of Object.values(o)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}};for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(m[1]));}catch{}}return found;}
export function parseMixkit(html,base){
 const metadata=new Map(mixkitObjects(html).map(o=>[String(o['@id']||'').replace(/#.*$/,''),o]));const items=[],seen=new Set();
 const blocks=html.split(/(?=<div\b[^>]*class=["']item-grid-card["'])/i).slice(1);
 for(const block of blocks){
  const link=[...block.matchAll(/<a\b([^>]*)>/gi)].map(m=>m[1]).find(tag=>attr(tag,'class').split(/\s+/).includes('item-grid-video-player__overlay-link'));
  if(!link)continue;const page=absolute(attr(link,'href'),base);if(!page||new URL(page).hostname!=='mixkit.co'||seen.has(page))continue;
  const img=block.match(/<img\b[^>]*>/i)?.[0]||'',thumb=absolute(attr(img,'src'),base),preview=mixkitVideo(attr(block.match(/<video\b[^>]*>/i)?.[0]||'','src'));const title=text(block.match(/class=["']item-grid-video-player__overlay-video-title["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]||attr(img,'alt'));if(!thumb||!preview||!title)continue;
  seen.add(page);const meta=metadata.get(page);items.push({id:page,page,title,thumb,source:'mixkit',kind:'video',previewUrl:preview,contentLabel:'实拍 / 素材',licenseLabel:meta?.copyrightNotice||'以原站许可为准'});
 }
 const nextTag=[...html.matchAll(/<a\b[^>]*>/gi)].map(m=>m[0]).find(t=>attr(t,'class').split(/\s+/).includes('pagination__link--next'));
 return {items:items.slice(0,60),next:nextTag?absolute(attr(nextTag,'href'),base):''};
}
function parseMixkitMedia(html,base){
 const object=mixkitObjects(html).find(o=>String(o['@id']||'').replace(/#.*$/,'')===base.replace(/#.*$/,''))||mixkitObjects(html)[0];
 const preview=mixkitVideo(object?.embedUrl)||[...html.matchAll(/<(?:video|source)\b[^>]*>/gi)].map(m=>mixkitVideo(attr(m[0],'src'))).find(Boolean);
 const main=mixkitVideo(object?.contentUrl);const variants=[];
 if(preview)variants.push({quality:'preview',url:preview,label:'素材预览',format:'mp4'});
 if(main){const height=Number(main.match(/-(\d+)\.mp4$/)?.[1]||0);variants.push({quality:height>=2160?'4k':height>=1080?'hd':'original',url:main,label:(height?height+'p':'原始')+' 素材',format:'mp4'});}
 if(!variants.length)throw Error('素材页面未提供可播放视频，请到原站下载后本地导入。');return variants;
}

export function parseMediaOptions(source, html, base) {
  if(source==='mixkit')return parseMixkitMedia(html,base);
  let preview = '';
  try { preview = parseMedia(html, base); } catch {}
  if (!preview && source === 'waifu') {
    const raw = html.match(/__wfplayersOptions__\.push\((\{[^\n]*?\})\)/)?.[1];
    if (raw) { try { preview = absolute(JSON.parse(raw).src, base); } catch {} }
  }
  if (!preview) throw new Error('页面没有可播放的 MP4 / WebM，请到原站下载后导入。');
  const options = [{ quality:'preview', url:preview, label:'预览', format:/\.webm(?:[?#]|$)/i.test(preview)?'webm':'mp4' }];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = absolute(attr(match[1], 'href'), base);
    if (!href || new URL(href).hostname !== SOURCES[source]?.host) continue;
    if (source === 'motion' && /\/dl\/(hd|4k)\/\d+\/?$/.test(new URL(href).pathname)) {
      const quality = href.includes('/dl/4k/') ? '4k' : 'hd';
      if (!options.some(x=>x.quality===quality)) options.push({quality,url:href,label:quality==='4k'?'4K 原版':'1080p 原版',format:'mp4'});
    }
    if (source === 'free' && /\/download\/\d+\/?$/.test(new URL(href).pathname)) {
      const title = text(match[2]);
      const quality = /-4k-/i.test(title)?'4k':/-2k-/i.test(title)?'2k':/-HD-/i.test(title)?'hd':'';
      if (quality && !options.some(x=>x.quality===quality)) options.push({quality,url:href,label:quality==='hd'?'1080p 原版':quality.toUpperCase()+' 原版',format:'mp4'});
    }
  }
  return options;
}
function downloadEndpoint(u) {
  return (u.protocol==='https:' && u.hostname==='motionbgs.com' && /^\/dl\/(hd|4k)\/\d+\/?$/.test(u.pathname))
    || (u.protocol==='https:' && u.hostname==='livewallpapers4free.com' && /^\/download\/\d+\/?$/.test(u.pathname));
}

export function sourcePage(source, q, category, page) {
  if(source==='mixkit'){
    const root='https://mixkit.co/free-stock-video/';
    return q?root+encodeURIComponent(q.toLowerCase().trim().replace(/\s+/g,'-'))+'/' +(page>1?'?page='+page:''):root+(category?category+'/':'')+(page>1?'?page='+page:'');
  }
  if (source === 'waifu' || source === 'free') {
    const root = 'https://' + SOURCES[source].host + '/';
    return q ? root + (page > 1 ? 'page/'+page+'/' : '') + '?s='+encodeURIComponent(q)
      : root + (category ? 'category/'+category+'/' : '') + (page>1?'page/'+page+'/':'');
  }
  if (source === 'moe') {
    const root = 'https://moewalls.com/';
    return q ? root + (page > 1 ? `page/${page}/` : '') + '?s=' + encodeURIComponent(q) : root + (category ? `category/${category}/` : '') + (page > 1 ? `page/${page}/` : '');
  }
  const root = 'https://motionbgs.com/';
  if (q) return root + 'search?q=' + encodeURIComponent(q) + (page > 1 ? '&page=' + page : '');
  const tag = category || 'nature';
  return root + `tag:${tag}/` + (page > 1 ? page + '/' : '');
}
function siteUrl(url, source) {
  const u = new URL(url); const host = SOURCES[source]?.host;
  if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password) throw new Error('图库地址不属于当前数据源');
  return u.href;
}
async function fetchRetry(url, options = {}) {
  let last;
  for (let i = 0; i < (options.probe ? 1 : 2); i++) {
    try {
      const r = await fetch(url, { ...options, headers: { 'User-Agent': UA, ...options.headers }, signal: AbortSignal.timeout(options.probe ? 5000 : options.media ? 20000 : 8000) });
      if (!r.ok) throw new Error(`数据源返回 HTTP ${r.status}`);
      return r;
    } catch (e) { last = e; if (i === 0) await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(last?.message || '网络连接失败');
}
export default async ({ dataDir, emit, log }) => {
  const dir = path.join(dataDir, 'media'); fs.mkdirSync(dir, { recursive: true });
  const pending = new Map(), uploads = new Map();
  const mime = ext => ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] || 'application/octet-stream');
  const catalogCache = new Map();
  const thumbCache = new Map();
  const api={
    async thumbnail({ url }) {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !(u.hostname==='assets.mixkit.co'||Object.values(SOURCES).some(s => s.host === u.hostname))) throw new Error('缩略图地址无效');
      if (thumbCache.has(url)) return thumbCache.get(url);
      const response = await fetchRetry(u.href); const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 1500000) throw new Error('缩略图过大');
      const type = response.headers.get('content-type')?.split(';')[0]; if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type || '')) throw new Error('缩略图格式无效');
      const result = 'data:' + type + ';base64,' + buffer.toString('base64'); if (thumbCache.size > 150) thumbCache.delete(thumbCache.keys().next().value); thumbCache.set(url, result); return result;
    },
    async beginUpload({ name, size }) {
      const ext = path.extname(String(name)).toLowerCase();
      if (!/^\.(mp4|webm|gif|png|jpe?g|webp)$/.test(ext) || !Number.isSafeInteger(size) || size < 1 || size > 256 * 1024 * 1024) throw new Error('请选择 256 MB 以内的 MP4 / WebM / GIF 或图片');
      const id = crypto.randomBytes(16).toString('hex'); const file = path.join(dir, id + '.part');
      fs.writeFileSync(file, ''); uploads.set(id, { file, name: path.basename(name), ext, size, offset: 0 }); return { id };
    },
    async uploadChunk({ id, offset, base64 }) {
      const u = uploads.get(id); if (!u || offset !== u.offset || typeof base64 !== 'string' || base64.length > 350000) throw new Error('导入块顺序无效');
      const data = Buffer.from(base64, 'base64'); if (u.offset + data.length > u.size) throw new Error('文件大小不一致');
      await fs.promises.appendFile(u.file, data); u.offset += data.length; return { offset: u.offset };
    },
    async finishUpload({ id }) {
      const u = uploads.get(id); if (!u || u.size !== u.offset) throw new Error('文件还未完整传输');
      const localId = crypto.createHash('sha256').update(id + u.name + u.size).digest('hex') + u.ext, file = path.join(dir, localId);
      fs.renameSync(u.file, file); uploads.delete(id);
      return { id: 'local:' + localId, localId, title: path.basename(u.name, u.ext), source: 'local', kind: /\.(mp4|webm)$/.test(u.ext) ? 'video' : 'image' };
    },
    async cancelUpload({ id }) { const u = uploads.get(id); if (u) { try { fs.unlinkSync(u.file); } catch {} uploads.delete(id); } return true; },
    async mediaChunk({ localId, offset = 0 }) {
      if (!/^[\da-f]{64}\.(mp4|webm|gif|png|jpe?g|webp)$/.test(localId) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('媒体读取参数无效');
      const file = path.join(dir, localId), size = fs.statSync(file).size;
      if (offset > size) throw new Error('媒体读取位置超出文件');
      const fd = await fs.promises.open(file, 'r');
      try { const buffer = Buffer.alloc(Math.min(192 * 1024, size - offset)); const { bytesRead } = await fd.read(buffer, 0, buffer.length, offset); return { data: buffer.subarray(0, bytesRead).toString('base64'), bytesRead, total: size, type: mime(path.extname(file)) }; }
      finally { await fd.close(); }
    },
    async catalog({ source = 'moe', query = '', category = '', page = 1, cursor = '', refresh = false } = {}) {
      if (!SOURCES[source]) throw new Error('未知数据源');
      const q = String(query).trim().slice(0, 80), c = /^[a-z-]*$/.test(category) ? category : '', pg = Math.min(10000, Math.max(1, Number(page) || 1));
      const url = cursor ? siteUrl(cursor, source) : sourcePage(source, q, c, pg);
      const key = crypto.createHash('sha256').update(url).digest('hex'), disk = path.join(dataDir, key + '.catalog.json');
      let old = catalogCache.get(key); if (!old && fs.existsSync(disk)) { try { old = JSON.parse(fs.readFileSync(disk, 'utf8')); } catch {} }
      if (old && !refresh && Date.now() - old.time < 15 * 60000) return { ...old, cached: true };
      try {
        const html = await (await fetchRetry(url)).text(); const result = parseCatalog(source, html, url);
        if (!result.items.length && !/no results|nothing found|0 wallpapers|no wallpapers/i.test(html)) throw new Error('数据源页面格式变化或返回验证页，请重试或切换另一数据源。');
        const record = { ...result, time: Date.now(), page: pg, source, stale: false };
        const tmp = disk + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(record)); fs.renameSync(tmp, disk); catalogCache.set(key, record); return record;
      } catch (e) { if (old) return { ...old, cached: true, stale: true, warning: e.message }; throw e; }
    },
    async resolve({ source, page, url, quality = 'auto' }) {
      if (url) { const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol) || !/\.(mp4|webm|gif|png|jpe?g|webp)(?:$|[?#])/i.test(u.href)) throw new Error('请填写 MP4、WebM、GIF 或图片的直接链接'); return { url: u.href }; }
      const safe = siteUrl(page, source); const html = await (await fetchRetry(safe)).text();
      const variants = parseMediaOptions(source, html, safe);
      let picked = variants.find(x=>x.quality===(quality==='auto'?'hd':quality));
      if(source==='mixkit'&&!picked&&quality!=='preview')picked=variants.find(x=>x.quality==='original');
      let qualityNotice = '';
      if (!picked) { picked=variants[0]; if (quality!=='preview') qualityNotice='此源未提供可直接播放的所选清晰度，当前为预览；可从原站下载高清版后本地导入。'; }
      if (picked.quality !== 'preview') {
        try {
          const response = await fetchRetry(picked.url, {probe:true,headers:{Range:'bytes=0-0'}});
          const type=response.headers.get('content-type')||''; await response.body?.cancel();
          if (!/^video\//i.test(type)) throw Error('高清下载地址未返回视频');
          picked={...picked,url:response.url};
        } catch(e) { qualityNotice='高清地址暂不可用，已回退到预览：'+e.message; picked=variants[0]; }
      }
      return {url:picked.url,mediaFormat:picked.format,selectedQuality:picked.quality,qualityLabel:picked.label,qualityNotice,variants,resolvedQuality:quality};
    },
    async prepare({ url, localId } = {}) {
      let id, file;
      if (localId) {
        if (!/^[\da-f]{64}\.(mp4|webm|gif|png|jpe?g|webp)$/.test(localId)) throw new Error('本地资源编号无效');
        file = path.join(dir, localId); if (!fs.existsSync(file)) throw new Error('本地缓存已不存在，请重新导入'); id = localId;
      } else {
        const u = new URL(url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('视频链接无效');
        const ext = (downloadEndpoint(u)||mixkitVideo(u.href)) ? '.mp4' : path.extname(u.pathname).toLowerCase(); if (!/^\.(mp4|webm|gif|png|jpe?g|webp)$/.test(ext)) throw new Error('视频格式不支持');
        id = crypto.createHash('sha256').update(u.href).digest('hex') + ext; file = path.join(dir, id);
        if (!fs.existsSync(file)) {
          if (!pending.has(id)) pending.set(id, (async () => {
            const r = await fetchRetry(u.href, { media: true }); if ((downloadEndpoint(u)||mixkitVideo(u.href)) && !/^video\//i.test(r.headers.get('content-type') || '')) { await r.body?.cancel(); throw Error('高清下载未返回视频，请切换预览或从原站下载后导入'); } if (+r.headers.get('content-length') > MAX) throw new Error('文件超过 180 MB，请下载后使用本地导入');
            let size = 0; const limiter = new Transform({ transform(chunk, _, cb) { size += chunk.length; cb(size > MAX ? new Error('文件超过 180 MB') : null, chunk); } });
            const tmp = file + '.part'; try { await pipeline(Readable.fromWeb(r.body), limiter, fs.createWriteStream(tmp)); fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
          })().finally(() => pending.delete(id)));
          await pending.get(id);
        }
      }
      return { localId: id, bytes: fs.statSync(file).size };
    },
    async importLocal({ path: input }) {
      const file = path.resolve(String(input || '')), ext = path.extname(file).toLowerCase();
      if (!/^\.(mp4|webm|gif|png|jpe?g|webp)$/.test(ext)) throw new Error('支持 MP4 / WebM / GIF / PNG / JPG / WebP');
      const stat = fs.statSync(file); if (!stat.isFile()) throw new Error('请选择视频文件'); if (stat.size > 256 * 1024 * 1024) throw new Error('本地导入上限为 256 MB');
      const id = crypto.createHash('sha256').update(file + stat.size + stat.mtimeMs).digest('hex') + ext, dest = path.join(dir, id);
      if (!fs.existsSync(dest)) { await fs.promises.copyFile(file, dest + '.part'); fs.renameSync(dest + '.part', dest); }
      return { id: 'local:' + id, localId: id, title: path.basename(file, ext), source: 'local', kind: /\.(mp4|webm)$/.test(ext) ? 'video' : 'image' };
    },
    async cacheInfo() { const files = fs.readdirSync(dir).filter(x => !x.endsWith('.part')); return { count: files.length, bytes: files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) }; }
  };
  api.browseCatalog=async({source='all',topic='nature',query='',page=1,cursor='',refresh=false}={})=>{
    const definition=TOPICS.find(t=>t.id===topic);if(!definition)throw Error('未知内容分类');
    if(source!=='all'&&!SOURCES[source])throw Error('未知数据源');
    const q=String(query).trim().slice(0,80),pg=Math.max(1,Math.min(10000,Math.floor(Number(page)||1)));
    if(source!=='all'){
      if(!q&&!Object.hasOwn(definition.routes,source))throw Error('当前数据源没有此分类，请切换数据源或分类');
      return {...await api.catalog({source,category:definition.routes[source]||'',query:q,page:pg,cursor,refresh}),topic};
    }
    const eligible=Object.keys(SOURCES).filter(s=>q||Object.hasOwn(definition.routes,s));
    let states=eligible.map(s=>({source:s,page:1,cursor:'',done:false}));
    if(cursor){
      if(typeof cursor!=='string'||cursor.length>16000||!cursor.startsWith('mix:'))throw Error('聚合分页标记无效');
      let decoded;try{decoded=JSON.parse(Buffer.from(cursor.slice(4),'base64url').toString('utf8'));}catch{throw Error('聚合分页标记无效');}
      if(decoded.v!==1||decoded.topic!==topic||decoded.query!==q||decoded.page!==pg||!Array.isArray(decoded.states)||decoded.states.length!==eligible.length)throw Error('筛选已变化，请返回第一页');
      const unique=new Set();for(const state of decoded.states){if(!eligible.includes(state.source)||unique.has(state.source)||!Number.isSafeInteger(state.page)||state.page<1||state.page>10000||typeof state.cursor!=='string'||typeof state.done!=='boolean')throw Error('聚合分页标记无效');unique.add(state.source);if(state.cursor)siteUrl(state.cursor,state.source);}
      states=decoded.states;
    }else if(pg!==1)throw Error('缺少聚合分页标记，请返回第一页');
    const outcomes=await Promise.all(states.map(async state=>{
      if(state.done)return {state,items:[],skipped:true};
      try{const result=await api.catalog({source:state.source,category:definition.routes[state.source]||'',query:q,page:state.page,cursor:state.cursor,refresh});return {state,items:result.items,result};}
      catch(error){return {state,items:[],error:error.message};}
    }));
    const warnings=outcomes.filter(o=>o.error||o.result?.stale).map(o=>({source:o.state.source,name:SOURCES[o.state.source].name,message:o.error||o.result.warning||'正在显示缓存'}));
    if(outcomes.every(o=>o.error||o.skipped)&&warnings.length)throw Error(warnings.map(w=>w.name+'：'+w.message).join('；'));
    const items=[],seen=new Set();for(let index=0;index<60;index++)for(const o of outcomes){const item=o.items[index];if(item&&!seen.has(item.id)){seen.add(item.id);items.push(item);}}
    const nextStates=outcomes.map(o=>o.skipped?o.state:o.error?{...o.state,done:true}:({source:o.state.source,page:o.state.page+1,cursor:o.result.next||'',done:!o.result.next}));
    const next=nextStates.some(s=>!s.done)?'mix:'+Buffer.from(JSON.stringify({v:1,topic,query:q,page:pg+1,states:nextStates})).toString('base64url'):'';
    return {items,next,page:pg,source:'all',topic,warnings,partial:!!warnings.length,stale:outcomes.some(o=>o.result?.stale),sourceCount:outcomes.filter(o=>o.result).length,cached:outcomes.filter(o=>o.result).every(o=>o.result.cached)};
  };
  return api;
};
