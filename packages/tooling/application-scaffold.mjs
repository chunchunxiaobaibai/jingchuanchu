import { readFile, writeFile, lstat, mkdir, open, rm, rmdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { assertProjectPath } from './project-config.mjs';
import { registerPageRoute } from './route-registration.mjs';
import { generateDomainDefinition } from './domain-scaffold.mjs';
const exists = async (file) => {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};
function validName(name) {
  if (
    typeof name !== 'string' ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)
  )
    throw new Error('Use a portable lowercase kebab-case business name');
}
export async function writeNewFiles(root, outputs, conflicts, edits = []) {
  for (const file of conflicts) {
    await assertProjectPath(root, file);
    if (await exists(file)) throw new Error(`Refusing to overwrite ${file}`);
  }
  for (const edit of edits) {
    await assertProjectPath(root, edit.file);
    if ((await readFile(edit.file, 'utf8')) !== edit.before)
      throw new Error(`Registration file changed: ${edit.file}`);
  }
  const created = [],
    directories = [],
    applied = [];
  try {
    for (const [file, text] of Object.entries(outputs)) {
      const parents = [];
      for (let directory = dirname(file); directory !== root; directory = dirname(directory)) {
        parents.unshift(directory);
        if (dirname(directory) === directory) throw new Error('Invalid output parent');
      }
      for (const directory of parents) {
        await assertProjectPath(root, directory);
        try {
          await mkdir(directory);
          directories.push(directory);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      await assertProjectPath(root, file);
      const handle = await open(file, 'wx');
      created.push(file);
      try {
        await handle.writeFile(text);
      } finally {
        await handle.close();
      }
    }
    for (const edit of edits) {
      await assertProjectPath(root, edit.file);
      if ((await readFile(edit.file, 'utf8')) !== edit.before)
        throw new Error(`Registration file changed: ${edit.file}`);
      applied.push(edit);
      await writeFile(edit.file, edit.after);
    }
    return [...created, ...edits.map((edit) => edit.file)];
  } catch (cause) {
    const failures = [cause];
    for (const edit of applied.reverse())
      try {
        if ((await readFile(edit.file, 'utf8')) !== edit.before)
          await writeFile(edit.file, edit.before);
      } catch (error) {
        failures.push(error);
      }
    for (const file of created.reverse())
      try {
        await rm(file);
      } catch (error) {
        failures.push(error);
      }
    for (const directory of directories.reverse())
      try {
        await rmdir(directory);
      } catch (error) {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') failures.push(error);
      }
    if (failures.length > 1) throw new AggregateError(failures, 'Generation and rollback failed');
    throw cause;
  }
}
export async function generateApplication(kind, name, configuration, options) {
  if (!['component', 'page', 'scene', 'store', 'theme'].includes(kind))
    throw new Error(
      'Application generation supports component/page/scene/store/theme; legacy view/scene do not apply to this profile',
    );
  validName(name);
  if (!['singleplayer', 'client'].includes(configuration.preset))
    throw new Error('UI generation requires a browser application preset');
  const allowed = {
    component: ['project', 'page', 'shared', 'style'],
    page: ['project', 'route', 'style'],
    scene: ['project', 'page'],
    store: ['project', 'domain'],
    theme: ['project', 'extends'],
  };
  for (const key of Object.keys(options))
    if (!allowed[kind].includes(key))
      throw new Error(`${kind} generation does not accept --${key}`);
  if (['scene', 'store', 'theme'].includes(kind))
    return generateDomainDefinition(kind, name, configuration, options, {
      validName,
      exists,
      writeNewFiles,
    });
  const { page, shared, parent, route } = options,
    style = options.style ?? configuration.style;
  if (parent !== undefined)
    throw new Error('Application generation uses configured paths, not --parent');
  if (kind === 'page') {
    if (page !== undefined || shared !== undefined)
      throw new Error('Page generation does not accept component scope flags');
    if (!['css', 'less'].includes(style)) throw new Error('Style must be css or less');
    const base = resolve(configuration.root, configuration.paths.pages, name, name + '-page');
    const exported =
      name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('') + 'Page';
    const registry = resolve(configuration.root, configuration.paths.app, 'app-routes.ts');
    await assertProjectPath(configuration.root, registry);
    let before;
    try {
      before = await readFile(registry, 'utf8');
    } catch (cause) {
      throw new Error(`Route registration requires ${registry}: ${cause.message}`);
    }
    const after = registerPageRoute(before, registry, {
      name,
      route,
      pageFile: base + '.ts',
      exported,
    });
    const outputs = {
      [base + '.ts']:
        `import { definePage } from '@xiaobaibaifqy/jingchuanchu-app/application';\n\nexport const ${exported} = definePage({\n  selector: 'game-${name}-page',\n  setup() { return {}; },\n});\n`,
      [base + '.html']: `<main><h1>${exported}</h1></main>\n`,
      [base + '.' + style]: 'main { display: block; }\n',
    };
    return writeNewFiles(
      configuration.root,
      outputs,
      ['ts', 'html', 'css', 'less'].map((suffix) => base + '.' + suffix),
      [{ file: registry, before, after }],
    );
  }
  if (route !== undefined) throw new Error('Components do not auto-register in a route');
  if (!['css', 'less'].includes(style)) throw new Error('Style must be css or less');
  if (shared !== undefined && typeof shared !== 'boolean')
    throw new Error('--shared is a boolean flag');
  if ((page !== undefined) === (shared === true))
    throw new Error('Choose exactly one component scope: --page <name> or --shared');
  let directory;
  if (page !== undefined) {
    validName(page);
    const owner = resolve(configuration.root, configuration.paths.pages, page, page + '-page.ts');
    await assertProjectPath(configuration.root, owner);
    if (!(await exists(owner)))
      throw new Error(`Page does not exist: ${owner}; generate the page first`);
    directory = resolve(configuration.root, configuration.paths.pages, page, name);
  } else directory = resolve(configuration.root, configuration.paths.components, name);
  const base = resolve(directory, name),
    exported = name
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('');
  const outputs = {
    [base + '.ts']:
      `import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';\n\nexport const ${exported} = defineComponent({\n  selector: 'game-${name}',\n  setup() { return {}; },\n});\n`,
    [base + '.html']: `<section><h2>${exported}</h2></section>\n`,
    [base + '.' + style]: 'section { display: block; }\n',
  };
  return writeNewFiles(
    configuration.root,
    outputs,
    ['ts', 'html', 'css', 'less'].map((suffix) => base + '.' + suffix),
  );
}
