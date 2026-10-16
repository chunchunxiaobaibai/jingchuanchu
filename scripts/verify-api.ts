import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';
function historical(path: string) {
  const result = spawnSync('git', ['show', `v0.3.0:${path}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function publicNames(text: string) {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      for (const entry of statement.exportClause.elements) names.add(entry.name.text);
    if (
      !ts.canHaveModifiers(statement) ||
      !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);

    if ('name' in statement && statement.name && ts.isIdentifier(statement.name as ts.Node))
      names.add((statement.name as ts.Identifier).text);
    if (ts.isClassDeclaration(statement) && statement.name) {
      const prefix = statement.name.text + '.';
      for (const member of statement.members) {
        if (
          (ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined)?.some((modifier) =>
            [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind),
          )
        )
          continue;
        if (member.name && ts.isIdentifier(member.name)) names.add(prefix + member.name.text);
        if (ts.isConstructorDeclaration(member))
          for (const parameter of member.parameters)
            if (
              ts
                .getModifiers(parameter)
                ?.some((modifier) =>
                  [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(
                    modifier.kind,
                  ),
                ) &&
              ts.isIdentifier(parameter.name)
            )
              names.add(prefix + parameter.name.text);
      }
    }
  }
  return names;
}
let count = 0;
for (const directory of await readdir('packages')) {
  const manifest = JSON.parse(await readFile(`packages/${directory}/package.json`, 'utf8'));
  if (directory === 'app' || directory === 'tooling') continue; // Additive packages have no 0.3.0 counterpart.
  const oldManifest = JSON.parse(historical(`packages/${directory}/package.json`));
  for (const path of Object.keys(oldManifest.exports))
    assert(path in manifest.exports, `Removed package entry ${manifest.name}${path}`);
  for (const entry of Object.values(oldManifest.exports) as Array<{
    source: { default: string };
  }>) {
    const path = `packages/${directory}/${entry.source.default.replace('./', '')}`;
    const old = publicNames(historical(path)),
      current = publicNames(await readFile(path, 'utf8'));
    for (const name of old) {
      assert(current.has(name), `Removed/renamed public name: ${path}:${name}`);
      count++;
    }
  }
}
console.log(
  `API name compatibility passed: ${count} original public names and every 0.3.0 entry retained`,
);
