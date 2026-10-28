import ts from 'typescript';
import { parseFragment, serialize } from 'parse5';
import { dirname, resolve } from 'node:path';

const app = '@xiaobaibaifqy/jingchuanchu-app/application';
const forbidden = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'caller',
  'callee',
  'arguments',
]);
const operators = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '===',
  '!==',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '??',
]);
const kebab = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
const prop = (object, name) =>
  object.properties.find(
    (p) =>
      p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name,
  );

/** Only expressions in this explicit AST grammar become emitted JavaScript; never eval template strings. */
function expression(text, fail) {
  const source = ts.createSourceFile(
    'expression.ts',
    `const value = (${text});`,
    ts.ScriptTarget.Latest,
    true,
  );
  if (source.parseDiagnostics.length)
    fail(ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, ' '));
  const root = source.statements[0]?.declarationList?.declarations[0]?.initializer;
  const printer = ts.createPrinter();
  function emit(node) {
    if (ts.isParenthesizedExpression(node)) return `(${emit(node.expression)})`;
    if (ts.isIdentifier(node)) {
      if (node.text === '$event') return '$event';
      if (node.text === 'undefined') return 'undefined';
      if (forbidden.has(node.text)) fail(`Forbidden member ${node.text}`);
      return `__scope.${node.text}`;
    }
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
      return printer.printNode(ts.EmitHint.Expression, node, source);
    if (
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
        node.kind,
      )
    )
      return node.getText(source);
    if (ts.isPropertyAccessExpression(node)) {
      if (forbidden.has(node.name.text)) fail(`Forbidden member ${node.name.text}`);
      return `${emit(node.expression)}${node.questionDotToken ? '?.' : '.'}${node.name.text}`;
    }
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (!key || !(ts.isNumericLiteral(key) || ts.isStringLiteral(key)))
        fail('Index access requires a literal key');
      if (ts.isStringLiteral(key) && forbidden.has(key.text)) fail(`Forbidden member ${key.text}`);
      return `${emit(node.expression)}${node.questionDotToken ? '?.' : ''}[${emit(key)}]`;
    }
    if (ts.isCallExpression(node)) {
      if (!ts.isIdentifier(node.expression) || node.expression.text === '$event')
        fail('Only exposed functions can be called');
      if (node.typeArguments?.length) fail('Template calls cannot use type arguments');
      return `${emit(node.expression)}${node.questionDotToken ? '?.' : ''}(${node.arguments.map(emit).join(',')})`;
    }
    if (ts.isBinaryExpression(node) && operators.has(node.operatorToken.getText(source)))
      return `(${emit(node.left)} ${node.operatorToken.getText(source)} ${emit(node.right)})`;
    if (
      ts.isPrefixUnaryExpression(node) &&
      [ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(
        node.operator,
      )
    )
      return `(${ts.tokenToString(node.operator)}${emit(node.operand)})`;
    if (ts.isConditionalExpression(node))
      return `(${emit(node.condition)}?${emit(node.whenTrue)}:${emit(node.whenFalse)})`;
    if (ts.isArrayLiteralExpression(node)) return `[${node.elements.map(emit).join(',')}]`;
    if (ts.isObjectLiteralExpression(node))
      return `{${node.properties
        .map((p) => {
          if (ts.isShorthandPropertyAssignment(p))
            return `${JSON.stringify(p.name.text)}:${emit(p.name)}`;
          if (
            !ts.isPropertyAssignment(p) ||
            !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
          )
            fail('Object bindings require static keys');
          if (forbidden.has(p.name.text)) fail(`Forbidden member ${p.name.text}`);
          return `${JSON.stringify(p.name.text)}:${emit(p.initializer)}`;
        })
        .join(',')}}`;
    fail(`Unsupported template expression: ${ts.SyntaxKind[node.kind]}`);
  }
  if (!root || source.statements.length !== 1) fail('Expected a single expression');
  return emit(root);
}

