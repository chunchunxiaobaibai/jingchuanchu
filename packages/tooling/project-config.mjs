import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, win32 } from 'node:path';
export const defaultApplicationPaths = Object.freeze({
  app: 'src/app',
  pages: 'src/pages',
  game: 'src/game',
  components: 'src/components',
  themes: 'src/themes',
  account: 'src/account',
});
export class ProjectConfigError extends Error {
  constructor(file, field, message, cause) {
    super(`${file} [project-config:${field}] ${message}`, { cause });
    this.name = 'ProjectConfigError';
    this.file = file;
    this.field = field;
  }
}
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const inside = (root, target) => {
  const path = relative(root, target);
  return (
    path === '' ||
    (!path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
      path !== '..' &&
      !isAbsolute(path))
  );
};
async function existingParent(path) {
  for (;;) {
    try {
      return await realpath(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(path);
      if (parent === path) throw error;
      path = parent;
    }
  }
}
/** Read-only resolver; does not migrate files or create any optional business directories. */
export async function loadProjectConfig(directory) {
  const root = resolve(directory),
    file = resolve(root, 'jingchuanchu.json');
  const fail = (field, message, cause) => {
    throw new ProjectConfigError(file, field, message, cause);
  };
  let raw;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') raw = {};
    else fail('json', 'Cannot read a JSON project configuration', error);
  }
  if (!object(raw)) fail('root', 'Expected a configuration object');
  const preset = raw.preset ?? 'singleplayer',
    style = raw.style ?? 'css';
  if (!['core', 'singleplayer', 'client', 'server'].includes(preset))
    fail('preset', 'Unknown project preset');
  if (!['css', 'less'].includes(style)) fail('style', 'Expected css or less');
  const legacy =
    (raw.profile === undefined || raw.profile === 'legacy-v0.4') &&
    (raw.schemaVersion === undefined || raw.schemaVersion === 1);
  if (legacy)
    return Object.freeze({
      root,
      file,
      schemaVersion: 1,
      profile: 'legacy-v0.4',
      preset,
      style,
      paths: Object.freeze({}),
    });
  if (raw.schemaVersion !== 2)
    fail(
      'schemaVersion',
      'Application projects require schemaVersion:2; unsupported versions are not legacy projects',
    );
  if (raw.profile !== 'application')
    fail(
      'profile',
      'schemaVersion:2 requires profile:"application"; migrate legacy projects explicitly',
    );
  if (raw.paths !== undefined && !object(raw.paths)) fail('paths', 'Expected a paths object');
  for (const key of Object.keys(raw.paths ?? {}))
    if (!Object.hasOwn(defaultApplicationPaths, key)) fail('paths.' + key, 'Unknown business path');
  const paths = { ...defaultApplicationPaths, ...raw.paths };
  const realRoot = await realpath(root);
  for (const [key, path] of Object.entries(paths)) {
    if (
      typeof path !== 'string' ||
      !path ||
      isAbsolute(path) ||
      win32.isAbsolute(path) ||
      /^[a-z]:/i.test(path)
    )
      fail('paths.' + key, 'Expected a portable project-relative directory');
    const portable = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (!portable.split('/').every((part) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(part)))
      fail('paths.' + key, 'Use lowercase kebab-case directory segments without dot segments');
    const target = resolve(root, portable);
    if (!inside(root, target) || !inside(realRoot, await existingParent(target)))
      fail('paths.' + key, 'Directory escapes the project root (including symbolic links)');
    paths[key] = portable;
  }
  const entries = Object.entries(paths);
  for (let i = 0; i < entries.length; i++)
    for (const [otherKey, other] of entries.slice(i + 1)) {
      const [key, path] = entries[i];
      if (path === other || path.startsWith(other + '/') || other.startsWith(path + '/'))
        fail('paths.' + key, `Business directories must not overlap paths.${otherKey}`);
    }
  return Object.freeze({
    root,
    file,
    schemaVersion: 2,
    profile: 'application',
    preset,
    style,
    paths: Object.freeze(paths),
  });
}

/** Recheck an actual output/owner path immediately before generation writes. */
export async function assertProjectPath(directory, target) {
  const root = resolve(directory),
    file = resolve(root, target);
  if (!inside(root, file) || !inside(await realpath(root), await existingParent(file)))
    throw new ProjectConfigError(
      resolve(root, 'jingchuanchu.json'),
      'output',
      'Generation path escapes project root (including symbolic links)',
    );
}
