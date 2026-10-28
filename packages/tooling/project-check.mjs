import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import ts from 'typescript';
export { loadProjectConfig } from './project-config.mjs';
const slash = (path) => path.split(sep).join('/');
const dom = new Set([
  'document',
  'window',
  'navigator',
  'HTMLElement',
  'HTMLCanvasElement',
  'Element',
  'Document',
  'Window',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]);
const allowed = {
  main: ['app', 'styles'],
  app: ['app', 'pages', 'game', 'components', 'themes', 'account', 'assets', 'styles'],
  pages: ['pages', 'game', 'components', 'themes', 'account', 'assets', 'styles'],
  game: ['game', 'assets'],
  components: ['components', 'themes', 'assets', 'styles'],
  themes: ['themes', 'assets'],
  account: ['account', 'game', 'assets'],
  styles: ['styles'],
  assets: [],
};
/** Application-profile structure/dependency diagnostics. Resource typing remains in compileViews. */
export async function checkApplicationProject(configuration) {
  if (configuration.profile !== 'application') throw new Error('Expected application profile');
  const root = configuration.root,
    diagnostics = [],
    files = new Set();
  const normalized = (file) => slash(relative(root, file));
  const paths = { ...configuration.paths, styles: 'src/styles', assets: 'src/assets' };
  const layer = (file) => {
    const path = normalized(file);
    if (path === 'src/main.ts' || path === 'src/env.d.ts') return 'main';
    return Object.entries(paths).find(([, directory]) => path.startsWith(directory + '/'))?.[0];
  };
  const report = (file, rule, message, line = 1) =>
    diagnostics.push(`${normalized(file)}:${line} [${rule}] ${message}`);
  async function walk(directory, optional = false) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (optional && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.add(file);
    }
  }
  await walk(resolve(root, 'src'));
  for (const path of Object.values(configuration.paths)) await walk(resolve(root, path), true);
  let options = {};
  try {
    const text = await readFile(resolve(root, 'tsconfig.json'), 'utf8');
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json', text);
    if (parsed.error)
      report(
        resolve(root, 'tsconfig.json'),
        'tsconfig',
        ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'),
      );
    else options = ts.parseJsonConfigFileContent(parsed.config, ts.sys, root).options;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const file of [...files].sort()) {
    if (!/\.(ts|html|css|less)$/.test(file)) continue;
    const origin = layer(file),
      path = normalized(file);
    if (!origin)
      report(file, 'file-location', 'Move business sources into the configured application paths');
    if (origin !== 'assets' && !['src/main.ts', 'src/env.d.ts'].includes(path)) {
      const local = path.startsWith('src/') ? path.slice(4) : path;
      if (
        local
          .split('/')
          .some(
            (part) =>
              !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.d)?\.(?:ts|html|css|less)$/.test(part) &&
              !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(part),
          )
      )
        report(
          file,
          'business-name',
          'Use kebab-case business files/directories and matching component basenames',
        );
    }
    if (!file.endsWith('.ts')) continue;
    const source = await readFile(file, 'utf8'),
      ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function dependency(specifier, line, node) {
      const clean = specifier.split('?')[0];
      if (
        /(?:^|\/)packages\//.test(clean) ||
        (clean.includes('jingchuanchu-') && /\/(?:dist|src)\/|\.ts$/.test(clean))
      )
        report(file, 'engine-internals', 'Use public engine package entries', line);
      const resolved = ts.resolveModuleName(clean, file, options, ts.sys).resolvedModule;
      const engineName = clean.startsWith('@xiaobaibaifqy/jingchuanchu-')
        ? clean.split('/').slice(0, 2).join('/')
        : resolved?.packageId?.name;
      if (engineName?.startsWith('@xiaobaibaifqy/jingchuanchu-')) {
        const bindings = node.importClause?.namedBindings ?? node.exportClause;
        if (
          origin === 'components' &&
          engineName === '@xiaobaibaifqy/jingchuanchu-core' &&
          (ts.isCallExpression(node) ||
            (bindings &&
              (ts.isNamespaceImport(bindings) ||
                bindings.elements?.some(
                  (item) => (item.propertyName ?? item.name).text === 'Engine',
                ))))
        )
          report(
            file,
            'dependency-boundary',
            'Shared UI must use page capabilities rather than Engine',
            line,
          );
        return;
      }
      let target = resolved?.resolvedFileName;
      if (!target && clean.startsWith('.')) {
        const direct = resolve(dirname(file), clean);
        target = [
          direct,
          direct.replace(/\.js$/, '.ts'),
          direct + '.ts',
          resolve(direct, 'index.ts'),
        ].find((candidate) => files.has(candidate));
      }
      if (target && !resolved?.isExternalLibraryImport) {
        const destination = layer(target);
        if (!allowed[origin]?.includes(destination))
          report(
            file,
            'dependency-boundary',
            `${origin ?? 'unknown'} cannot depend on ${normalized(target)}`,
            line,
          );
      } else if (!resolved && !clean.startsWith('node:'))
        report(
          file,
          'unresolved-import',
          `Cannot resolve ${specifier}; check installation and tsconfig paths`,
          line,
        );
    }
    function visit(node) {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        dependency(node.moduleSpecifier.text, line, node);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]))
          dependency(node.arguments[0].text, line, node);
        else
          report(
            file,
            'dynamic-import',
            'Use static module paths for dependency diagnostics',
            line,
          );
      }
      if (
        origin === 'game' &&
        ts.isIdentifier(node) &&
        dom.has(node.text) &&
        !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      )
        report(
          file,
          'game-dom',
          'Game domain code cannot access browser DOM; adapt it in pages/app',
          line,
        );
      if (
        origin === 'game' &&
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'globalThis' &&
        dom.has(node.name.text)
      )
        report(
          file,
          'game-dom',
          'Game domain code cannot access browser DOM through globalThis',
          line,
        );
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return Object.freeze([...new Set(diagnostics)]);
}
