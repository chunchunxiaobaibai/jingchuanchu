import type { World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { Point, Stroke } from './components.js';
import { TransformFrameCache, type Camera2D } from './features.js';
import { visitWorldDrawItems } from './draw-world.js';
export { Position2D, Shape2D, type Point, type Stroke } from './components.js';
export { Transform2D, Sprite2D, Camera2D, TransformFrameCache, type Sprite } from './features.js';
export class Canvas2D {
  readonly context: CanvasRenderingContext2D;
  private logicalWidth: number;
  private logicalHeight: number;
  private pixelRatio = 1;
  private initialized = false;
  private frameCache = new TransformFrameCache();
  get width(): number {
    return this.logicalWidth;
  }
  get height(): number {
    return this.logicalHeight;
  }
  constructor(
    readonly canvas: HTMLCanvasElement,
    width = 960,
    height = 600,
    pixelRatio?: number,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.resize(width, height, pixelRatio);
  }
  resize(
    width = this.width,
    height = this.height,
    pixelRatio = window.devicePixelRatio || 1,
  ): void {
    if (![width, height, pixelRatio].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Invalid canvas dimensions');
    const ratio = Math.min(pixelRatio, 2);
    const bufferWidth = Math.round(width * ratio);
    const bufferHeight = Math.round(height * ratio);
    const changed =
      !this.initialized ||
      this.logicalWidth !== width ||
      this.logicalHeight !== height ||
      this.pixelRatio !== ratio ||
      this.canvas.width !== bufferWidth ||
      this.canvas.height !== bufferHeight;
    if (!changed) return;
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.pixelRatio = ratio;
    // Assigning even the same width/height clears the buffer and resets context state.
    if (this.canvas.width !== bufferWidth) this.canvas.width = bufferWidth;
    if (this.canvas.height !== bufferHeight) this.canvas.height = bufferHeight;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.initialized = true;
  }
  toWorldPoint(clientX: number, clientY: number, camera: Camera2D): Point {
    return camera.screenToWorld(this.toPoint(clientX, clientY));
  }
  toPoint(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this.width, ((clientX - rect.left) * this.width) / rect.width)),
      y: Math.max(0, Math.min(this.height, ((clientY - rect.top) * this.height) / rect.height)),
    };
  }
  clear(color = '#ffffff'): void {
    this.context.fillStyle = color;
    this.context.fillRect(0, 0, this.width, this.height);
  }
  stroke(stroke: Stroke): void {
    const first = stroke.points[0];
    if (!first) return;
    const ctx = this.context;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  drawWorld(world: World, camera?: Camera2D): void {
    visitWorldDrawItems(world, this.frameCache, camera, (item, matrix) => {
      const ctx = this.context;
      if (matrix) {
        ctx.save();
        ctx.transform(...matrix);
      }
      try {
        if ('shape' in item) {
          const { shape, position } = item;
          const x = matrix ? 0 : position.x,
            y = matrix ? 0 : position.y;
          ctx.fillStyle = shape.color;
          if (shape.kind === 'rect') ctx.fillRect(x, y, shape.width, shape.height);
          else {
            ctx.beginPath();
            ctx.arc(x, y, shape.width / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const sprite = item.sprite;
          if (sprite.width <= 0 || sprite.height <= 0) return;
          ctx.globalAlpha = Math.max(0, Math.min(1, sprite.opacity ?? 1));
          ctx.scale(sprite.flipX ? -1 : 1, sprite.flipY ? -1 : 1);
          const x = -(sprite.anchorX ?? 0) * sprite.width,
            y = -(sprite.anchorY ?? 0) * sprite.height;
          if (sprite.frame) {
            const frame = sprite.frame;
            ctx.drawImage(
              sprite.image,
              frame.x,
              frame.y,
              frame.width,
              frame.height,
              x,
              y,
              sprite.width,
              sprite.height,
            );
          } else ctx.drawImage(sprite.image, x, y, sprite.width, sprite.height);
        }
      } finally {
        if (matrix) ctx.restore();
      }
    });
  }
}
