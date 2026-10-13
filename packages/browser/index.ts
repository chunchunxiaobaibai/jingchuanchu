import { Engine, Scope } from '../core/index.js';
import { component, type World } from '../ecs/index.js';

export interface Point { x: number; y: number }
export interface Stroke { points: Point[]; color: string; width: number }
export const Position2D = component<Point>('Position2D');
export const Shape2D = component<{ kind: 'circle' | 'rect'; color: string; width: number; height: number; layer: number }>('Shape2D');

export class Canvas2D {
  readonly context: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement, readonly width = 960, readonly height = 600) {
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D is unavailable'); this.context = context;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  toPoint(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(this.width, (clientX - rect.left) * this.width / rect.width)), y: Math.max(0, Math.min(this.height, (clientY - rect.top) * this.height / rect.height)) };
  }
  clear(color = '#ffffff'): void { this.context.fillStyle = color; this.context.fillRect(0, 0, this.width, this.height); }
  stroke(stroke: Stroke): void {
    const first = stroke.points[0]; if (!first) return;
    const ctx = this.context; ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (stroke.points.length === 1) { ctx.beginPath(); ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(first.x, first.y); for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y); ctx.stroke();
  }
  drawWorld(world: World): void {
    const entities = [...world.query(Position2D, Shape2D)].sort((a, b) => world.require(a, Shape2D).layer - world.require(b, Shape2D).layer);
    for (const entity of entities) {
      const position = world.require(entity, Position2D); const shape = world.require(entity, Shape2D); const ctx = this.context;
      ctx.fillStyle = shape.color;
      if (shape.kind === 'rect') ctx.fillRect(position.x, position.y, shape.width, shape.height);
      else { ctx.beginPath(); ctx.arc(position.x, position.y, shape.width / 2, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

export function runBrowser(engine: Engine, onError: (error: unknown) => void): () => void {
  let frame = 0; let previous: number | undefined; let closed = false;
  const update = (time: number): void => {
    if (closed) return;
    try { engine.advance(previous === undefined ? 0 : (time - previous) / 1000); previous = time; }
    catch (error) { stop(); onError(error); return; }
    frame = requestAnimationFrame(update);
  };
  const visibility = (): void => { previous = undefined; if (document.hidden) engine.pause(); else engine.resume(); };
  const stop = (): void => { closed = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); };
  engine.start(); document.addEventListener('visibilitychange', visibility); visibility(); frame = requestAnimationFrame(update);
  engine.scope.own(stop); return stop;
}

export function bindPointer(canvas: HTMLCanvasElement, handlers: { down(event: PointerEvent): void; move(event: PointerEvent): void; up(event: PointerEvent): void }, scope: Scope): void {
  const down = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); handlers.down(event);
  };
  const move = (event: PointerEvent): void => { if (canvas.hasPointerCapture(event.pointerId)) handlers.move(event); };
  const up = (event: PointerEvent): void => { if (canvas.hasPointerCapture(event.pointerId)) { handlers.up(event); canvas.releasePointerCapture(event.pointerId); } };
  for (const [name, callback] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', handlers.up]] as const) {
    canvas.addEventListener(name, callback); scope.own(() => canvas.removeEventListener(name, callback));
  }
}

/** Promise caching coalesces parallel loads; failed loads can be retried. */
export class AssetCache<T> {
  private readonly entries = new Map<string, Promise<T>>();
  private closed = false;
  constructor(private readonly load: (url: string) => Promise<T>, private readonly release: (asset: T) => void = () => {}) {}
  get(url: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Asset cache is disposed'));
    const existing = this.entries.get(url); if (existing) return existing;
    const pending = this.load(url).catch(error => { if (this.entries.get(url) === pending) this.entries.delete(url); throw error; });
    this.entries.set(url, pending); return pending;
  }
  clear(): void {
    for (const entry of this.entries.values()) void entry.then(this.release, () => {});
    this.entries.clear();
  }
  dispose(): void { this.closed = true; this.clear(); }
}
