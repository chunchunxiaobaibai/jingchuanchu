import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadProjectConfig, assertProjectPath } from './project-config.mjs';
import { writeNewFiles } from './application-scaffold.mjs';
const prefix = '@xiaobaibaifqy/jingchuanchu-';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function packageName(value) {
  if (typeof value !== 'string') throw new Error('Module names must be strings');
  const short = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(short))
    throw new Error(`Invalid module name: ${value}`);
  return prefix + short;
}
/** Shared create/add planner: all metadata and selected bytes are checked before project writes. */
export async function resolveBundleModules(directory, modules, all = false) {
  if (typeof all !== 'boolean' || !Array.isArray(modules))
    throw new Error('Bundle selection requires a module array and boolean all flag');
  const root = resolve(directory),
    manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (!object(manifest) || !Array.isArray(manifest.packages) || !manifest.packages.length)
    throw new Error('Bundle manifest requires a nonempty packages array');
  const entries = new Map(),
    files = new Set();
  for (const entry of manifest.packages) {
    if (
      !object(entry) ||
      packageName(entry.name) !== entry.name ||
      entries.has(entry.name) ||
      typeof entry.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version) ||
      typeof entry.file !== 'string' ||
      !/^[a-zA-Z0-9][\w.-]*\.tgz$/.test(entry.file) ||
      files.has(entry.file) ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !object(entry.dependencies) ||
      Object.values(entry.dependencies).some((value) => typeof value !== 'string' || !value)
    )
      throw new Error('Invalid/duplicate bundle package metadata');
    entries.set(entry.name, entry);
    files.add(entry.file);
  }
  const needed = new Set(),
    visiting = new Set();
  function select(name) {
    if (visiting.has(name)) throw new Error(`Internal dependency cycle: ${name}`);
    if (needed.has(name)) return;
    const entry = entries.get(name);
    if (!entry) throw new Error(`Module missing from bundle: ${name}`);
    visiting.add(name);
    for (const [dependency, range] of Object.entries(entry.dependencies))
      if (dependency.startsWith(prefix)) {
        const target = entries.get(dependency);
        if (!target) throw new Error(`Module missing from bundle: ${dependency}`);
        if (![target.version, '^' + target.version].includes(range))
          throw new Error(`Bundle dependency version mismatch: ${name} -> ${dependency}`);
        select(dependency);
      }
    visiting.delete(name);
    needed.add(name);
  }
  for (const name of all ? entries.keys() : modules.map(packageName)) select(name);
  const result = {};
  for (const name of [...needed].sort()) {
    const entry = entries.get(name),
      file = join(root, 'packages', entry.file),
      bytes = await readFile(file);
    if (digest(bytes) !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.file}`);
    result[name] = {
      file,
      bytes,
      version: entry.version,
      sha256: entry.sha256,
      dependency: `file:vendor/${entry.file}`,
    };
  }
  return result;
}
async function present(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
export async function addModules(options) {
  const modules =
    typeof options.modules === 'string'
      ? options.modules.split(',').map((item) => item.trim())
      : options.modules;
  if (
    !options.bundle ||
    (options.all !== undefined && typeof options.all !== 'boolean') ||
    (options.all === true ? modules !== undefined : !Array.isArray(modules) || !modules.length)
  )
    throw new Error('Use add --modules name[,name] OR --all, together with --bundle <directory>');
  const configuration = await loadProjectConfig(options.project ?? '.'),
    root = configuration.root;
  const selected = await resolveBundleModules(options.bundle, modules ?? [], options.all === true);
  const packageFile = resolve(root, 'package.json'),
    recordFile = resolve(root, 'jingchuanchu-packages.json');
  await assertProjectPath(root, packageFile);
  await assertProjectPath(root, recordFile);
  const before = await readFile(packageFile, 'utf8'),
    pkg = JSON.parse(before);
  if (!object(pkg)) throw new Error('Project package.json must be an object');
  for (const key of ['dependencies', 'devDependencies']) {
    if (
      pkg[key] !== undefined &&
      (!object(pkg[key]) || Object.values(pkg[key]).some((value) => typeof value !== 'string'))
    )
      throw new Error(`Invalid package.json ${key}`);
  }
  pkg.dependencies = { ...pkg.dependencies };
  pkg.devDependencies = { ...pkg.devDependencies };
  const recordExists = await present(recordFile),
    recordBefore = recordExists ? await readFile(recordFile, 'utf8') : undefined;
  const record = recordExists ? JSON.parse(recordBefore) : { schemaVersion: 1, packages: {} };
  if (!object(record) || record.schemaVersion !== 1 || !object(record.packages))
    throw new Error('Invalid jingchuanchu-packages.json');
  const outputs = {},
    edits = [];
  for (const [name, entry] of Object.entries(selected)) {
    const filename = entry.file.split(/[\\/]/).at(-1),
      destination = resolve(root, 'vendor', filename);
    await assertProjectPath(root, destination);
    if (await present(destination)) {
      if (digest(await readFile(destination)) !== entry.sha256)
        throw new Error(`Refusing to overwrite conflicting vendor archive: ${destination}`);
    } else outputs[destination] = entry.bytes;
    const development = name === prefix + 'tooling';
    pkg[development ? 'devDependencies' : 'dependencies'][name] = entry.dependency;
    delete pkg[development ? 'dependencies' : 'devDependencies'][name];
    record.packages[name] = {
      version: entry.version,
      file: 'vendor/' + filename,
      sha256: entry.sha256,
    };
  }
  const after = JSON.stringify(pkg, null, 2) + '\n',
    recordAfter = JSON.stringify(record, null, 2) + '\n';
  if (after !== before) edits.push({ file: packageFile, before, after });
  if (!recordExists) outputs[recordFile] = recordAfter;
  else if (recordAfter !== recordBefore)
    edits.push({ file: recordFile, before: recordBefore, after: recordAfter });
  const files = await writeNewFiles(root, outputs, Object.keys(outputs), edits);
  return { files, modules: Object.keys(selected), next: 'npm install' };
}
