import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

export const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export const anchor = (value) =>
  value
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
const guidance = {
  app: [
    '应用与游戏能力',
    '应用、组件、响应式状态、路由和页面内游戏。日常开发从 /application 子入口导入。',
    'guide/components.html',
  ],
  core: ['引擎与作用域', '固定步、系统调度、模块依赖、事件与作用域清理。', 'guide/ecs.html'],
  ecs: [
    '实体与组件',
    '类型化 token、带代际的实体 handle、查询、资源与延迟命令。',
    'guide/ecs.html',
  ],
  browser: [
    '浏览器运行',
    'requestAnimationFrame 驱动、可见性与增量 DOM 工具。',
    'guide/engine-modules.html',
  ],
  'renderer-2d': ['2D 渲染', 'Canvas、形状、精灵、变换、相机与动画。', 'guide/rendering.html'],
  input: ['键盘与指针', '键盘状态、指针捕获和模块化输入接入。', 'guide/gameplay.html'],
  assets: [
    '资源缓存',
    '共享加载、引用持有、取消与释放。应用资源组另见 app/application。',
    'guide/services.html',
  ],
  net: ['网络客户端', '连接、消息解析、限流与房间目录，不包含游戏协议。', 'guide/networking.html'],
  'net-server': [
    '网络服务端',
    'Node WebSocket 承载与连接管理，业务权限由服务端验证。',
    'guide/networking.html',
  ],
  tooling: [
    'CLI 与构建工具',
    '项目检查、三文件编译、Vite 插件；仅作为开发依赖。',
    'engineering/cli.html',
  ],
};

