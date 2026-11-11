/** Records renderer calls without providing a GPU or executing shaders. */
export function mockWebGL2(canvas: HTMLCanvasElement) {
  const submissions: Array<{ texture: object; vertices: number[]; count: number }> = [];
  const uploads: TexImageSource[] = [];
  const deletedTextures: object[] = [];
  const viewports: number[][] = [];
  const extents: number[][] = [];
  const counts = {
    programs: 0,
    clears: 0,
    deletedPrograms: 0,
    deletedBuffers: 0,
    deletedArrays: 0,
  };
  const state = { lost: false, failLink: false, uploadError: 0 };
  let bound: object;
  let vertices: number[];
  let error = 0;
  const calls = {
    get drawingBufferWidth() {
      return canvas.width;
    },
    get drawingBufferHeight() {
      return canvas.height;
    },
    NO_ERROR: 0,
    createShader: () => ({}),
    createProgram: () => {
      counts.programs++;
      return {};
    },
    createTexture: () => ({}),
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    getUniformLocation: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => !state.failLink,
    getProgramInfoLog: () => 'test link failure',
    getError: () => {
      const result = error;
      error = 0;
      return result;
    },
    isContextLost: () => state.lost,
    viewport: (...values: number[]) => viewports.push(values),
    uniform2f: (_: object, ...values: number[]) => extents.push(values),
    bindTexture: (_: number, texture: object) => {
      bound = texture;
    },
    bufferData: (_: number, values: Float32Array) => {
      vertices = Array.from(values);
    },
    drawArrays: (_mode: number, _offset: number, count: number) => {
      submissions.push({ texture: bound, vertices, count });
    },
    clear: () => {
      counts.clears++;
    },
    texImage2D: (...args: unknown[]) => {
      if (args.length === 6) {
        uploads.push(args[5] as TexImageSource);
        error = state.uploadError;
      }
    },
    deleteTexture: (texture: object | null) => {
      if (texture) deletedTextures.push(texture);
    },
    deleteProgram: () => {
      counts.deletedPrograms++;
    },
    deleteBuffer: (buffer: object | null) => {
      if (buffer) counts.deletedBuffers++;
    },
    deleteVertexArray: (array: object | null) => {
      if (array) counts.deletedArrays++;
    },
  };
  const constants = new Map<string, number>();
  const gl = new Proxy(calls, {
    get(target, key: keyof typeof calls) {
      if (key in target) return target[key];
      if (/^[A-Z_0-9]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, constants.size + 1);
        return constants.get(key);
      }
      return () => {};
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, submissions, uploads, deletedTextures, viewports, extents, counts, state };
}
