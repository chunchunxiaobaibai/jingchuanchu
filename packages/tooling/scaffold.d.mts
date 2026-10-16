export declare function createProject(
  target: string,
  options?: { preset?: string; style?: string; bundle?: string },
): Promise<string>;
export declare function generate(
  kind: string,
  name: string,
  options?: { project?: string; parent?: string; style?: string },
): Promise<string[]>;