export async function collectApi(root) {
  const configuration = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  if (configuration.error)
    throw new Error(ts.flattenDiagnosticMessageText(configuration.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
  const entries = [];
  for (const directory of (await readdir(resolve(root, 'packages'))).sort()) {
    const manifest = JSON.parse(
      await readFile(resolve(root, 'packages', directory, 'package.json'), 'utf8'),
    );
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      let source = entry.source?.types ?? entry.source?.default;
      if (!source && directory === 'tooling')
        source = subpath === './project' ? './project-check.d.mts' : './vite.d.ts';
      if (!source) throw new Error(`Missing source entry: ${manifest.name}${subpath}`);
      entries.push({
        directory,
        subpath,
        manifest,
        source: resolve(root, 'packages', directory, source),
      });
    }
  }
  const program = ts.createProgram(
    [
      ...new Set([
        ...parsed.fileNames.filter((file) =>
          relative(root, file).replaceAll('\\', '/').startsWith('packages/'),
        ),
        ...entries.map((e) => e.source),
      ]),
    ],
    parsed.options,
  );
  const checker = program.getTypeChecker();
  const flags =
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
  const typeText = (type, at) =>
    checker.typeToString(type, at, flags).replace(/import\("[^"]+"\)\./g, '');
  for (const entry of entries) {
    const file = program.getSourceFile(entry.source);
    const module = file && checker.getSymbolAtLocation(file);
    if (!module) throw new Error(`Cannot inspect ${entry.source}`);
    entry.exports = checker
      .getExportsOfModule(module)
      .map((exported) => {
        const symbol =
          exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        const declaration = symbol.declarations?.[0];
        if (!declaration) throw new Error(`Missing declaration: ${exported.name}`);
        const name = exported.name;
        const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
        let signature;
        let kind;
        if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) {
          kind = '类型';
          signature = declaration.getText().replace(/^export\s+/, '');
        } else if (ts.isClassDeclaration(declaration)) {
          kind = '类';
          const instance = checker.getDeclaredTypeOfSymbol(symbol);
          const constructors = type.getConstructSignatures().map((signature) => {
            const parameters = signature.getParameters().map((parameter) => {
              const at = parameter.valueDeclaration ?? parameter.declarations?.[0] ?? declaration;
              const optional = at.questionToken || at.initializer ? '?' : '';
              return (
                (at.dotDotDotToken ? '...' : '') +
                parameter.name +
                optional +
                ': ' +
                typeText(checker.getTypeOfSymbolAtLocation(parameter, at), at)
              );
            });
            return '  constructor(' + parameters.join(', ') + ');';
          });
          const describeMembers = (members, isStatic = false) =>
            members
              .filter(
                (member) =>
                  member.name !== 'prototype' &&
                  !(member.declarations ?? []).some(
                    (d) =>
                      ts.getCombinedModifierFlags(d) &
                        (ts.ModifierFlags.Private | ts.ModifierFlags.Protected) ||
                      (d.name && ts.isPrivateIdentifier(d.name)),
                  ),
              )
              .map((member) => {
                const at = member.valueDeclaration ?? member.declarations?.[0] ?? declaration;
                const prefix =
                  (isStatic ? 'static ' : '') +
                  (ts.getCombinedModifierFlags(at) & ts.ModifierFlags.Readonly ? 'readonly ' : '');
                return (
                  '  ' +
                  prefix +
                  member.name +
                  (member.flags & ts.SymbolFlags.Optional ? '?' : '') +
                  ': ' +
                  typeText(checker.getTypeOfSymbolAtLocation(member, at), at) +
                  ';'
                );
              });
          const generics = declaration.typeParameters?.length
            ? '<' +
              declaration.typeParameters.map((parameter) => parameter.getText()).join(', ') +
              '>'
            : '';
          signature =
            'class ' +
            name +
            generics +
            ' {\n' +
            [
              ...constructors,
              ...describeMembers(checker.getPropertiesOfType(type), true),
              ...describeMembers(checker.getPropertiesOfType(instance)),
            ].join('\n') +
            '\n}';
        } else if (ts.isFunctionDeclaration(declaration)) {
          kind = '函数';
          signature = type
            .getCallSignatures()
            .map(
              (s) =>
                'function ' +
                (name === 'default' ? (declaration.name?.text ?? 'jingchuanchu') : name) +
                checker.signatureToString(s, declaration, flags) +
                ';',
            )
            .join('\n');
        } else {
          kind = '值';
          signature = 'const ' + name + ': ' + typeText(type, declaration) + ';';
        }
        const sourceFile = declaration.getSourceFile();
        return {
          name,
          kind,
          signature,
          description: ts.displayPartsToString(symbol.getDocumentationComment(checker)),
          source: relative(root, sourceFile.fileName).replaceAll('\\', '/'),
          line: sourceFile.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
          id: anchor(entry.subpath === '.' ? 'root' : entry.subpath.slice(2)) + '-' + name,
        };
      })
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }
  return entries;
}

export function apiPages(entries) {
  const pages = [];
  for (const directory of Object.keys(guidance)) {
    const [title, description, tutorial] = guidance[directory];
    const group = entries.filter((entry) => entry.directory === directory);
    const body = [
      `<p class="lead">${escape(description)}</p><aside class="callout"><strong>使用方式</strong><p>先阅读<a href="../${tutorial}">接入指南</a>，再查阅下方当前源码的导出签名。类型名称对应所属入口；源码位置按仓库相对路径标注。应用语义详见<a href="application-contracts.html">应用 API 使用契约</a>。</p></aside>`,
    ];
    for (const entry of group) {
      const importPath =
        entry.manifest.name + (entry.subpath === '.' ? '' : entry.subpath.slice(1));
      body.push(
        `<section class="api-entry"><h2 id="${anchor(entry.subpath === '.' ? 'root' : entry.subpath.slice(2))}">${escape(importPath)}</h2><p><span class="tag">${entry.exports.length} 项导出</span></p><div class="symbol-index">${entry.exports.map((symbol) => `<a href="#${symbol.id}">${escape(symbol.name)}</a>`).join('')}</div>`,
      );
      for (const symbol of entry.exports) {
        const typeOnly = symbol.kind === '类型' ? 'type ' : '';
        const importStatement =
          symbol.name === 'default'
            ? `import jingchuanchu from '${importPath}';`
            : `import { ${typeOnly}${symbol.name} } from '${importPath}';`;
        body.push(
          `<section class="api-symbol"><h3 id="${symbol.id}"><code>${escape(symbol.name)}</code><span class="tag">${symbol.kind}</span></h3>${symbol.description ? `<p>${escape(symbol.description)}</p>` : ''}<p class="source-location">${escape(symbol.source)}:${symbol.line}</p><details class="import-hint"><summary>导入方式</summary><pre><code>${escape(importStatement)}</code></pre></details><div class="code-block"><div class="code-label">TypeScript · ${symbol.kind === '类型' ? '类型定义' : '公开签名'}</div><pre><code>${escape(symbol.signature)}</code></pre></div></section>`,
        );
      }
      body.push('</section>');
    }
    pages.push({
      path: `api/${directory}.html`,
      title,
      section: 'API',
      description,
      body: body.join('\n'),
    });
  }
  const cards = Object.entries(guidance)
    .map(([directory, [title, description]]) => {
      const group = entries.filter((e) => e.directory === directory);
      return `<section class="api-category" data-api-category><header><h2><a href="${directory}.html">${title} <span>↗</span></a></h2><code>${directory}</code></header><p>${escape(description)}</p>${group.map((entry) => `<div class="api-subgroup"><h3>${escape(entry.subpath === '.' ? '根入口' : entry.subpath.slice(2))}</h3><ul>${entry.exports.map((s) => `<li data-api-item><a href="${directory}.html#${s.id}"><span>${escape(s.name)}</span><small>${s.kind}</small></a></li>`).join('')}</ul></div>`).join('')}</section>`;
    })
    .join('');
  pages.push({
    path: 'api/index.html',
    title: 'API 参考',
    section: 'API',
    description: '按包与能力查阅当前源码的公开导出。输入关键词即可过滤函数、类型和类。',
    body: `<div class="api-toolbar"><label for="api-filter">过滤 API</label><input id="api-filter" type="search" placeholder="输入名称，例如 signal、GameCanvas、World…" autocomplete="off"><span id="api-count" role="status"></span></div><p class="api-help">日常应用开发从 <a href="app.html#application"><code>app/application</code></a> 开始。<a href="application-contracts.html">使用契约</a>说明默认值、状态结果和清理语义。</p><p id="api-empty" hidden>没有匹配的 API，试试其他关键词。</p><div class="api-grid">${cards}</div>`,
  });
  return pages;
}
