import { component, type Entity, type World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { createTransformResolver, transformPoint } from './features.js';
export type Collider = (
  { kind: 'rect'; width: number; height: number } | { kind: 'circle'; radius: number }
) & { offsetX?: number; offsetY?: number; group?: number; mask?: number };
export const Collider2D = component<Collider>('Collider2D');
export interface CollisionPair {
  a: Entity;
  b: Entity;
}
interface Bounds {
  entity: Entity;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  radius: number | undefined;
  group: number;
  mask: number;
}
function intersects(a: Bounds, b: Bounds): boolean {
  if (a.radius === undefined && b.radius === undefined) return true;
  if (a.radius !== undefined && b.radius !== undefined)
    return (
      (a.centerX - b.centerX) ** 2 + (a.centerY - b.centerY) ** 2 <= (a.radius + b.radius) ** 2
    );
  const circle = a.radius === undefined ? b : a,
    rect = a.radius === undefined ? a : b;
  const x = Math.max(rect.minX, Math.min(rect.maxX, circle.centerX)),
    y = Math.max(rect.minY, Math.min(rect.maxY, circle.centerY));
  return (circle.centerX - x) ** 2 + (circle.centerY - y) ** 2 <= circle.radius! ** 2;
}
/** Rectangles use world-space AABBs; transformed circles use a conservative enclosing circle. */
export function detectCollisions(world: World): CollisionPair[] {
  const resolve = createTransformResolver(world);
  const bounds: Bounds[] = [];
  for (const entity of world.query(Collider2D)) {
    const collider = world.require(entity, Collider2D),
      matrix = resolve(entity),
      offset = { x: collider.offsetX ?? 0, y: collider.offsetY ?? 0 };
    const center = transformPoint(matrix, offset);
    let radius: number | undefined, minX: number, maxX: number, minY: number, maxY: number;
    if (collider.kind === 'circle') {
      if (!Number.isFinite(collider.radius) || collider.radius < 0)
        throw new Error('Invalid collider radius');
      const a = matrix[0] ** 2 + matrix[1] ** 2,
        b = matrix[2] ** 2 + matrix[3] ** 2,
        c = matrix[0] * matrix[2] + matrix[1] * matrix[3];
      radius = collider.radius * Math.sqrt((a + b + Math.sqrt((a - b) ** 2 + 4 * c * c)) / 2);
      minX = center.x - radius;
      maxX = center.x + radius;
      minY = center.y - radius;
      maxY = center.y + radius;
    } else {
      if (![collider.width, collider.height].every((value) => Number.isFinite(value) && value >= 0))
        throw new Error('Invalid collider dimensions');
      const points = [
        offset,
        { x: offset.x + collider.width, y: offset.y },
        { x: offset.x, y: offset.y + collider.height },
        { x: offset.x + collider.width, y: offset.y + collider.height },
      ].map((point) => transformPoint(matrix, point));
      minX = Math.min(...points.map((point) => point.x));
      maxX = Math.max(...points.map((point) => point.x));
      minY = Math.min(...points.map((point) => point.y));
      maxY = Math.max(...points.map((point) => point.y));
    }
    bounds.push({
      entity,
      minX,
      maxX,
      minY,
      maxY,
      centerX: center.x,
      centerY: center.y,
      radius,
      group: collider.group ?? 1,
      mask: collider.mask ?? -1,
    });
  }
  bounds.sort((a, b) => a.minX - b.minX);
  const pairs: CollisionPair[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const a = bounds[i]!;
    for (let j = i + 1; j < bounds.length; j++) {
      const b = bounds[j]!;
      if (b.minX > a.maxX) break;
      if (b.minY > a.maxY || b.maxY < a.minY || !(a.group & b.mask) || !(b.group & a.mask))
        continue;
      if (intersects(a, b))
        pairs.push(
          a.entity.index < b.entity.index
            ? { a: a.entity, b: b.entity }
            : { a: b.entity, b: a.entity },
        );
    }
  }
  return pairs;
}
export function collisionModule(
  options: {
    onEnter?: (pair: CollisionPair) => void;
    onStay?: (pair: CollisionPair) => void;
    onExit?: (pair: CollisionPair) => void;
  } = {},
): EngineModule {
  return {
    id: 'collision-2d',
    setup(engine, scope) {
      let previous = new Map<string, CollisionPair>();
      scope.own(() => previous.clear());
      engine.addSystem(
        {
          id: 'collision-2d:detect',
          order: 50,
          update({ world }) {
            const current = new Map<string, CollisionPair>();
            for (const pair of detectCollisions(world)) {
              const key = `${pair.a.index}:${pair.a.generation}:${pair.b.index}:${pair.b.generation}`;
              current.set(key, pair);
              if (previous.has(key)) options.onStay?.(pair);
              else options.onEnter?.(pair);
            }
            for (const [key, pair] of previous) if (!current.has(key)) options.onExit?.(pair);
            previous = current;
          },
        },
        scope,
      );
    },
  };
}
