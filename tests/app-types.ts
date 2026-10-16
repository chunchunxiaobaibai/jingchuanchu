import { defineView, viewInputs, defineScene } from '@xiaobaibaifqy/jingchuanchu-app';
type State = { score: number };
type Commands = { move: { x: number }; pause: undefined };
const child = defineView<State, Commands, { value: number }>({ selector: 'game-child' });
viewInputs(child, { value: 1 });
// @ts-expect-error Child inputs must match their public contract.
viewInputs(child, { value: 'wrong' });
defineView<State, Commands>({
  selector: 'game-parent',
  actions: {
    move(context) {
      context.commands.send('move', { x: 1 });
      // @ts-expect-error Unknown command.
      context.commands.send('missing', undefined);
      // @ts-expect-error Wrong command payload.
      context.commands.send('move', { x: 'bad' });
      // @ts-expect-error Read-only display snapshots.
      context.state.score = 1;
      // @ts-expect-error UI does not receive an Engine.
      context.engine.start();
    },
  },
});
defineScene<State, Commands>({
  setup(context) {
    context.commands.handle('move', (point) => {
      const x: number = point.x;
      void x;
    });
    // @ts-expect-error Handler payload follows the command contract.
    context.commands.handle('move', (point: { x: string }) => {
      void point;
    });
  },
});
