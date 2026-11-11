import type { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { Point } from './components.js';
import { TransformFrameCache, identity, type Camera2D, type Matrix2D } from './features.js';
import { visitWorldDrawItems } from './draw-world.js';
import {
  checkWebGLError,
  createPipeline,
  vertexSize,
  type WebGL2Pipeline,
} from './webgl2-pipeline.js';

type RGBA = readonly [number, number, number, number];
type ImageSource = HTMLImageElement | ImageBitmap;
interface Texture {
  readonly handle: WebGLTexture;
  readonly width: number;
  readonly height: number;
  lastFrame: number;
}

const corners = [0, 1, 2, 2, 1, 3] as const;
const verticesPerQuad = corners.length;
const batchFloats = 1024 * verticesPerQuad * vertexSize;
const white: RGBA = [1, 1, 1, 1];
const fullUV: RGBA = [0, 0, 1, 1];

function parseColor(color: string, background = false): RGBA {
  const valid = background ? /^#[\da-f]{6}$/i : /^#[\da-f]{6}([\da-f]{2})?$/i;
  if (!valid.test(color))
    throw new Error(
      `Invalid WebGL 2 color '${color}'; expected ${background ? '#RRGGBB' : '#RRGGBB or #RRGGBBAA'}`,
    );
  return [
    parseInt(color.slice(1, 3), 16) / 255,
    parseInt(color.slice(3, 5), 16) / 255,
    parseInt(color.slice(5, 7), 16) / 255,
    color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1,
  ];
}

export interface WebGL2Renderer {
  readonly canvas: HTMLCanvasElement;
  /** Number of batches submitted by the most recent drawWorld call. */
  readonly drawCalls: number;
  /** CPU time spent preparing and submitting new sprite textures in the most recent drawWorld call. */
  readonly textureUploadMs: number;
  resize(width?: number, height?: number, pixelRatio?: number): void;
  toPoint(clientX: number, clientY: number): Point;
  clear(color?: string): void;
  drawWorld(world: World, camera?: Camera2D): void;
  dispose(): void;
}

/** Creates a WebGL 2 renderer for a canvas. Compatible with GameCanvasOptions.createRenderer. */
export function createWebGL2Renderer(
  canvas: HTMLCanvasElement,
  width = 960,
  height = 600,
  pixelRatio = canvas.ownerDocument.defaultView?.devicePixelRatio || 1,
): WebGL2Renderer {
  const gl = canvas.getContext('webgl2', { depth: false });
  if (!gl) throw new Error('WebGL 2 is unavailable on this canvas');

  const vertices = new Float32Array(batchFloats);
  const cache = new TransformFrameCache();
  const textures = new Map<ImageSource, Texture>();
  let pipeline: WebGL2Pipeline | undefined;
  let disposed = false;
  let contextLost = false;
  let ratio = 1;
  let frame = 0;
  let drawCalls = 0;
  let textureUploadMs = 0;
  let background: { color: string; rgba: RGBA } | undefined;

  const canDraw = () => !disposed && !contextLost && !gl.isContextLost();
  const updateViewport = (active: WebGL2Pipeline) => {
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(active.extent, gl.drawingBufferWidth / ratio, gl.drawingBufferHeight / ratio);
  };
  const resize = (nextWidth = width, nextHeight = height, nextRatio = ratio) => {
    if (disposed) return;
    if (![nextWidth, nextHeight, nextRatio].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Invalid canvas dimensions');
    const previousRatio = ratio;
    width = nextWidth;
    height = nextHeight;
    ratio = Math.min(nextRatio, 2);
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);
    const changed =
      canvas.width !== bufferWidth || canvas.height !== bufferHeight || previousRatio !== ratio;
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    if (changed && pipeline && canDraw()) updateViewport(pipeline);
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    pipeline = undefined;
    textures.clear();
  };
  const onRestored = () => {
    contextLost = false;
    // Rebuild on the next render so allocation failures reach the host's frame error handler.
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    for (const texture of textures.values()) gl.deleteTexture(texture.handle);
    textures.clear();
    pipeline?.dispose();
    pipeline = undefined;
    cache.clear();
  };
  const ready = () => {
    if (!canDraw() || !canvas.width || !canvas.height) return;
    if (!pipeline) {
      try {
        pipeline = createPipeline(gl);
        updateViewport(pipeline);
      } catch (cause) {
        if (gl.isContextLost()) return;
        throw new Error('Cannot restore WebGL 2 renderer', { cause });
      }
    }
    return pipeline;
  };

  const getTexture = (input: CanvasImageSource): Texture => {
    const cached = textures.get(input as ImageSource);
    if (cached) return cached;
    const kind = Object.prototype.toString.call(input);
    if (kind !== '[object HTMLImageElement]' && kind !== '[object ImageBitmap]')
      throw new Error('Expected a static HTMLImageElement or ImageBitmap');
    const image = input as ImageSource;
    const [imageWidth, imageHeight] =
      kind === '[object HTMLImageElement]'
        ? [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight]
        : [image.width, image.height];
    if (!imageWidth || !imageHeight)
      throw new Error('Texture source is not ready or has no pixels');

    const started = performance.now();
    const handle = gl.createTexture();
    if (!handle) throw new Error('Cannot allocate sprite texture');
    let staging: HTMLCanvasElement | undefined;
    try {
      let source: ImageSource | HTMLCanvasElement = image;
      if (kind === '[object ImageBitmap]') {
        // WebGL ignores the unpack alpha setting for ImageBitmap. Normalize through drawImage.
        staging = canvas.ownerDocument.createElement('canvas');
        staging.width = imageWidth;
        staging.height = imageHeight;
        const context = staging.getContext('2d');
        if (!context) throw new Error('Cannot prepare ImageBitmap for WebGL 2');
        context.drawImage(image, 0, 0);
        source = staging;
      }
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      checkWebGLError(gl, 'Cannot upload sprite texture');
      const texture = { handle, width: imageWidth, height: imageHeight, lastFrame: frame };
      textures.set(image, texture);
      return texture;
    } catch (error) {
      gl.deleteTexture(handle);
      throw error;
    } finally {
      if (staging) staging.width = staging.height = 0;
      textureUploadMs += performance.now() - started;
    }
  };

  const drawWorld = (world: World, camera?: Camera2D) => {
    drawCalls = 0;
    textureUploadMs = 0;
    const active = ready();
    if (!active) return;
    frame++;
    let used = 0;
    let batch = active.solid;
    const flush = () => {
      if (!used) return;
      gl.bindTexture(gl.TEXTURE_2D, batch);
      gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, used), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, used / vertexSize);
      drawCalls++;
      used = 0;
    };
    const quad = (
      texture: WebGLTexture,
      transform: Matrix2D,
      x: number,
      y: number,
      w: number,
      h: number,
      tint: RGBA,
      uv: RGBA,
      bounds: RGBA,
      circle = false,
    ) => {
      if (batch !== texture || used === vertices.length) flush();
      batch = texture;
      const [a, b, c, d, tx, ty] = transform;
      for (const corner of corners) {
        const px = corner & 1 ? x + w : x;
        const py = corner & 2 ? y + h : y;
        vertices[used++] = a * px + c * py + tx;
        vertices[used++] = b * px + d * py + ty;
        vertices[used++] = corner & 1 ? uv[2] : uv[0];
        vertices[used++] = corner & 2 ? uv[3] : uv[1];
        vertices.set(tint, used);
        vertices.set(bounds, used + 4);
        vertices[used + 8] = Number(circle);
        used += 9;
      }
    };
    try {
      visitWorldDrawItems(world, cache, camera, (item, matrix) => {
        try {
          if ('shape' in item) {
            const { shape, position } = item;
            const circle = shape.kind === 'circle';
            if (!circle && shape.kind !== 'rect')
              throw new Error(`Unsupported shape '${shape.kind}'`);
            const x = matrix ? 0 : position.x;
            const y = matrix ? 0 : position.y;
            // Canvas2D uses width as the circle diameter and position as its center.
            const radius = circle ? shape.width / 2 : 0;
            if (circle) {
              if (!Number.isFinite(radius) || radius === 0) return;
              if (radius < 0) throw new Error('Circle radius must be nonnegative');
            }
            quad(
              active.solid,
              matrix ?? identity,
              x - radius,
              y - radius,
              shape.width,
              circle ? shape.width : shape.height,
              parseColor(shape.color),
              fullUV,
              fullUV,
              circle,
            );
            return;
          }
          const { sprite } = item;
          if (sprite.width <= 0 || sprite.height <= 0) return;
          const texture = getTexture(sprite.image);
          texture.lastFrame = frame;
          let uv = fullUV;
          let bounds = fullUV;
          if (sprite.frame) {
            const { x, y, width: w, height: h } = sprite.frame;
            const { width: tw, height: th } = texture;
            if (
              ![x, y, w, h].every(Number.isFinite) ||
              x < 0 ||
              y < 0 ||
              w <= 0 ||
              h <= 0 ||
              x + w > tw ||
              y + h > th
            )
              throw new Error('Sprite frame is outside its texture');
            uv = [x / tw, y / th, (x + w) / tw, (y + h) / th];
            const insetX = Math.min(0.5, w / 2);
            const insetY = Math.min(0.5, h / 2);
            bounds = [
              (x + insetX) / tw,
              (y + insetY) / th,
              (x + w - insetX) / tw,
              (y + h - insetY) / th,
            ];
          }
          const opacity = Math.max(0, Math.min(1, sprite.opacity ?? 1));
          const flipX = sprite.flipX ? -1 : 1;
          const flipY = sprite.flipY ? -1 : 1;
          quad(
            texture.handle,
            matrix!,
            -(sprite.anchorX ?? 0) * sprite.width * flipX,
            -(sprite.anchorY ?? 0) * sprite.height * flipY,
            sprite.width * flipX,
            sprite.height * flipY,
            [1, 1, 1, Number.isNaN(opacity) ? 1 : opacity],
            uv,
            bounds,
          );
        } catch (cause) {
          throw new Error(
            `Cannot draw entity ${item.entity.index}:${item.entity.generation} in WebGL 2: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          );
        }
      });
      flush();
      for (const [source, texture] of textures) {
        if (texture.lastFrame === frame) continue;
        gl.deleteTexture(texture.handle);
        textures.delete(source);
      }
    } catch (error) {
      if (!gl.isContextLost()) throw error;
    }
  };

  try {
    resize(width, height, pixelRatio);
    pipeline = createPipeline(gl);
    updateViewport(pipeline);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    canvas,
    get drawCalls() {
      return drawCalls;
    },
    get textureUploadMs() {
      return textureUploadMs;
    },
    resize,
    toPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(width, ((clientX - rect.left) * width) / rect.width)),
        y: Math.max(0, Math.min(height, ((clientY - rect.top) * height) / rect.height)),
      };
    },
    clear(color = '#ffffff') {
      if (!ready()) return;
      if (background?.color !== color) background = { color, rgba: parseColor(color, true) };
      gl.clearColor(...background.rgba);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    drawWorld,
    dispose,
  };
}
