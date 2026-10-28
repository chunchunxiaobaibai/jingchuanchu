import {
  computed,
  defineComponent,
  input,
  model,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

export const GameHud = defineComponent({
  selector: 'game-hud',
  inputs: {
    pauseIcon: input<string>({ default: '' }),
    disabled: input<boolean>({ default: false }),
    levelTitle: input<string>({ required: true }),
    score: input<number>({ required: true }),
    remainingSeconds: input<number>({ required: true }),
  },
  models: { paused: model<boolean>({ required: true }) },
  setup(context) {
    const seconds = computed(() => Math.max(0, Math.ceil(context.inputs.remainingSeconds())));
    const pause = () => context.models.paused.set(true);
    return {
      pauseIcon: context.inputs.pauseIcon,
      disabled: context.inputs.disabled,
      levelTitle: context.inputs.levelTitle,
      score: context.inputs.score,
      seconds,
      paused: context.models.paused,
      pause,
    };
  },
});
