import {
  defineApplication,
  mountApplication,
  bootstrapApplication,
  defineComponent,
  input,
  definePage,
  createMemoryHistoryDriver,
  type ApplicationStatus,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Root = defineComponent({
  selector: 'typed-app',
  inputs: { label: input<string>({ required: true }) },
  setup(context) {
    return { label: context.inputs.label };
  },
});
const Definition = defineApplication({
  root: Root,
  inputs: { label: 'game' },
  onError(error) {
    const source: string = error.source;
    void source;
  },
});
const BadInputs = defineApplication({
  root: Root,
  inputs: {
    // @ts-expect-error root input types survive application configuration
    label: 1,
  },
});
const Future = defineApplication({
  root: Root,
  // @ts-expect-error theme requires a defined theme contract
  theme: {},
});
const Page = definePage({ selector: 'typed-page', $template: '' });
const Routed = defineApplication({
  root: Root,
  routes: [{ name: 'level', path: '/level/:id', page: Page }],
  router: { history: () => createMemoryHistoryDriver('/level/one') },
});
const IdleDefinition = defineApplication({
  root: Root,
  routes: [{ name: 'level', path: '/level/:id', page: Page }],
  router: {
    history: () => createMemoryHistoryDriver('/level/one'),
    idle: {
      targets: [
        { name: 'level', params: { id: 'one' } },
        // @ts-expect-error idle targets preserve required parameters
        { name: 'level' },
      ],
    },
  },
});
void IdleDefinition;
async function consume(host: Element, document: Document) {
  const app = await mountApplication(host, Definition);
  const label: string = app.root.exposed.label();
  const status: ApplicationStatus = app.state();
  const absent: undefined = app.router;
  const routed = await mountApplication(host, Routed);
  await routed.router.push({ name: 'level', params: { id: 'one' } });
  // @ts-expect-error route name remains narrowed through define/mount
  await routed.router.push({ name: 'unknown' });
  // @ts-expect-error required route parameter remains required
  await routed.router.push({ name: 'level' });
  routed.dispose();
  app.root.setInputs({ label: 'updated' });
  // @ts-expect-error app state is readonly
  app.state.set('disposed');
  // @ts-expect-error root inputs remain typed
  app.root.setInputs({ label: 1 });
  await bootstrapApplication(Definition, { document });
  app.dispose();
  void label;
  void status;
  void absent;
}
void consume;
void BadInputs;
void Future;
