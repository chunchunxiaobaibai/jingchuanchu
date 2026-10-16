#!/usr/bin/env node
import { createProject, generate } from './scaffold.mjs';
import { compileViews } from './compiler.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const [command, ...args] = process.argv.slice(2);
const help =
  'jingchuanchu create <directory> [--preset core|singleplayer|client|server] [--style css|less] [--bundle <release-directory>]\njingchuanchu generate view|scene <kebab-name> [--project <directory>] [--parent <registration-file>] [--style css|less]\njingchuanchu check [directory]';
try {
  if (!command || command === '--help') {
    console.log(help);
  } else if (command === 'check') {
    if (args.length > 1) throw new Error(help);
    async function check(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) await check(file);
        else if (file.endsWith('.ts')) await compileViews(await readFile(file, 'utf8'), file);
      }
    }
    await check(resolve(args[0] ?? '.', 'src'));
    console.log('Component resources and bindings passed');
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
        command === 'create' ? ['preset', 'style', 'bundle'] : ['project', 'parent', 'style'];
      if (!allowed.includes(key)) throw new Error(`Unknown option ${args[i]}`);
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
    else throw new Error(help);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
