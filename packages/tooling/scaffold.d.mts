export declare function createProject(
  target: string,
  options?: {
    preset?: string;
    style?: string;
    bundle?: string;
    profile?: 'application' | 'legacy-v0.4';
  },
): Promise<string>;
export declare function generate(
  kind: string,
  name: string,
  options?: {
    project?: string;
    parent?: string;
    style?: string;
    page?: string;
    shared?: boolean;
    route?: string;
    domain?: string;
    extends?: string;
  },
): Promise<string[]>;
