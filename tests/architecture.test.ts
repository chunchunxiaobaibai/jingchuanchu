import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import ts from 'typescript';

test('engine packages declare dependencies and never import sibling internals or game code', async () => {
  for (const name of await readdir('packages')) {
    const directory = resolve('packages', name);
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    for (const file of (await readdir(directory)).filter((value) => value.endsWith('.ts'))) {
      const path = resolve(directory, file);
      const source = ts.createSourceFile(
        path,
        await readFile(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        if (specifier.startsWith('.'))
          assert.ok(
            resolve(dirname(path), specifier).startsWith(directory + sep),
            `${manifest.name} imports internals: ${specifier}`,
          );
        else if (specifier.startsWith('@xiaobaibaifqy/jingchuanchu-'))
          assert.ok(
            specifier.split('/').slice(0, 2).join('/') in manifest.dependencies,
            `Undeclared dependency: ${specifier}`,
          );
        else
          assert.ok(
            specifier.startsWith('node:') || specifier in manifest.dependencies,
            `Unexpected dependency: ${specifier}`,
          );
      }
    }
    if (name !== 'net-server') assert.equal('ws' in manifest.dependencies, false);
    assert.equal('zod' in manifest.dependencies, false);
  }
});
