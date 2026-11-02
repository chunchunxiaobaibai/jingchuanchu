import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment, serialize } from 'parse5';
import { format } from 'prettier';
import { collectApi, apiPages, escape, anchor } from './api.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const docsRoot = resolve(root, 'docs');
export const manifestPath = resolve(root, 'scripts/docs/pages.json');
export const sections = {
  开始: ['index.html', 'guide/quick-start.html', 'guide/build-from-source.html'],
  应用开发: [
    'guide/reactivity.html',
    'guide/components.html',
    'guide/services.html',
    'guide/authentication.html',
  ],
  '2D 游戏开发': [
    'guide/gameplay.html',
    'guide/ecs.html',
    'guide/rendering.html',
    'guide/engine-modules.html',
    'guide/networking.html',
  ],
  工具与工程: [
    'engineering/cli.html',
    'engineering/project-structure.html',
    'engineering/architecture.html',
    'engineering/distribution.html',
    'engineering/browser-support.html',
    'guide/troubleshooting.html',
  ],
  维护: [
    'engineering/contributing.html',
    'engineering/validation.html',
    'engineering/workflow.html',
    'engineering/changelog.html',
  ],
};
export const walk = (node, fn) => {
  fn(node);
  for (const child of node.childNodes ?? []) walk(child, fn);
};
export const attribute = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
export const textContent = (node) =>
  node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(textContent).join('');
