import { defineGameScene, defineActions } from '@xiaobaibaifqy/jingchuanchu-app/application';
const actions = defineActions({ move: { kind: 'axis', negative: ['KeyA'], positive: ['KeyD'] } });
defineGameScene({
  id: 'typed',
  actions,
  prepare(_signal, props: Readonly<{ level: number }>) {
    return { level: props.level };
  },
  setup(context) {
    const level: number = context.prepared.level;
    const movement: number = context.actions.axes.move;
    // @ts-expect-error props remain readonly
    context.props.level = 2;
    // @ts-expect-error action names remain exact
    context.actions.axes.missing;
    // @ts-expect-error axis is not a button
    context.actions.buttons.move;
    // @ts-expect-error no page element access
    context.element('canvas');
    void level;
    void movement;
  },
});
defineGameScene({
  id: 'no-actions',
  setup(context) {
    // @ts-expect-error omitting actions does not introduce arbitrary button names
    context.actions.buttons.fire;
  },
});
