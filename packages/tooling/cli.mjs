#!/usr/bin/env node
import { addModules } from './install.mjs';
import { createProject, generate } from './scaffold.mjs';
import { compileViews } from './compiler.mjs';
import { loadProjectConfig } from './project-config.mjs';
import { checkApplicationProject } from './project-check.mjs';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [command, ...args] = process.argv.slice(2);
const help =
  'jingchuanchu create <directory> [--preset core|singleplayer|client|server] [--style css|less] [--bundle <release-directory>] [--profile application|legacy-v0.4]\njingchuanchu generate view|scene|component|page|store|theme <kebab-name> [--project <directory>] [--parent <registration-file>] [--page <name>|--shared] [--route <path>] [--domain <name>] [--extends <theme>] [--style css|less]\njingchuanchu add --modules assets,net|--all --bundle <directory> [--project <directory>]\njingchuanchu check [directory]';
try {
  if (!command || command === '--help') {
    console.log(help);
  } else if (command === 'check') {
    if (args.length > 1) throw new Error(help);
    const configuration = await loadProjectConfig(resolve(args[0] ?? '.'));
    if (configuration.profile === 'application') {
      const diagnostics = await checkApplicationProject(configuration);
      if (diagnostics.length) throw new Error(diagnostics.join('\n'));
    }
    const checked = new Set();
    async function check(directory) {
      if (checked.has(directory)) return;
      checked.add(directory);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await check(file);
        else if (file.endsWith('.ts')) await compileViews(await readFile(file, 'utf8'), file);
      }
    }
    await check(resolve(configuration.root, 'src'));
    for (const path of Object.values(configuration.paths)) {
      const directory = resolve(configuration.root, path);
      try {
        await access(directory);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      await check(directory);
    }
    console.log(`${configuration.profile}: component resources and bindings passed`);
  } else {
    const positional = [],
      options = {};
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith('--')) {
        positional.push(args[i]);
        continue;
      }
      const key = args[i].slice(2);
      const allowed =
        command === 'create'
          ? ['preset', 'style', 'bundle', 'profile']
          : command === 'add'
            ? ['project', 'modules', 'all', 'bundle']
            : ['project', 'parent', 'style', 'page', 'shared', 'route', 'domain', 'extends'];
      if (!allowed.includes(key)) throw new Error(`Unknown option ${args[i]}`);
      if (key === 'shared' || key === 'all') {
        options[key] = true;
        continue;
      }
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = value;
    }
    if (command === 'create' && positional.length === 1)
      console.log(
        `Created ${await createProject(positional[0], options)}\nNext: npm install, npm run check, npm run build`,
      );
    else if (command === 'generate' && positional.length === 2)
      console.log((await generate(positional[0], positional[1], options)).join('\n'));
    else if (command === 'add' && positional.length === 0) {
      const result = await addModules(options);
      console.log(
        `Added ${result.modules.join(', ')}\nNext: ${result.next} (updates the lockfile; not run automatically)`,
      );
    } else throw new Error(help);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
