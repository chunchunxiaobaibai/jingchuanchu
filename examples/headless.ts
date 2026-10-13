import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';
import { component } from '@xiaobaibaifqy/jingchuanchu-ecs';

const Position = component<{ x: number }>('Position');
const Velocity = component<{ x: number }>('Velocity');
const engine = new Engine({ tickRate: 30 });
const player = engine.world.create();
engine.world.set(player, Position, { x: 0 });
engine.world.set(player, Velocity, { x: 30 });
engine.addSystem({
  id: 'move',
  update({ world, delta }) {
    for (const entity of world.query(Position, Velocity))
      world.require(entity, Position).x += world.require(entity, Velocity).x * delta;
  },
});
engine.start();
engine.advance(engine.step);
if (engine.world.require(player, Position).x !== 1) throw new Error('Unexpected movement');
console.log('Position after one step:', engine.world.require(player, Position).x);
engine.dispose();
