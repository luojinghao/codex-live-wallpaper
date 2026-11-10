import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import backend, { SOURCES, TOPICS, parseCatalog, parseMediaOptions, sourcePage } from '../backend/main.mjs';

async function createApi(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-wallpaper-test-'));
  t.after(async () => {
    const resolved = path.resolve(dataDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('codex-wallpaper-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { api: await backend({ dataDir, emit() {}, log() {} }), dataDir };
}

function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

function catalogHtml(source, next = true) {
  const host = SOURCES[source].host;
  const page = `https://${host}/sample/`;
  const image = `https://${host}/sample.jpg`;
  const more = next ? `<a rel="next" href="https://${host}/page/2/">Next</a>` : '';
  if (source === 'mixkit') return `<!doctype html><main><div class="item-grid-card"><a class="item-grid-video-player__overlay-link" href="${page}"></a><img src="${image}" alt="Sample"><video src="https://assets.mixkit.co/videos/1/1-720.mp4"></video><span class="item-grid-video-player__overlay-video-title">Sample &amp; Nature</span></div>${next ? '<a class="pagination__link--next" href="https://mixkit.co/free-stock-video/nature/?page=2">Next</a>' : ''}</main>`;
  if (source === 'moe') return `<article><h2><a href="${page}">Sample Live Wallpaper</a></h2><img src="${image}"></article>${more}`;
  if (source === 'motion') return `<a href="${page}"><img src="${image}"><span class="ttl">Sample</span></a>${more}`;
  if (source === 'waifu') return `<article><a href="${page}" title="Sample Live Wallpaper"><img src="${image}"></a></article>${more}`;
  return `<!doctype html><main><div id="post-1"><h2><a href="${page}">Sample Live Wallpaper</a></h2><img src="${image}"></div>${more}</main>`;
}

function mixkitMedia() {
  return `<script type="application/ld+json">${JSON.stringify({
    '@type': 'VideoObject', '@id': 'https://mixkit.co/sample/',
    embedUrl: 'https://assets.mixkit.co/videos/1/1-720.mp4',
    contentUrl: 'https://assets.mixkit.co/videos/1/1-1080.mp4'
  })}</script>`;
}

test('five source parsers accept synthetic cards and pagination', () => {
  for (const source of Object.keys(SOURCES)) {
    const result = parseCatalog(source, catalogHtml(source), `https://${SOURCES[source].host}/`);
    assert.equal(result.items.length, 1, source);
    assert.equal(result.items[0].source, source);
    assert(result.next, source);
  }
  assert.equal(parseCatalog('mixkit', catalogHtml('mixkit'), 'https://mixkit.co/').items[0].title, 'Sample & Nature');
});

test('category routes only reference declared sources', () => {
  assert.equal(Object.keys(SOURCES).length, 5);
  assert.equal(TOPICS.length, 9);
  for (const topic of TOPICS) {
    for (const source of Object.keys(topic.routes)) assert(Object.hasOwn(SOURCES, source));
  }
  assert.equal(sourcePage('mixkit', 'green forest', '', 2), 'https://mixkit.co/free-stock-video/green-forest/?page=2');
  assert.equal(sourcePage('motion', '', '', 1), 'https://motionbgs.com/tag:nature/');
});

test('media parsing preserves preview and available original qualities', () => {
  const mixkit = parseMediaOptions('mixkit', mixkitMedia(), 'https://mixkit.co/sample/');
  assert.deepEqual(mixkit.map(x => x.quality), ['preview', 'hd']);
  const motion = parseMediaOptions('motion', '<video src="https://motionbgs.com/a.mp4"></video><a href="/dl/4k/1/">4K</a>', 'https://motionbgs.com/sample/');
  assert.deepEqual(motion.map(x => x.quality), ['preview', '4k']);
  assert.throws(() => parseMediaOptions('moe', '<html></html>', 'https://moewalls.com/'));
});

test('invalid filters and cross-site pagination are rejected before fetch', async t => {
  const { api } = await createApi(t);
  mockFetch(t, () => { throw Error('Unexpected network request'); });
  await assert.rejects(api.browseCatalog({ source: 'unknown' }));
  await assert.rejects(api.browseCatalog({ topic: 'unknown' }));
  await assert.rejects(api.browseCatalog({ source: 'mixkit', topic: 'anime' }));
  await assert.rejects(api.browseCatalog({ page: 2 }));
  await assert.rejects(api.catalog({ source: 'moe', cursor: 'https://example.invalid/' }));
  const states = Object.keys(SOURCES).map(source => ({ source, page: 2, cursor: source === 'moe' ? 'https://example.invalid/' : '', done: false }));
  const cursor = 'mix:' + Buffer.from(JSON.stringify({ v: 1, topic: 'nature', query: '', page: 2, states })).toString('base64url');
  await assert.rejects(api.browseCatalog({ page: 2, cursor }));
});

test('aggregated catalog interleaves sources and validates its cursor', async t => {
  const { api } = await createApi(t);
  mockFetch(t, async url => {
    const source = Object.keys(SOURCES).find(key => SOURCES[key].host === new URL(url).hostname);
    return new Response(catalogHtml(source));
  });
  const result = await api.browseCatalog({ refresh: true });
  assert.equal(result.items.length, 5);
  assert.equal(result.sourceCount, 5);
  assert.equal(result.partial, false);
  assert.deepEqual(result.items.map(x => x.source), Object.keys(SOURCES));
  assert(result.next.startsWith('mix:'));
  const second = await api.browseCatalog({ page: 2, cursor: result.next, refresh: true });
  assert.equal(second.page, 2);
  await assert.rejects(api.browseCatalog({ topic: 'human', page: 2, cursor: result.next }));
});

test('partial source outages preserve working results', async t => {
  const { api } = await createApi(t);
  mockFetch(t, async url => {
    if (new URL(url).hostname === 'mixkit.co') return new Response(catalogHtml('mixkit'));
    throw Error('Simulated outage');
  });
  const result = await api.browseCatalog({ topic: 'abstract', refresh: true });
  assert.equal(result.items.length, 1);
  assert.equal(result.partial, true);
  assert.equal(result.warnings.length, 4);
});

test('empty source results do not invent cards or pagination', async t => {
  const { api } = await createApi(t);
  mockFetch(t, async () => new Response('<html>Nothing found</html>'));
  const result = await api.browseCatalog({ topic: 'human', refresh: true });
  assert.deepEqual(result.items, []);
  assert.equal(result.next, '');
});

test('catalog cache serves fresh data and falls back after an outage', async t => {
  const { api } = await createApi(t);
  let requests = 0, offline = false;
  mockFetch(t, async () => {
    requests++;
    if (offline) throw Error('Offline');
    return new Response(catalogHtml('moe'));
  });
  await api.catalog({ source: 'moe' });
  const cached = await api.catalog({ source: 'moe' });
  assert.equal(requests, 1);
  assert.equal(cached.cached, true);
  offline = true;
  const stale = await api.catalog({ source: 'moe', refresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.items.length, 1);
});

test('chunked uploads preserve bytes and reject invalid offsets', async t => {
  const { api } = await createApi(t);
  const bytes = Buffer.from('synthetic-video-bytes');
  const upload = await api.beginUpload({ name: 'sample.mp4', size: bytes.length });
  await assert.rejects(api.uploadChunk({ id: upload.id, offset: 1, base64: bytes.toString('base64') }));
  await assert.rejects(api.finishUpload({ id: upload.id }));
  await api.uploadChunk({ id: upload.id, offset: 0, base64: bytes.toString('base64') });
  const item = await api.finishUpload({ id: upload.id });
  const chunk = await api.mediaChunk({ localId: item.localId });
  assert.deepEqual(Buffer.from(chunk.data, 'base64'), bytes);
  assert.equal(chunk.type, 'video/mp4');
  assert.equal((await api.cacheInfo()).count, 1);
  await assert.rejects(api.mediaChunk({ localId: '../sample.mp4' }));
  await assert.rejects(api.beginUpload({ name: 'secret.txt', size: 1 }));
  await assert.rejects(api.beginUpload({ name: 'large.mp4', size: 257 * 1024 * 1024 }));
});

test('cancelled uploads remove partial files', async t => {
  const { api, dataDir } = await createApi(t);
  const upload = await api.beginUpload({ name: 'sample.webm', size: 10 });
  await api.cancelUpload({ id: upload.id });
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'media')), []);
  await assert.rejects(api.finishUpload({ id: upload.id }));
});

test('local import copies the original and can prepare cached media', async t => {
  const { api, dataDir } = await createApi(t);
  const input = path.join(dataDir, 'original.mp4');
  const bytes = Buffer.from('original-media');
  await fs.writeFile(input, bytes);
  const item = await api.importLocal({ path: input });
  assert.equal(item.kind, 'video');
  assert.deepEqual(await fs.readFile(input), bytes);
  assert.deepEqual(await fs.readFile(path.join(dataDir, 'media', item.localId)), bytes);
  assert.equal((await api.prepare({ localId: item.localId })).bytes, bytes.length);
});

test('media download is cached and rejects credential-bearing URLs', async t => {
  const { api } = await createApi(t);
  const bytes = Buffer.from('downloaded-media');
  let requests = 0;
  mockFetch(t, async () => { requests++; return new Response(bytes, { headers: { 'content-type': 'video/mp4' } }); });
  const first = await api.prepare({ url: 'https://example.invalid/sample.mp4' });
  const second = await api.prepare({ url: 'https://example.invalid/sample.mp4' });
  assert.equal(first.localId, second.localId);
  assert.equal(first.bytes, bytes.length);
  assert.equal(requests, 1);
  await assert.rejects(api.prepare({ url: 'https://user:password@example.invalid/sample.mp4' }));
  await assert.rejects(api.prepare({ url: 'file:///sample.mp4' }));
});

test('unavailable original media falls back to the public preview', async t => {
  const { api } = await createApi(t);
  mockFetch(t, async url => {
    if (new URL(url).hostname === 'mixkit.co') return new Response(mixkitMedia());
    return new Response('Not a video', { headers: { 'content-type': 'text/html' } });
  });
  const result = await api.resolve({ source: 'mixkit', page: 'https://mixkit.co/sample/', quality: 'hd' });
  assert.equal(result.selectedQuality, 'preview');
  assert(result.qualityNotice);
});

test('thumbnail fetch validates source host and response type', async t => {
  const { api } = await createApi(t);
  mockFetch(t, async () => new Response('not an image', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(api.thumbnail({ url: 'https://example.invalid/a.jpg' }));
  await assert.rejects(api.thumbnail({ url: 'https://moewalls.com/a.jpg' }));
});
