const vertexSource = `#version 300 es
layout(location = 0) in vec2 position;
layout(location = 1) in vec2 uv;
layout(location = 2) in vec4 color;
layout(location = 3) in vec4 uvBounds;
layout(location = 4) in float circle;

uniform vec2 extent;
out vec2 texturePoint;
out vec4 tint;
flat out vec4 bounds;
flat out float circleMask;

void main() {
  gl_Position = vec4(position / extent * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  texturePoint = uv;
  tint = color;
  bounds = uvBounds;
  circleMask = circle;
}
`;

const fragmentSource = `#version 300 es
precision highp float;

uniform sampler2D atlas;
in vec2 texturePoint;
in vec4 tint;
flat in vec4 bounds;
flat in float circleMask;
out vec4 pixel;

void main() {
  vec4 texel = texture(atlas, clamp(texturePoint, bounds.xy, bounds.zw));
  float coverage = 1.0;
  if (circleMask > 0.5) {
    float distanceToEdge = length(texturePoint * 2.0 - 1.0) - 1.0;
    float edgeWidth = max(fwidth(distanceToEdge), 0.0001);
    coverage = clamp(0.5 - distanceToEdge / edgeWidth, 0.0, 1.0);
  }
  pixel = vec4(texel.rgb * tint.rgb, texel.a) * (tint.a * coverage);
}
`;

export const vertexSize = 13;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Cannot allocate WebGL 2 shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const details = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw new Error(`Cannot compile WebGL 2 shader: ${details ?? 'unknown error'}`);
}

export function checkWebGLError(gl: WebGL2RenderingContext, operation: string): void {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`${operation}: WebGL error 0x${error.toString(16)}`);
}

export interface WebGL2Pipeline {
  readonly extent: WebGLUniformLocation;
  readonly solid: WebGLTexture;
  dispose(): void;
}

export function createPipeline(gl: WebGL2RenderingContext): WebGL2Pipeline {
  const program = gl.createProgram();
  if (!program) throw new Error('Cannot allocate WebGL 2 program');
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;
  let buffer: WebGLBuffer | null = null;
  let solid: WebGLTexture | null = null;
  const dispose = () => {
    gl.useProgram(null);
    gl.deleteProgram(program);
    gl.deleteVertexArray(vertexArray);
    gl.deleteBuffer(buffer);
    gl.deleteTexture(solid);
  };
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`Cannot link WebGL 2 program: ${gl.getProgramInfoLog(program)}`);
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);

    gl.useProgram(program);
    const extent = gl.getUniformLocation(program, 'extent');
    const atlas = gl.getUniformLocation(program, 'atlas');
    vertexArray = gl.createVertexArray();
    buffer = gl.createBuffer();
    solid = gl.createTexture();
    if (!extent || !atlas || !vertexArray || !buffer || !solid)
      throw new Error('Cannot initialize WebGL 2 pipeline');

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [index, size, offset] of [
      [0, 2, 0],
      [1, 2, 2],
      [2, 4, 4],
      [3, 4, 8],
      [4, 1, 12],
    ] as const) {
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, vertexSize * 4, offset * 4);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(atlas, 0);
    gl.bindTexture(gl.TEXTURE_2D, solid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    checkWebGLError(gl, 'Cannot initialize WebGL 2 pipeline');
    return { extent, solid, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
}
