import { component, type World } from '@xiaobaibaifqy/jingchuanchu-ecs';

export interface Point {
  x: number;
  y: number;
}
export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}
export const Position2D = component<Point>('Position2D');
export const Shape2D = component<{
  kind: 'circle' | 'rect';
  color: string;
  width: number;
  height: number;
  layer: number;
}>('Shape2D');

export class Canvas2D {
  readonly context: CanvasRenderingContext2D;
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width = 960,
    readonly height = 600,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
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
  drawWorld(world: World): void {
    const entities = [...world.query(Position2D, Shape2D)].sort(
      (a, b) => world.require(a, Shape2D).layer - world.require(b, Shape2D).layer,
    );
    for (const entity of entities) {
      const position = world.require(entity, Position2D);
      const shape = world.require(entity, Shape2D);
      const ctx = this.context;
      ctx.fillStyle = shape.color;
      if (shape.kind === 'rect') ctx.fillRect(position.x, position.y, shape.width, shape.height);
      else {
        ctx.beginPath();
        ctx.arc(position.x, position.y, shape.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
