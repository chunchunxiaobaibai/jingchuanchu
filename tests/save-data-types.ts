import { defineSave, SaveService } from '@xiaobaibaifqy/jingchuanchu-app/application';
const definition = defineSave({
  key: 'typed',
  version: 1,
  select: (state: { score: number; transient: string }) => ({ score: state.score }),
  parse(value: unknown) {
    return { score: (value as { score: number }).score };
  },
  restore(state, data) {
    state.score = data.score;
  },
});
async function types(service: SaveService) {
  await service.save(definition, { score: 1, transient: 'ignored' });
  // @ts-expect-error state must match the selected business context
  await service.save(definition, { wrong: 1 });
  const result = await service.load(definition);
  if (result.status === 'loaded') {
    const score: number = result.data.score;
    void score;
    // @ts-expect-error persisted DTO excludes transient state
    result.data.transient;
    // @ts-expect-error loaded DTO is readonly
    result.data.score = 5;
  }
}
void types;
