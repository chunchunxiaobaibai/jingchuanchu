import {
  defineActions,
  createActions,
  type Viewport,
  type ActionSnapshot,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ActionSampler } from '../packages/app/runtime/input-actions.js';
const definition = defineActions({
  moveX: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'] },
  fire: { kind: 'button', keys: ['Space'] },
});
const sampler = new ActionSampler(definition);
sampler.setVirtual('moveX', 0.5);
sampler.setVirtual('fire', true);
const state: ActionSnapshot<typeof definition.entries> = sampler.read();
const axis: number = state.axes.moveX;
const down: boolean = state.buttons.fire.down;
// @ts-expect-error buttons are not axes
state.axes.fire;
// @ts-expect-error axes are not buttons
state.buttons.moveX;
// @ts-expect-error snapshots are readonly
state.buttons.fire.down = false;
// @ts-expect-error unknown actions are rejected
sampler.setVirtual('other', true);
// @ts-expect-error axis values must be numeric
sampler.setVirtual('moveX', true);
// @ts-expect-error button values must be boolean
sampler.setVirtual('fire', 1);
void axis;
void down;

function publicController(
  canvas: HTMLCanvasElement,
  viewport: Viewport,
  scope: import('@xiaobaibaifqy/jingchuanchu-core').Scope,
) {
  const actions = createActions({ definition, canvas, viewport, scope });
  actions.setVirtual('moveX', 1, 'left');
  actions.setVirtual('fire', true);
  const amount: number = actions.read().axes.moveX;
  // @ts-expect-error public controller preserves numeric axis values
  actions.setVirtual('moveX', false);
  // @ts-expect-error public controller preserves button keys
  actions.read().buttons.moveX;
  // @ts-expect-error public controller rejects unknown actions
  actions.setVirtual('missing', true);
  void amount;
}
void publicController;
