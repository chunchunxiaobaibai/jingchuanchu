import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defineComponent,
  definePage,
  input,
  output,
  model,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

test('definitions are reusable frozen descriptions and do not run setup or default factories', () => {
  let setups = 0,
    defaults = 0;
  const fields = { label: input<string>({ default: 'nickname' }) };
  const Editor = defineComponent({
    selector: 'nickname-editor',
    inputs: fields,
    outputs: { save: output<string>() },
    models: {
      value: model<{ name: string }>({
        default: () => {
          defaults++;
          return { name: '' };
        },
      }),
    },
    setup() {
      setups++;
      return {};
    },
  });
  const Page = definePage({ selector: 'settings-page', components: [Editor] });
  assert.equal(Editor.kind, 'component');
  assert.equal(Page.kind, 'page');
  assert.equal(setups, 0);
  assert.equal(defaults, 0);
  assert.equal(Object.isFrozen(Editor), true);
  assert.equal(Object.isFrozen(Editor.inputs), true);
  assert.equal(Object.isFrozen(Page.components), true);
  fields.label = input<string>({ default: 'changed' });
  assert.notStrictEqual(Editor.inputs!.label, fields.label);
});

test('ambiguous template names, conflicting model inputs and duplicate child selectors are diagnosed', () => {
  assert.throws(
    () =>
      defineComponent({
        selector: 'bad-tag',
        inputs: { playerName: input<string>(), 'player-name': input<string>() },
      }),
    /template name/,
  );
  assert.throws(
    () =>
      defineComponent({
        selector: 'bad-tag',
        inputs: { value: input<string>() },
        models: { value: model<string>() },
      }),
    /template name/,
  );
  assert.throws(
    () =>
      defineComponent({
        selector: 'bad-tag',
        outputs: { saveGame: output(), 'save-game': output() },
      }),
    /template name/,
  );
  const Child = defineComponent({ selector: 'child-view' });
  assert.throws(
    () => definePage({ selector: 'home-page', components: [Child, Child] }),
    /Duplicate child/,
  );
  assert.throws(() => defineComponent({ selector: 'NoHyphen' }), /selector/);
});

test('object defaults require a factory at the runtime boundary', () => {
  assert.throws(() => input({ default: { name: '' } } as never), /factory/);
  assert.throws(() => model({ default: [] } as never), /factory/);
});