export function createTemplateChecker(code, id) {
  const configPath = ts.findConfigFile(dirname(id), ts.sys.fileExists);
  let options = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: ['source'],
    skipLibCheck: true,
  };
  if (configPath) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error)
      throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, ' '));
    options = {
      ...ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options,
      ...options,
    };
  }
  const createProgram = (text) => {
    const host = ts.createCompilerHost(options),
      read = host.readFile;
    host.readFile = (file) => (resolve(file) === resolve(id) ? text : read(file));
    return ts.createProgram([id], options, host);
  };
  let original;
  const checks = [];
  let nextList = 0;
  function compile(html, file, object) {
    const parent = object.parent?.parent;
    const variable =
      parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
        ? parent.name.text
        : undefined;
    let bindings = [];
    const tree = parseFragment(html, { sourceCodeLocationInfo: true });
    const location = (offset) => {
      const before = html.slice(0, offset);
      return `${file}:${before.split('\n').length}:${offset - (before.lastIndexOf('\n') + 1) + 1}`;
    };
    const childExpressions = prop(object, 'components')?.initializer;
    let children;
    function childMap() {
      if (children) return children;
      children = new Map();
      if (!childExpressions) return children;
      if (!ts.isArrayLiteralExpression(childExpressions))
        throw new Error(`${id}: components must be a static array for template checking`);
      original ??= createProgram(code);
      const checker = original.getTypeChecker(),
        source = original.getSourceFile(id);
      for (const element of childExpressions.elements) {
        let actual;
        function find(node) {
          if (node.pos === element.pos && node.end === element.end) actual = node;
          else ts.forEachChild(node, find);
        }
        find(source);
        const type = checker.getTypeAtLocation(actual);
        const selector = type.getProperty('selector');
        const selectorType = selector && checker.getTypeOfSymbolAtLocation(selector, actual);
        if (!selectorType?.isStringLiteral())
          throw new Error(`${id}: child selector must retain its literal type`);
        const fields = {},
          required = [];
        for (const group of ['inputs', 'outputs', 'models']) {
          const field = type.getProperty(group);
          const members = field
            ? checker
                .getNonNullableType(checker.getTypeOfSymbolAtLocation(field, actual))
                .getProperties()
            : [];
          fields[group] = members.map((p) => p.name);
          if (group !== 'outputs')
            for (const member of members) {
              const memberType = checker.getTypeOfSymbolAtLocation(member, actual),
                flag = memberType.getProperty('required');
              if (flag && checker.getTypeOfSymbolAtLocation(flag, actual).intrinsicName === 'true')
                required.push(member.name);
            }
        }
        children.set(selectorType.value, { expression: element.getText(), required, ...fields });
      }
      return children;
    }
    const rootRaw = `ReturnType<NonNullable<typeof ${variable}.setup>>`;
    const rootScope = `import(${JSON.stringify(app)}).TemplateScope<${rootRaw}>`;
    function add(node, path, kind, name, text, offset, scopeType = rootScope, rawType = rootRaw) {
      const source = location(offset),
        fail = (message) => {
          throw new Error(`${source}: ${message}`);
        };
      if (!variable) fail('Dynamic templates require a named component variable');
      const compiled = expression(text, fail);
      const child = node.tagName?.includes('-') ? childMap().get(node.tagName) : undefined;
      if (node.tagName?.includes('-') && !child) fail(`Unregistered component: ${node.tagName}`);
      let type = 'unknown',
        eventType = 'never',
        field;
      if (kind === 'when') type = 'boolean';
      if (kind === 'property') {
        if (/^(on|style$|srcdoc$|innerhtml$|outerhtml$|textcontent$|classname$)/i.test(name))
          fail(`Unsafe property binding: ${name}`);
        if (child) {
          field = [...child.inputs, ...child.models].find((key) => kebab(key) === name);
          if (!field) fail(`Unknown component input: ${name}`);
          const group = child.inputs.includes(field) ? 'inputs' : 'models';
          type = `import(${JSON.stringify(app)}).TemplateField<NonNullable<typeof ${child.expression}.${group}>[${JSON.stringify(field)}]>`;
        } else if (name === 'class') type = `import(${JSON.stringify(app)}).TemplateClass`;
        else if (name.startsWith('aria-') || name.startsWith('data-'))
          type = 'string | number | boolean | null | undefined';
        else
          type = `HTMLElementTagNameMap[${JSON.stringify(node.tagName)}][${JSON.stringify(name)}]`;
      }
      if (kind === 'event') {
        if (child) {
          field = child.outputs.find((key) => kebab(key) === name);
          if (!field) fail(`Unknown component output: ${name}`);
          eventType = `import(${JSON.stringify(app)}).TemplateOutput<NonNullable<typeof ${child.expression}.outputs>[${JSON.stringify(field)}]>`;
        } else
          eventType = `HTMLElementEventMap[${JSON.stringify(name)}] & {readonly currentTarget: HTMLElementTagNameMap[${JSON.stringify(node.tagName)}]}`;
      }
      if (kind === 'model') {
        if (!/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/.test(text.trim()))
          fail('Model target must be a writable member path');
        if (node.attrs.some((a) => a.name === ':' + name))
          fail(`Conflicting property/model binding: ${name}`);
        if (child) {
          field = child.models.find((key) => kebab(key) === name);
          if (!field) fail(`Unknown component model: ${name}`);
          type = `import(${JSON.stringify(app)}).WritableSignal<import(${JSON.stringify(app)}).TemplateField<NonNullable<typeof ${child.expression}.models>[${JSON.stringify(field)}]>>`;
        } else {
          if (
            !['input', 'textarea', 'select'].includes(node.tagName) ||
            !['value', 'checked'].includes(name)
          )
            fail(`Unsupported native model ${node.tagName}:${name}`);
          if (name === 'checked') {
            if (
              node.tagName !== 'input' ||
              !node.attrs.some((a) => a.name === 'type' && ['checkbox', 'radio'].includes(a.value))
            )
              fail('checked model requires input checkbox or radio');
            type = `import(${JSON.stringify(app)}).WritableSignal<boolean>`;
          } else if (node.tagName === 'select') {
            type = node.attrs.some((a) => a.name === 'multiple')
              ? `import(${JSON.stringify(app)}).ConvertedModel<readonly string[]>`
              : `import(${JSON.stringify(app)}).WritableSignal<string>`;
          } else type = `import(${JSON.stringify(app)}).NativeValueModel`;
        }
      }
      checks.push({
        source,
        code: `{ const __scope = null! as ${kind === 'model' ? rawType : scopeType}; const $event = null! as ${eventType}; const __value: ${type} = ${compiled}; void __value; void __scope; void $event; }`,
      });
      bindings.push(
        `{path:${JSON.stringify(path)},kind:${JSON.stringify(kind)},${name ? `name:${JSON.stringify(field ?? name)},` : ''}source:${JSON.stringify(source)},evaluate:(__scope,$event)=>(${compiled})}`,
      );
    }
    function walk(node, path, scopeType = rootScope, rawType = rootRaw) {
      if (node.tagName === 'template' && node.attrs.some((a) => a.name === 'when')) {
        if (node.attrs.length !== 1)
          throw new Error(
            `${location(node.sourceCodeLocation.startOffset)}: when template only accepts one when attribute`,
          );
        const attr = node.attrs[0],
          offset = node.sourceCodeLocation.attrs.when.startOffset;
        const outer = bindings;
        bindings = [];
        for (const [i, child] of node.content.childNodes.entries())
          walk(child, [i], scopeType, rawType);
        const nested = bindings;
        bindings = outer;
        add(node, path, 'when', undefined, attr.value, offset, scopeType, rawType);
        const descriptor = bindings.pop();
        bindings.push(
          descriptor.slice(0, -1) +
            `,view:{html:${JSON.stringify(serialize(node.content))},bindings:[${nested.join(',')}]}}`,
        );
        return;
      }

      if (node.tagName === 'template' && node.attrs.some((a) => a.name === 'each')) {
        const source = location(node.sourceCodeLocation.startOffset),
          fail = (message) => {
            throw new Error(`${source}: ${message}`);
          };
        if (node.attrs.length !== 2 || !node.attrs.some((a) => a.name === 'key'))
          fail('each requires exactly an each expression and a key');
        const declaration = node.attrs
          .find((a) => a.name === 'each')
          .value.match(/^([a-zA-Z_$][\w$]*)\s+of\s+([\s\S]+)$/);
        if (!declaration || declaration[1] === '$event' || forbidden.has(declaration[1]))
          fail('each must declare item of collection');
        if (!variable) fail('Dynamic templates require a named component variable');
        const item = declaration[1],
          collection = expression(declaration[2], fail),
          key = expression(node.attrs.find((a) => a.name === 'key').value, fail),
          list = nextList++;
        const itemType = `__jcc_item_${list}`;
        checks.push({
          source,
          code: `const __jcc_list_${list}=(__scope:${scopeType})=>{void __scope;return ${collection};}; const __jcc_array_${list}:readonly unknown[]=__jcc_list_${list}(null! as ${scopeType});void __jcc_array_${list};type ${itemType}=ReturnType<typeof __jcc_list_${list}>[number];`,
        });
        const localScope = `Omit<${scopeType},${JSON.stringify(item)}> & {readonly ${JSON.stringify(item)}:${itemType}}`,
          localRaw = `Omit<${rawType},${JSON.stringify(item)}> & {readonly ${JSON.stringify(item)}:import(${JSON.stringify(app)}).ReadSignal<${itemType}>}`;
        checks.push({
          source,
          code: `{const __scope=null! as ${localScope};const key:string|number=${key};void key;}`,
        });
        const outer = bindings;
        bindings = [];
        for (const [i, child] of node.content.childNodes.entries())
          walk(child, [i], localScope, localRaw);
        const nested = bindings;
        bindings = outer;
        bindings.push(
          `{path:${JSON.stringify(path)},kind:'each',source:${JSON.stringify(source)},item:${JSON.stringify(item)},evaluate:(__scope)=>(${collection}),key:(__scope)=>(${key}),view:{html:${JSON.stringify(serialize(node.content))},bindings:[${nested.join(',')}]}}`,
        );
        return;
      }
      let projected = false;
      if (node.tagName === 'slot') {
        const source = location(node.sourceCodeLocation.startOffset);
        if (node.attrs.some((a) => a.name !== 'name'))
          throw new Error(`${source}: Slot names must be static; slot props are unsupported`);
        const name = node.attrs.find((a) => a.name === 'name')?.value ?? 'default';
        if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${source}: Invalid slot name`);
        const outer = bindings;
        bindings = [];
        for (const [i, child] of node.childNodes.entries()) walk(child, [i], scopeType, rawType);
        const nested = bindings;
        bindings = outer;
        bindings.push(
          `{path:${JSON.stringify(path)},kind:'slot',name:${JSON.stringify(name)},source:${JSON.stringify(source)},evaluate:()=>true,view:{html:${JSON.stringify(serialize(node))},bindings:[${nested.join(',')}]}}`,
        );
        return;
      }
      if (node.tagName?.includes('-')) {
        const child = childMap().get(node.tagName),
          source = location(node.sourceCodeLocation.startOffset);
        if (!child) throw new Error(`${source}: Unregistered component: ${node.tagName}`);
        for (const required of child.required)
          if (
            !node.attrs.some((a) =>
              [kebab(required), ':' + kebab(required), 'model:' + kebab(required)].includes(a.name),
            )
          )
            throw new Error(`${source}: Missing required component input: ${kebab(required)}`);
        for (const attr of node.attrs) {
          const field = [...child.inputs, ...child.models].find((key) => kebab(key) === attr.name);
          if (field) {
            const group = child.inputs.includes(field) ? 'inputs' : 'models';
            checks.push({
              source: location(node.sourceCodeLocation.attrs[attr.name].startOffset),
              code: `{const value: import(${JSON.stringify(app)}).TemplateField<NonNullable<typeof ${child.expression}.${group}>[${JSON.stringify(field)}]> = ${JSON.stringify(attr.value)}; void value;}`,
            });
          }
        }
      }
      if (
        node.tagName?.includes('-') &&
        node.childNodes?.some((child) => child.nodeName !== '#text' || child.value.trim())
      ) {
        const source = location(node.sourceCodeLocation.startOffset),
          slots = new Map();
        for (const child of node.childNodes) {
          if ((child.nodeName === '#text' && !child.value.trim()) || child.nodeName === '#comment')
            continue;
          if (
            child.tagName !== 'template' ||
            child.attrs.length !== 1 ||
            child.attrs[0].name !== 'slot'
          )
            throw new Error(`${source}: Child content requires named template slot content`);
          const name = child.attrs[0].value;
          if (!/^[a-z][a-z0-9-]*$/.test(name) || slots.has(name))
            throw new Error(`${source}: Invalid or duplicate projected slot: ${name}`);
          const outer = bindings;
          bindings = [];
          for (const [i, inner] of child.content.childNodes.entries())
            walk(inner, [i], scopeType, rawType);
          const nested = bindings;
          bindings = outer;
          slots.set(
            name,
            `{html:${JSON.stringify(serialize(child.content))},bindings:[${nested.join(',')}]}`,
          );
        }
        bindings.push(
          `{path:${JSON.stringify(path)},kind:'projection',source:${JSON.stringify(source)},evaluate:()=>undefined,slots:{${[...slots].map(([name, program]) => JSON.stringify(name) + ':' + program).join(',')}}}`,
        );
        projected = true;
      }
      if (node.nodeName === '#text') {
        const value = node.value,
          re = /{{([\s\S]*?)}}/g;
        let match;
        while ((match = re.exec(value))) {
          // Keep each expression's source location; the runtime only writes textContent.
          add(
            node,
            path,
            'text',
            String(match.index),
            match[1],
            (node.sourceCodeLocation?.startOffset ?? 0) + match.index + 2,
            scopeType,
            rawType,
          );
        }
      }
      for (const attr of node.attrs ?? []) {
        const offset = node.sourceCodeLocation?.attrs?.[attr.name]?.startOffset ?? 0;
        if (attr.name.startsWith('model:'))
          add(node, path, 'model', attr.name.slice(6), attr.value, offset, scopeType, rawType);
        if (attr.name.startsWith(':'))
          add(node, path, 'property', attr.name.slice(1), attr.value, offset, scopeType, rawType);
        if (attr.name.startsWith('@'))
          add(node, path, 'event', attr.name.slice(1), attr.value, offset, scopeType, rawType);
      }
      // Structural blocks own their bindings in T08; reject instead of silently dropping them.
      if (
        node.tagName === 'template' &&
        (node.attrs ?? []).some((a) => ['when', 'each', 'slot'].includes(a.name))
      )
        throw new Error(
          `${location(node.sourceCodeLocation.startOffset)}: Structural templates are not implemented yet`,
        );
      if (!projected)
        for (const [i, child] of (node.childNodes ?? []).entries())
          walk(child, [...path, i], scopeType, rawType);
    }
    walk(tree, []);
    return `[${bindings.join(',')}]`;
  }
  function validate() {
    if (!checks.length) return;
    let virtual = code + '\n',
      ranges = [];
    for (const check of checks) {
      const start = virtual.length;
      virtual += check.code + '\n';
      ranges.push({ ...check, start, end: virtual.length });
    }
    const program = createProgram(virtual),
      source = program.getSourceFile(id);
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
    const errors = diagnostics.flatMap((d) => {
      const range = ranges.find((r) => (d.start ?? 0) >= r.start && (d.start ?? 0) < r.end);
      return range
        ? [`${range.source}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`]
        : [];
    });
    if (errors.length) throw new Error(errors.join('\n'));
  }
  return { compile, validate };
}
