import { resolve } from 'node:path';
import {
  loadProjectConfig,
  checkApplicationProject,
} from '@xiaobaibaifqy/jingchuanchu-tooling/project';
const project = await loadProjectConfig(resolve(process.argv[2] ?? '.'));
if (project.profile !== 'application')
  throw new Error('Use the legacy template checker for a legacy-v0.4 project');
const diagnostics = await checkApplicationProject(project);
if (diagnostics.length) {
  console.error(diagnostics.join('\n'));
  process.exitCode = 1;
} else console.log('Application project structure passed');
