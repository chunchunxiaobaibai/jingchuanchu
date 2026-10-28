export type ApplicationPath = 'app' | 'pages' | 'game' | 'components' | 'themes' | 'account';
export const defaultApplicationPaths: Readonly<Record<ApplicationPath, string>>;
export class ProjectConfigError extends Error {
  readonly file: string;
  readonly field: string;
  constructor(file: string, field: string, message: string, cause?: unknown);
}
export interface ProjectConfig {
  readonly root: string;
  readonly file: string;
  readonly schemaVersion: 1 | 2;
  readonly profile: 'legacy-v0.4' | 'application';
  readonly preset: 'core' | 'singleplayer' | 'client' | 'server';
  readonly style: 'css' | 'less';
  readonly paths: Readonly<Partial<Record<ApplicationPath, string>>>;
}
export function loadProjectConfig(directory: string): Promise<ProjectConfig>;
export function assertProjectPath(directory: string, target: string): Promise<void>;