export function extractBody(html) {
  // Keep HTML as the content source. Generated shell is replaceable without parsing Markdown.
  const match = html.match(/<article\b[^>]*data-doc-content[^>]*>([\s\S]*?)<\/article>/);
  if (!match) throw new Error('Missing article[data-doc-content]');
  return match[1].trim();
}
export function prepareBody(body) {
  const fragment = parseFragment(body);
  const used = new Set();
  const headings = [];
  walk(fragment, (node) => {
    if (!/^h[2-4]$/.test(node.tagName ?? '')) return;
    let id = attribute(node, 'id');
    if (!id) {
      const base = anchor(textContent(node)) || 'section';
      id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      node.attrs.push({ name: 'id', value: id });
    }
    if (used.has(id)) throw new Error(`Duplicate heading: ${id}`);
    used.add(id);
    if (node.tagName === 'h2') headings.push({ id, title: textContent(node) });
  });
  return { html: serialize(fragment), headings };
}
export function shell(page, pages, version) {
  const base = '../'.repeat(page.path.split('/').length - 1);
  const href = (path) => base + path;
  const home = page.path === 'index.html';
  const apiIndex = page.path === 'api/index.html';
  const wide = home || apiIndex;
  const navLink = (path) => {
    const target = pages.find((p) => p.path === path);
    if (!target) throw new Error(`Navigation page missing: ${path}`);
    return `<a href="${href(path)}"${path === page.path ? ' class="selected" aria-current="page"' : ''}>${escape(target.title)}</a>`;
  };
  const sidebar =
    page.section === 'API'
      ? `<section><h2>API 参考</h2>${navLink('api/index.html')}${navLink('api/application-contracts.html')}</section><section><h2>按包查阅</h2>${pages
          .filter(
            (p) =>
              p.section === 'API' && !p.path.includes('contracts') && p.path !== 'api/index.html',
          )
          .map((p) => navLink(p.path))
          .join('')}</section>`
      : Object.entries(sections)
          .map(
            ([title, paths]) =>
              `<section><h2>${title}</h2>${paths.map(navLink).join('')}</section>`,
          )
          .join('');
  const specs = `<details${page.section === '模块契约' ? ' open' : ''}><summary>模块契约 <span>16</span></summary>${pages
    .filter((p) => p.section === '模块契约')
    .map(
      (p) =>
        `<a href="${href(p.path)}"${p.path === page.path ? ' class="selected" aria-current="page"' : ''}>${escape(p.title.split('：').slice(1).join('：') || p.title)}</a>`,
    )
    .join('')}</details>`;
  const prepared = prepareBody(page.body);
  const lane =
    page.section === 'API'
      ? pages.filter((p) => p.section === 'API')
      : Object.values(sections)
          .flat()
          .map((path) => pages.find((p) => p.path === path));
  const current = lane.findIndex((p) => p?.path === page.path);
  const previous = current > 0 ? lane[current - 1] : null;
  const next = current >= 0 ? lane[current + 1] : null;
  const pager =
    !home && !apiIndex
      ? `<nav class="page-turn" aria-label="相邻章节">${previous ? `<a href="${href(previous.path)}"><small>← 上一篇</small><strong>${escape(previous.title)}</strong></a>` : '<span></span>'}${next ? `<a href="${href(next.path)}"><small>下一篇 →</small><strong>${escape(next.title)}</strong></a>` : '<span></span>'}</nav>`
      : '';
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280">
<title>${escape(home ? '镜川初 · 网页 2D 游戏引擎' : page.title + ' | 镜川初文档')}</title>
<meta name="description" content="${escape(page.description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${href('assets/logo.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${href('assets/docs.css')}">
<script src="${href('assets/theme.js')}"></script>
<script src="${href('assets/search-index.js')}" defer></script>
<script src="${href('assets/docs.js')}" defer></script>
</head>
<body data-base="${base}" data-page="${page.path}" class="${home ? 'home-page' : apiIndex ? 'api-page' : 'article-page'}">
<a class="skip-link" href="#main-content">跳转到内容</a>
<header class="topbar"><a class="brand" href="${href('index.html')}"><img src="${href('assets/logo.svg')}" alt="" width="30" height="30"><span>镜川初<small>JINGCHUANCHU</small></span><span class="version">${version}</span></a><button class="search-trigger" type="button" data-open-search><span aria-hidden="true">⌕</span> 搜索文档 <kbd>Ctrl K</kbd></button><nav aria-label="顶部导航"><a href="${href('guide/quick-start.html')}"${page.section === '开发指南' ? ' aria-current="page"' : ''}>指南</a><a href="${href('api/index.html')}"${page.section === 'API' ? ' aria-current="page"' : ''}>API</a><a href="${href('engineering/project-structure.html')}"${page.section === '工程与维护' ? ' aria-current="page"' : ''}>工程</a></nav><span class="header-divider"></span><button id="theme-toggle" type="button" aria-label="切换深浅主题" title="切换深浅主题">◐</button><a class="source-link" href="https://github.com/chunchunxiaobaibai/jingchuanchu" target="_blank" rel="noopener noreferrer">GitHub ↗</a></header>
<aside class="sidebar" aria-label="文档导航"><div class="sidebar-heading">开发者手册 <span>DOCS</span></div><nav>${sidebar}${specs}</nav><div class="sidebar-footer"><span class="status-dot"></span> 网页 2D · 原生 TypeScript<small>清晰构建，自由创造。</small></div></aside>
<div class="workspace${wide ? ' wide' : ''}"><main id="main-content" tabindex="-1">${home ? '' : `<div class="breadcrumb"><a href="${href('index.html')}">文档</a><span>/</span><span>${escape(page.section)}</span></div><div class="page-heading"><p class="eyebrow">${page.section === 'API' ? 'API REFERENCE' : page.section === '开发指南' ? 'DEVELOPER GUIDE' : 'ENGINEERING HANDBOOK'}</p><h1>${escape(page.title)}</h1><p>${escape(page.description)}</p></div>`}
<article data-doc-content>
${prepared.html}
</article>
${pager}<footer class="page-footer"><span>镜川初 · Jingchuanchu Engine</span><span>MIT License · ${version}</span></footer></main>${!wide ? `<aside class="outline" aria-label="本页目录"><div class="outline-inner"><h2>本页目录</h2><nav>${prepared.headings.map((h) => `<a href="#${h.id}">${escape(h.title)}</a>`).join('')}</nav><div class="outline-note"><span>BUILD SOMETHING</span><p>让每一份灵感<br>都有清晰的起点。</p></div></div></aside>` : ''}</div>
<dialog id="search-dialog" aria-labelledby="search-title"><form method="dialog" class="search-dialog-header"><label id="search-title" for="doc-search">搜索文档</label><button type="submit" aria-label="关闭搜索">Esc</button></form><div class="search-input-wrap"><span aria-hidden="true">⌕</span><input id="doc-search" type="search" autocomplete="off" placeholder="搜索指南、函数、类型或关键词…"></div><div id="search-results" aria-live="polite"></div><div class="search-dialog-footer"><span>↑ ↓ 选择 · Enter 打开</span><span>镜川初文档</span></div></dialog>
<div id="toast" role="status" aria-live="polite"></div>
</body>
</html>
`;
}
export const renderPage = async (page, pages, version) =>
  format(shell(page, pages, version), { parser: 'html', printWidth: 100 });

export async function buildDocs() {
  const metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
  const pages = [];
  for (const page of metadata)
    pages.push({
      ...page,
      body: extractBody(await readFile(resolve(docsRoot, page.path), 'utf8')),
    });
  const api = await collectApi(root);
  pages.push(...apiPages(api));
  const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  const search = [];
  for (const page of pages) {
    const prepared = prepareBody(page.body);
    const content = textContent(parseFragment(prepared.html)).replace(/\s+/g, ' ').trim();
    search.push({
      title: page.title,
      section: page.section,
      url: page.path,
      description: page.description,
      text: content,
    });
    for (const heading of prepared.headings)
      search.push({
        title: heading.title,
        section: page.title,
        url: `${page.path}#${heading.id}`,
        description: page.description,
        text: heading.title,
      });
    const file = resolve(docsRoot, page.path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await renderPage(page, pages, version));
  }
  for (const entry of api)
    for (const symbol of entry.exports)
      search.push({
        title: symbol.name,
        section: entry.manifest.name + (entry.subpath === '.' ? '' : entry.subpath.slice(1)),
        url: `api/${entry.directory}.html#${symbol.id}`,
        description: symbol.description || `${symbol.kind} · ${symbol.source}`,
        text: symbol.signature,
      });
  await writeFile(
    resolve(docsRoot, 'assets/search-index.js'),
    `/* Generated by npm run docs:build. */\nwindow.DOC_SEARCH_INDEX = ${JSON.stringify(search).replaceAll('<', '\\u003c')};\n`,
  );
  console.log(
    `HTML handbook built: ${pages.length} pages, ${api.length} package entries, ${api.reduce((n, e) => n + e.exports.length, 0)} exports.`,
  );
  return { pages, api };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildDocs();
