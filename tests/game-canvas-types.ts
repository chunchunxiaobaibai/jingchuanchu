import {
  defineGameScene,
  defineActions,
  type GameCanvasHandle,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const scene = defineGameScene({
  id: 'typed-controls',
  actions: defineActions({
    move: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'] },
    jump: { kind: 'button', keys: ['Space'] },
  }),
  prepare(_signal, props: Readonly<{ level: number }>) {
    return props.level;
  },
  setup() {},
});
function controls(game: GameCanvasHandle) {
  void game.switchTo(scene, { level: 2 });
  // @ts-expect-error transition props match the scene contract
  void game.switchTo(scene, { wrong: 2 });
  const input = game.forScene(scene);
  input.setVirtual('move', 1);
  input.setVirtual('jump', true);
  // @ts-expect-error axis values are numeric
  input.setVirtual('move', true);
  // @ts-expect-error unknown actions are rejected
  input.setVirtual('unknown', 1);
  // @ts-expect-error status is readonly
  game.status.set('running');
}
void controls;
