import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import ts from 'typescript';
import { assertProjectPath } from './project-config.mjs';
export async function generateDomainDefinition(kind, name, configuration, options, helpers) {
  const { validName, exists, writeNewFiles } = helpers,
    root = configuration.root;
  const pascal = (value) =>
    value
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('');
  let file, source;
  if (kind === 'scene') {
    if (options.page === undefined) throw new Error('Scene generation requires --page <name>');
    validName(options.page);
    const pageFile = resolve(
      root,
      configuration.paths.pages,
      options.page,
      options.page + '-page.ts',
    );
    await assertProjectPath(root, pageFile);
    if (!(await exists(pageFile)))
      throw new Error(`Page does not exist: ${pageFile}; generate the page first`);
    file = resolve(dirname(pageFile), name + '-scene.ts');
    source = `import { defineGameScene } from '@xiaobaibaifqy/jingchuanchu-app/application';\n\n// 在 ${options.page}-page 中将此定义传给 GameCanvas 的 scene 引用输入；生成不会启动场景。\nexport const ${pascal(name)}Scene = defineGameScene({\n  id: ${JSON.stringify(options.page + '/' + name)},\n  setup(_context) {\n    // 使用场景 context.world、clock、actions 定义行为，离场时按 scope 回收。\n  },\n});\n`;
  } else if (kind === 'store') {
    if (options.domain === undefined) throw new Error('Store generation requires --domain <name>');
    validName(options.domain);
    file = resolve(root, configuration.paths.game, options.domain, name + '-store.ts');
    source = `import { defineStore, signal } from '@xiaobaibaifqy/jingchuanchu-app/application';\n\nexport const ${pascal(name)}Store = defineStore({\n  name: ${JSON.stringify(options.domain + '/' + name)},\n  setup() {\n    const count = signal(0);\n    return {\n      state: { count },\n      getters: {},\n      actions: { increment() { count.update((value) => value + 1); } },\n    };\n  },\n});\n`;
  } else {
    file = resolve(root, configuration.paths.themes, name, name + '-theme.ts');
    if (options.extends !== undefined) {
      validName(options.extends);
      if (options.extends === name) throw new Error('A theme cannot extend itself');
      const base = resolve(
        root,
        configuration.paths.themes,
        options.extends,
        options.extends + '-theme.ts',
      );
      await assertProjectPath(root, base);
      const expected = pascal(options.extends) + 'Theme';
      let code;
      try {
        code = await readFile(base, 'utf8');
      } catch (cause) {
        throw new Error(`Base theme requires ${base} exporting ${expected}: ${cause.message}`);
      }
      const ast = ts.createSourceFile(base, code, ts.ScriptTarget.Latest, true);
      if (
        !ast.statements.some(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            ) &&
            statement.declarationList.declarations.some(
              (declaration) =>
                ts.isIdentifier(declaration.name) && declaration.name.text === expected,
            ),
        )
      )
        throw new Error(
          `${base}: expected a named export ${expected}; supply the base theme explicitly`,
        );
      let specifier = relative(dirname(file), base).split(sep).join('/').replace(/\.ts$/, '.js');
      if (!specifier.startsWith('.')) specifier = './' + specifier;
      source = `import { extendTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';\nimport { ${expected} } from ${JSON.stringify(specifier)};\n\n// 在 tokens/assets 中填写基础主题已声明键的覆盖；不会自动替换当前应用主题。\nexport const ${pascal(name)}Theme = extendTheme(${expected}, {\n  name: ${JSON.stringify(name)},\n  tokens: {},\n  assets: {},\n});\n`;
    } else
      source = `import { defineTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';\n\nexport const ${pascal(name)}Theme = defineTheme({\n  name: ${JSON.stringify(name)},\n  tokens: { background: '#172031', text: '#e9edf5', accent: '#70d4b0' },\n  assets: {},\n});\n`;
  }
  return writeNewFiles(root, { [file]: source }, [file]);
}
