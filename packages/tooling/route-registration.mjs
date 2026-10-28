import ts from 'typescript';
import { relative, dirname, sep } from 'node:path';
function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node))
  )
    node = node.expression;
  return node;
}
function pattern(path, parent = '') {
  if (typeof path !== 'string' || /[?#\\\u0000-\u001f\u007f]/.test(path) || path.includes('//'))
    throw new Error('Invalid route path');
  const full =
    (parent.replace(/\/$/, '') + '/' + path.replace(/^\//, '')).replace(/\/$/, '') || '/';
  const names = new Set();
  return full
    .split('/')
    .slice(1)
    .map((part, index, all) => {
      if (/^[:*]/.test(part)) {
        const name = part.slice(1);
        if (
          !/^[a-zA-Z_$][\w$]*$/.test(name) ||
          names.has(name) ||
          (part[0] === '*' && index !== all.length - 1)
        )
          throw new Error('Invalid/duplicate route parameter');
        names.add(name);
        return part[0] === '*' ? '*' : ':';
      }
      const value = decodeURIComponent(part);
      if (['.', '..'].includes(value) || /[\\\u0000-\u001f\u007f]/.test(value))
        throw new Error('Invalid route segment');
      return encodeURIComponent(value);
    })
    .join('/');
}
/** Static, import-aware route insertion; never evaluates application modules. */
export function registerPageRoute(source, file, { name, route, pageFile, exported }) {
  let specifier = relative(dirname(file), pageFile).split(sep).join('/').replace(/\.ts$/, '.js');
  if (!specifier.startsWith('.')) specifier = './' + specifier;
  const record = `{ name: ${JSON.stringify(name)}, path: ${JSON.stringify(route)}, loadPage: () => import(${JSON.stringify(specifier)}).then((module) => module.${exported}) }`;
  const manual = (reason) =>
    new Error(
      `${file}: ${reason}. No files written. Manually add to the application defineRoutes array: ${record}`,
    );
  try {
    if (typeof route !== 'string' || !route.startsWith('/'))
      throw new Error('Page generation requires --route <absolute-path>');
    const signature = pattern(route),
      ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) throw new Error('Route file has syntax errors');
    const imports = new Set(),
      declarations = new Map();
    for (const statement of ast.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === '@xiaobaibaifqy/jingchuanchu-app/application'
      ) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const item of bindings.elements)
            if ((item.propertyName ?? item.name).text === 'defineRoutes')
              imports.add(item.name.text);
      }
      if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name))
            declarations.set(declaration.name.text, unwrap(declaration.initializer));
    }
    const calls = [...declarations.values()].filter(
      (node) =>
        node &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        imports.has(node.expression.text),
    );
    if (calls.length !== 1)
      throw new Error('Expected exactly one top-level const using the imported defineRoutes');
    const arrays = new Set();
    function array(value) {
      value = unwrap(value);
      if (value && ts.isIdentifier(value)) value = declarations.get(value.text);
      if (!value || !ts.isArrayLiteralExpression(value) || arrays.has(value))
        throw new Error(
          'Routes/children must be unambiguous static arrays without cyclic references',
        );
      arrays.add(value);
      return value;
    }
    const routes = array(calls[0].arguments[0]);
    function visit(entries, parent = '') {
      for (const entry of entries.elements) {
        if (
          !ts.isObjectLiteralExpression(entry) ||
          entry.properties.some(
            (prop) =>
              ts.isSpreadAssignment(prop) || (prop.name && ts.isComputedPropertyName(prop.name)),
          )
        )
          throw new Error('Dynamic route records cannot be safely registered');
        const fields = new Map();
        for (const property of entry.properties) {
          const key =
            property.name &&
            (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
              ? property.name.text
              : undefined;
          if (!['name', 'path', 'children'].includes(key)) continue;
          if (fields.has(key) || !ts.isPropertyAssignment(property))
            throw new Error('Route fields must have one static value');
          fields.set(key, unwrap(property.initializer));
        }
        const value = (key, required = false) => {
          const node = fields.get(key);
          if (!node && !required) return undefined;
          if (!node || !ts.isStringLiteralLike(node))
            throw new Error(`Route ${key} must be a static string`);
          return node.text;
        };
        const path = value('path', true),
          existingName = value('name');
        if (parent ? path.startsWith('/') : !path.startsWith('/'))
          throw new Error('Route nesting paths are not static application paths');
        if (existingName === name || pattern(path, parent) === signature)
          throw new Error(`Route name or pattern conflicts with ${name}`);
        if (fields.has('children'))
          visit(
            array(fields.get('children')),
            (parent.replace(/\/$/, '') + '/' + path.replace(/^\//, '')).replace(/\/$/, '') || '/',
          );
      }
    }
    visit(routes);
    const offset = routes.end - 1,
      separator = routes.elements.length && !routes.elements.hasTrailingComma ? ',' : '';
    const updated =
      source.slice(0, offset) + separator + '\n  ' + record + ',\n' + source.slice(offset);
    if (ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true).parseDiagnostics.length)
      throw new Error('Cannot safely append to route array');
    return updated;
  } catch (error) {
    throw manual(error.message);
  }
}
