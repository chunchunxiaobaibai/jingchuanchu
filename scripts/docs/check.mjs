import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'parse5';
import {
  docsRoot,
  root,
  manifestPath,
  walk,
  attribute,
  textContent,
  extractBody,
  renderPage,
} from './site.mjs';
import { collectApi, apiPages } from './api.mjs';

export async function checkHtmlDirectory(directory, { handbook = false } = {}) {
  const files = [];
  async function list(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) await list(file);
      else if (entry.name.endsWith('.html')) files.push(file);
      else if (handbook)
        assert.notEqual(extname(file), '.md', `Markdown is not a handbook source: ${file}`);
    }
  }
  await list(directory);
  const documents = new Map();
  for (const file of files) {
    const errors = [];
    const source = await readFile(file, 'utf8');
    const document = parse(source, {
      onParseError: (error) => errors.push(`${error.code}:${error.startLine}:${error.startCol}`),
    });
    assert.deepEqual(errors, [], `Invalid HTML: ${relative(directory, file)}`);
    const ids = new Set();
    const links = [];
    let title = '';
    let main = false;
    walk(document, (node) => {
      const id = attribute(node, 'id');
      if (id) {
        assert(!ids.has(id), `Duplicate id ${id} in ${file}`);
        ids.add(id);
      }
      if (node.tagName === 'title') title = textContent(node);
      if (node.tagName === 'main') main = true;
      for (const attr of node.attrs ?? [])
        if (['src', 'href'].includes(attr.name)) links.push(attr.value);
    });
    assert(title.trim() && main, `Missing title or main: ${file}`);
    documents.set(file, { ids, links });
  }
  let links = 0;
  for (const [file, document] of documents)
    for (const target of document.links) {
      if (/^(?:https?:|mailto:|data:|tel:)/.test(target)) continue;
      assert(!/^(?:javascript:|file:|\/\/)/.test(target), `Unsupported URL: ${target}`);
      const url = new URL(target, pathToFileURL(file));
      const path = fileURLToPath(url);
      assert((await stat(path)).isFile(), `${file} -> not a file: ${target}`);
      if (url.hash && extname(path) === '.html') {
        const doc = documents.get(path);
        assert(doc, `HTML target not in handbook: ${path}`);
        assert(
          doc.ids.has(decodeURIComponent(url.hash.slice(1))),
          `${file} -> missing anchor: ${target}`,
        );
      }
      links++;
    }
  return { files: files.length, links, documents };
}

async function checkHandbook() {
  const metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
  const paths = new Set();
  for (const page of metadata) {
    assert(!paths.has(page.path), `Duplicate page ${page.path}`);
    paths.add(page.path);
    assert(
      page.title && page.description && page.section,
      `Incomplete page metadata: ${page.path}`,
    );
    assert(
      page.path.endsWith('.html') && !page.path.includes('..'),
      `Invalid page path: ${page.path}`,
    );
  }
  const api = await collectApi(root);
  const generated = apiPages(api);
  const pages = [];
  for (const page of metadata)
    pages.push({
      ...page,
      body: extractBody(await readFile(resolve(docsRoot, page.path), 'utf8')),
    });
  pages.push(...generated);
  const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  const checked = await checkHtmlDirectory(docsRoot, { handbook: true });
  assert.equal(checked.files, pages.length, 'Unregistered pages found in handbook');
  for (const page of pages) {
    const source = await readFile(resolve(docsRoot, page.path), 'utf8');
    // Re-render with the same content to detect stale navigation, generated API and shell.
    assert.equal(
      source,
      await renderPage(page, pages, version),
      `Stale handbook output: ${page.path}; run npm run docs:build`,
    );
    const document = parse(source);
    let selected = 0;
    walk(document, (node) => {
      if (node.tagName === 'a' && attribute(node, 'class') === 'selected') selected++;
    });
    assert.equal(selected, 1, `Navigation selection missing: ${page.path}`);
  }
  for (const entry of api)
    for (const symbol of entry.exports)
      assert(
        checked.documents
          .get(resolve(docsRoot, 'api', `${entry.directory}.html`))
          .ids.has(symbol.id),
        `API missing: ${symbol.name}`,
      );
  const searchSource = await readFile(resolve(docsRoot, 'assets/search-index.js'), 'utf8');
  const match = searchSource.match(/window\.DOC_SEARCH_INDEX = ([\s\S]*);\s*$/);
  assert(match, 'Missing search data');
  const search = JSON.parse(match[1]);
  for (const entry of search) {
    const [path, id] = entry.url.split('#');
    const document = checked.documents.get(resolve(docsRoot, path));
    assert(document, `Search page missing: ${entry.url}`);
    if (id) assert(document.ids.has(id), `Search anchor missing: ${entry.url}`);
  }
  for (const page of pages)
    assert(
      search.some((entry) => entry.url === page.path && entry.title === page.title),
      `Page not searchable: ${page.path}`,
    );
  for (const entry of api)
    for (const symbol of entry.exports)
      assert(
        search.some(
          (item) =>
            item.url === `api/${entry.directory}.html#${symbol.id}` && item.title === symbol.name,
        ),
        `API not searchable: ${symbol.name}`,
      );
  // Process specifications remain Markdown working files; their handbook links must resolve.
  for (const path of [
    'SPEC.md',
    'README.md',
    ...(await readdir(resolve(root, 'tasks')))
      .filter((p) => p.endsWith('.md'))
      .map((p) => `tasks/${p}`),
  ]) {
    const source = await readFile(resolve(root, path), 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(https?:|#|mailto:)/.test(match[1])) continue;
      await stat(resolve(root, dirname(path), match[1].split('#')[0]));
    }
  }
  console.log(
    `Documentation passed: ${checked.files} HTML pages, ${checked.links} local links, ${search.length} search records, ${api.reduce((sum, entry) => sum + entry.exports.length, 0)} public exports. No browser launched.`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--directory' && process.argv[3] && process.argv.length === 4) {
    const result = await checkHtmlDirectory(resolve(process.argv[3]), { handbook: true });
    console.log(
      `Packaged HTML handbook: ${result.files} pages, ${result.links} local links passed.`,
    );
  } else {
    assert.equal(process.argv.length, 2, 'Usage: check.mjs [--directory handbook-directory]');
    await checkHandbook();
  }
}
