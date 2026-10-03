import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const pages = [...(app.pages || [])];
for (const pack of app.subPackages || app.subpackages || []) {
  for (const page of pack.pages || []) pages.push(`${pack.root}/${page}`);
}

assert.ok(pages.length > 0, 'app routes are registered');
for (const page of pages) {
  const source = readFileSync(join(root, `${page}.js`), 'utf8');
  const markup = readFileSync(join(root, `${page}.wxml`), 'utf8');
  assert.match(source, /^import Page from '~\/utils\/themed-page';/, `${page} uses the themed Page wrapper`);
  assert.match(markup, /^<page-meta page-style="\{\{ clubThemeStyle \}\}" \/>/, `${page} applies its page theme`);
}

const topics = readFileSync(join(root, 'pages/topics/index.wxml'), 'utf8');
assert.match(topics, /clubTheme === 'blackbox'[\s\S]*?每条内容最多关联一个主话题/);
assert.match(topics, /clubTheme === 'blackbox' \? '发起话题，交流创作与想法。'/);
const anthology = readFileSync(join(root, 'pages/anthology/index.wxml'), 'utf8');
assert.match(anthology, /clubTheme === 'blackbox'[\s\S]*?社内长文/);
const tabBar = readFileSync(join(root, 'custom-tab-bar/index.wxml'), 'utf8');
assert.match(tabBar, /isBlackbox && item\.value === 'home' \? '首页' : item\.label/);

console.log(`OK: themed Page and page-meta cover ${pages.length} app routes`);
