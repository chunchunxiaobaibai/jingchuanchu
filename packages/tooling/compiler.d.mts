export declare function compileViews(
  code: string,
  id: string,
): Promise<null | {
  code: string;
  map: unknown;
  resources: Array<{ id: string; css: string }>;
  dependencies: string[];
}>;
export declare function compileStyle(
  file: string,
  scope: string,
): Promise<{ css: string; dependencies: string[] }>;
