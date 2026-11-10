import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('codexpp.json'));
const pkg = JSON.parse(read('package.json'));
assert.equal(manifest.id, 'live-wallpaper-studio');
assert.equal(manifest.version, pkg.version);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.engines.codexpp, 1);
assert.deepEqual(manifest.permissions.routes, []);
assert.equal(manifest.repository, 'https://github.com/luojinghao/codex-live-wallpaper');

for (const name of [...manifest.renderer, manifest.backend.script]) {
  assert(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'));
  assert(fs.statSync(path.join(root, name)).isFile(), `Missing entry: ${name}`);
  const result = spawnSync(process.execPath, ['--check', path.join(root, name)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${name}`);
  assert(!/categoryTestReport|upgradeTestReport|acceptanceBrowse/.test(read(name)), 'Test harness in release');
}

for (const file of ['README.md', 'docs/使用指南.md']) {
  for (const match of read(file).matchAll(/\]\(([^\s)]+)\)/g)) {
    const link = match[1];
    if (/^(?:[a-z]+:|#)/i.test(link)) continue;
    const target = decodeURIComponent(link.split('#')[0]);
    assert(fs.existsSync(path.resolve(root, path.dirname(file), target)), `Broken link: ${file} -> ${link}`);
  }
}
console.log('Manifest, release entry points, JavaScript syntax and local documentation links are valid.');
