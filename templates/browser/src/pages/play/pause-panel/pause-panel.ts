import { defineComponent, input, model, output } from '@xiaobaibaifqy/jingchuanchu-app/application';

export const PausePanel = defineComponent({
  selector: 'game-pause-panel',
  inputs: { busy: input<boolean>({ default: false }) },
  models: { paused: model<boolean>({ required: true }) },
  outputs: { restartRequested: output() },
  setup(context) {
    const resume = () => context.models.paused.set(false);
    // The page confirms an asynchronous restart before clearing its paused state.
    const restart = () => context.emit('restartRequested');
    return { busy: context.inputs.busy, paused: context.models.paused, resume, restart };
  },
});
