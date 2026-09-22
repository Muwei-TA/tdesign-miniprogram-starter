/**
 * 小程序静态自检（零依赖，不需要 npm install）。
 *
 *   node scripts/check.mjs
 *
 * 检查四项（见 docs/10-mock-and-quality.md 10.5）：
 *   1. JS 语法（node --check）与 JSON 语法（含 BOM 检测）
 *   2. WXML 中 bind/catch 绑定的处理函数在同名 JS 中存在
 *   3. usingComponents 路径存在、WXML 自定义标签已注册
 *   4. app.json 注册页面文件齐全、代码中的跳转目标已注册或在待实现清单里
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, relative, dirname, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', '.session_tmps', '.github', 'docs', 'scripts']);
const NPM_ROOT = join(ROOT, 'miniprogram_npm');

const BUILTIN_TAGS = new Set([
  'view', 'text', 'image', 'button', 'input', 'textarea', 'scroll-view', 'swiper', 'swiper-item',
  'block', 'video', 'navigator', 'form', 'label', 'checkbox', 'radio', 'picker', 'slider', 'switch',
  'icon', 'progress', 'rich-text', 'canvas', 'map', 'audio', 'camera', 'live-player', 'cover-view',
  'cover-image', 'movable-area', 'movable-view', 'open-data', 'web-view', 'slot', 'import', 'template',
  'wxs', 'checkbox-group', 'radio-group', 'picker-view', 'picker-view-column', 'editor',
  'root-portal', 'page-meta', 'navigation-bar', 'page-container', 'share-element', 'match-media', 'ad',
]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (full === NPM_ROOT) continue;
      walk(full);
    } else {
      files.push(full);
    }
  }
})(ROOT);

const rel = (p) => relative(ROOT, p).split(sep).join('/');
let problems = 0;
const fail = (msg) => {
  problems += 1;
  console.log(msg);
};

// ---------- 1. 语法 ----------
const tmp = mkdtempSync(join(tmpdir(), 'hgcheck-'));
let jsCount = 0;
let jsonCount = 0;
const jsonFiles = [];

for (const file of files) {
  const ext = extname(file);
  if (ext === '.js') {
    jsCount += 1;
    const target = join(tmp, `${jsCount}.mjs`);
    writeFileSync(target, readFileSync(file));
    try {
      execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    } catch (err) {
      fail(`[js syntax] ${rel(file)}\n${(err.stderr || '').toString().split('\n').slice(0, 5).join('\n')}`);
    }
  } else if (ext === '.json') {
    jsonCount += 1;
    jsonFiles.push(file);
    const buf = readFileSync(file);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      fail(`[json bom] ${rel(file)} 含 UTF-8 BOM，小程序编译会报解析错误`);
      continue;
    }
    try {
      JSON.parse(buf.toString('utf8'));
    } catch (err) {
      fail(`[json syntax] ${rel(file)}: ${err.message}`);
    }
  }
}
rmSync(tmp, { recursive: true, force: true });

// ---------- 2. 事件处理函数 ----------
const wxmlFiles = files.filter((f) => extname(f) === '.wxml');
for (const wxml of wxmlFiles) {
  const js = wxml.replace(/\.wxml$/, '.js');
  if (!existsSync(js)) {
    fail(`[missing js] ${rel(wxml)}`);
    continue;
  }
  const jsText = readFileSync(js, 'utf8');
  const text = readFileSync(wxml, 'utf8');
  const handlers = new Set();
  const re = /\b(?:bind|catch|capture-bind|capture-catch)[:-]?[a-zA-Z-]+\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(text))) handlers.add(m[1].trim());
  for (const h of handlers) {
    if (!h) continue;
    if (!new RegExp(`(^|[^\\w$])${h}\\s*(\\(|:)`, 'm').test(jsText)) {
      fail(`[missing handler] ${rel(wxml)} -> ${h}`);
    }
  }
  if (/<br\b/.test(text)) fail(`[invalid tag] ${rel(wxml)} 使用了 <br>，WXML 不支持`);
}

// ---------- 3. 组件注册 ----------
function componentExists(base, p) {
  const raw = p.startsWith('/') ? join(ROOT, p) : resolve(base, p);
  if (existsSync(`${raw}.json`) || existsSync(`${raw}.wxml`)) return true;
  const npm = join(NPM_ROOT, p);
  return existsSync(`${npm}.json`) || existsSync(`${npm}.wxml`);
}

for (const jsonPath of jsonFiles) {
  let conf;
  try {
    conf = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    continue;
  }
  const using = conf.usingComponents || {};
  const base = dirname(jsonPath);
  for (const [tag, p] of Object.entries(using)) {
    if (!componentExists(base, p)) fail(`[bad component path] ${rel(jsonPath)} : ${tag} -> ${p}`);
  }

  const wxml = jsonPath.replace(/\.json$/, '.wxml');
  if (!existsSync(wxml)) continue;
  const text = readFileSync(wxml, 'utf8');
  const tags = new Set();
  const re = /<([a-z][a-z0-9-]*)\b/g;
  let m;
  while ((m = re.exec(text))) tags.add(m[1]);
  for (const tag of tags) {
    if (BUILTIN_TAGS.has(tag) || using[tag]) continue;
    fail(`[unregistered component] ${rel(wxml)} : <${tag}>`);
  }
}

// ---------- 4. 路由 ----------
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const registered = new Set();
function checkPage(p) {
  registered.add(`/${p}`);
  for (const ext of ['.js', '.json', '.wxml']) {
    if (!existsSync(join(ROOT, p + ext))) fail(`[missing page file] ${p}${ext}`);
  }
}
app.pages.forEach(checkPage);
(app.subpackages || []).forEach((pkg) => pkg.pages.forEach((page) => checkPage(`${pkg.root}/${page}`)));
(app.tabBar?.list || []).forEach((item) => {
  if (!app.pages.includes(item.pagePath)) fail(`[tabbar not in pages] ${item.pagePath}`);
});

const pending = new Set();
{
  const text = readFileSync(join(ROOT, 'utils/navigate.js'), 'utf8');
  const re = /'(\/pages\/[^']+)':\s*'/g;
  let m;
  while ((m = re.exec(text))) pending.add(m[1]);
}

for (const file of files.filter((f) => extname(f) === '.js')) {
  const text = readFileSync(file, 'utf8');
  for (const re of [/url:\s*[`'"](\/pages\/[^`'"?]+)/g, /navigateTo\(\s*[`'"](\/pages\/[^`'"?]+)/g]) {
    let m;
    while ((m = re.exec(text))) {
      if (registered.has(m[1]) || pending.has(m[1])) continue;
      fail(`[unregistered route] ${rel(file)} -> ${m[1]}`);
    }
  }
}

console.log(
  `\njs: ${jsCount}, json: ${jsonCount}, wxml: ${wxmlFiles.length}, pages: ${registered.size}, pending: ${pending.size}`,
);
console.log(problems === 0 ? 'OK: 全部检查通过' : `FAILED: ${problems} 个问题`);
process.exit(problems === 0 ? 0 : 1);
