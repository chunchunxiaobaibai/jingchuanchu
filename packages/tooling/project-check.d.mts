import type { ProjectConfig } from './project-config.mjs';
export function checkApplicationProject(configuration: ProjectConfig): Promise<readonly string[]>;
export { loadProjectConfig } from './project-config.mjs';
