import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineComponent,
  input,
  mountComponent,
  defineGameScene,
  nextTick,
  signal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { stageComponentInputs } from '../packages/app/runtime/component-runtime.js';
function host() {
  const document = new Window().document as unknown as Document;
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

test('explicit reference inputs accept scene definitions and preserve identity through updates/change snapshots/rollback', async () => {
  const first = defineGameScene({ id: 'first', setup() {} }),
    second = defineGameScene({ id: 'second', setup() {} });
  const changes: { previous: unknown; current: unknown }[] = [];
  const Definition = defineComponent({
    selector: 'scene-ref-input',
    $template: '',
    inputs: {
      scene: input<typeof first>({ required: true, mode: 'reference' }),
      label: input({ default: 'play' }),
    },
    setup(c) {
      return { scene: c.inputs.scene };
    },
    onInputsChanged(_c, change) {
      changes.push({ previous: change.previous.scene, current: change.current.scene });
      assert.equal(Object.isFrozen(change.current), true);
    },
  });
  const mounted = mountComponent(host(), Definition, { inputs: { scene: first } });
  try {
    assert.equal(mounted.exposed.scene(), first);
    mounted.setInputs({ scene: first });
    await nextTick();
    assert.equal(changes.length, 0);
    const apply = stageComponentInputs(mounted, { scene: first }, { scene: second });
    const rollback = apply();
    await nextTick();
    assert.equal(mounted.exposed.scene(), second);
    assert.deepEqual(changes, [{ previous: first, current: second }]);
    rollback();
    await nextTick();
    assert.equal(mounted.exposed.scene(), first);
    assert.equal(changes.at(-1)!.previous, second);
    assert.equal(changes.at(-1)!.current, first);
  } finally {
    mounted.dispose();
  }
});

test('reference configuration keeps callable host capabilities while default value inputs and signals remain data-only', () => {
  const driver = { requestFrame: () => 7 };
  const Reference = defineComponent({
    selector: 'driver-ref-input',
    $template: '',
    inputs: { driver: input<typeof driver>({ required: true, mode: 'reference' }) },
    setup(c) {
      return { driver: c.inputs.driver };
    },
  });
  const mounted = mountComponent(host(), Reference, { inputs: { driver } });
  assert.equal(mounted.exposed.driver(), driver);
  assert.equal(mounted.exposed.driver().requestFrame(), 7);
  assert.equal(Object.isFrozen(driver), false);
  mounted.dispose();
  const Value = defineComponent({
    selector: 'driver-value-input',
    $template: '',
    inputs: { driver: input<typeof driver>({ required: true }) },
  });
  assert.throws(() => mountComponent(host(), Value, { inputs: { driver } }));
  assert.throws(() => signal(driver));
});

test('parent template property binding passes a scene definition into a reference child input', () => {
  const scene = defineGameScene({ id: 'template-scene', setup() {} });
  let received: unknown;
  const Child = defineComponent({
    selector: 'scene-ref-child',
    $template: '',
    inputs: { scene: input<typeof scene>({ required: true, mode: 'reference' }) },
    setup(c) {
      received = c.inputs.scene();
      return {};
    },
  });
  const Parent = defineComponent({
    selector: 'scene-ref-parent',
    components: [Child],
    $template: '<scene-ref-child></scene-ref-child>',
    $bindings: [
      {
        path: [0],
        kind: 'property',
        name: 'scene',
        source: 'parent:scene',
        evaluate: (scope) => scope.scene,
      },
    ],
    setup() {
      return { scene };
    },
  });
  const mounted = mountComponent(host(), Parent);
  assert.equal(received, scene);
  mounted.dispose();
});
