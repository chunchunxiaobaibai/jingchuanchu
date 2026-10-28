export interface BundleModule {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly version: string;
  readonly sha256: string;
  readonly dependency: string;
}
export function resolveBundleModules(
  directory: string,
  modules: readonly string[],
  all?: boolean,
): Promise<Record<string, BundleModule>>;
export function addModules(options: {
  project?: string;
  bundle: string;
  modules?: string | readonly string[];
  all?: boolean;
}): Promise<{ files: string[]; modules: string[]; next: string }>;
