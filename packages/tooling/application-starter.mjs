import { access, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNewFiles } from './application-scaffold.mjs';

/** The source template is copied into packaged tooling at build time; no second starter is authored. */
export async function createApplicationProject(root, options) {
  const { preset, style, version, local, name, tools } = options;
  let starter = fileURLToPath(new URL('./starters/browser', import.meta.url));
  try {
    await access(starter);
  } catch {
    starter = fileURLToPath(new URL('../../templates/browser', import.meta.url));
  }
  const sources = {};
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const path = prefix + entry.name,
        file = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Starter contains a symbolic link: ${path}`);
      if (entry.isDirectory()) {
        await collect(file, path + '/');
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported starter file: ${path}`);
      let output = path === 'gitignore.txt' ? '.gitignore' : path,
        bytes = await readFile(file);
      if (style === 'less') {
        if (path.endsWith('.css')) output = path.slice(0, -4) + '.less';
        if (/\.(ts|mjs|html)$/.test(path))
          bytes = Buffer.from(bytes.toString('utf8').replace(/\.css(?=['"])/g, '.less'));
      }
      if (Object.hasOwn(sources, output)) throw new Error(`Starter style conflict: ${output}`);
      sources[output] = bytes;
    }
  }
  await collect(starter);
  const pkg = JSON.parse(sources['package.json'].toString('utf8'));
  pkg.name = name;
  for (const dependencies of [pkg.dependencies, pkg.devDependencies])
    for (const key of Object.keys(dependencies))
      if (key.startsWith('@xiaobaibaifqy/jingchuanchu-')) dependencies[key] = '^' + version;
  for (const key of ['typescript', 'vite']) pkg.devDependencies[key] = tools[key];
  if (style === 'less') pkg.devDependencies.less = tools.less;
  if (preset === 'client') pkg.dependencies['@xiaobaibaifqy/jingchuanchu-net'] = '^' + version;
  const configuration = JSON.parse(sources['jingchuanchu.json'].toString('utf8'));
  configuration.preset = preset;
  configuration.style = style;
  sources['jingchuanchu.json'] = JSON.stringify(configuration, null, 2) + '\n';
  sources['README.md'] = sources['README.md'].toString('utf8').replace(/^# .+/, '# ' + name);
  if (local)
    for (const [packageName, entry] of Object.entries(local)) {
      sources['vendor/' + entry.file.split(/[\\/]/).at(-1)] = entry.bytes;
      (packageName === '@xiaobaibaifqy/jingchuanchu-tooling'
        ? pkg.devDependencies
        : pkg.dependencies)[packageName] = entry.dependency;
    }
  sources['package.json'] = JSON.stringify(pkg, null, 2) + '\n';
  const outputs = Object.fromEntries(
    Object.entries(sources).map(([path, bytes]) => [resolve(root, path), bytes]),
  );
  await writeNewFiles(root, outputs, Object.keys(outputs));
  return root;
}
