import type { Entity, World } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { Position2D, Shape2D, type Point } from './components.js';
import {
  Transform2D,
  Sprite2D,
  createTransformResolver,
  multiply,
  type Camera2D,
  type Matrix2D,
  type Sprite,
  type TransformFrameCache,
} from './features.js';

type DrawItem = { entity: Entity; layer: number } & (
  { shape: NonNullable<typeof Shape2D.__type>; position: Point } | { sprite: Sprite }
);

export function visitWorldDrawItems(
  world: World,
  cache: TransformFrameCache,
  camera: Camera2D | undefined,
  visit: (item: DrawItem, matrix: Matrix2D | undefined) => void,
): void {
  cache.clear();
  const resolve = createTransformResolver(world, cache);
  const view = camera?.matrix;
  // Build the final queue directly: intermediate maps and object spreads used
  // to copy every shape multiple times on every frame. Keep the three passes
  // in this order so stable sorting preserves existing equal-layer behavior.
  const items: DrawItem[] = [];

  // Use bulkQuery for hot-path queries (Position2D + Shape2D)
  const posShapeIterator = world.bulkQuery(Position2D, Shape2D);
  const { buffer: posShapeBuffer } = posShapeIterator.next().value!;
  for (const entity of posShapeBuffer) {
    const shape = world.require(entity, Shape2D);
    items.push({
      entity,
      shape,
      position: world.require(entity, Position2D),
      layer: shape.layer,
    });
  }
  posShapeIterator.return?.();

  // Use bulkQuery for Transform2D + Shape2D
  const transformShapeIterator = world.bulkQuery(Transform2D, Shape2D);
  const { buffer: transformShapeBuffer } = transformShapeIterator.next().value!;
  for (const entity of transformShapeBuffer)
    if (!world.has(entity, Position2D)) {
      const shape = world.require(entity, Shape2D);
      items.push({ entity, shape, position: { x: 0, y: 0 }, layer: shape.layer });
    }
  transformShapeIterator.return?.();

  // Use bulkQuery for Sprite2D
  const spriteIterator = world.bulkQuery(Sprite2D);
  const { buffer: spriteBuffer } = spriteIterator.next().value!;
  for (const entity of spriteBuffer) {
    const sprite = world.require(entity, Sprite2D);
    items.push({ entity, sprite, layer: sprite.layer ?? 0 });
  }
  spriteIterator.return?.();

  items.sort((a, b) => a.layer - b.layer);
  for (const item of items) {
    let matrix: Matrix2D | undefined;
    if (view || world.has(item.entity, Transform2D) || 'sprite' in item) {
      const transform = resolve(item.entity);
      matrix = view ? multiply(view, transform) : transform;
    }
    visit(item, matrix);
  }
}
