import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineApplication,
  defineComponent,
  mountApplication,
  defineAssetGroup,
  type AudioDriver,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
const Root = defineComponent({ selector: 'audio-root', $template: '' });
const Sounds = defineAssetGroup({
  name: 'sounds',
  entries: { click: { kind: 'audio', url: '/click.bin' } },
});
function host() {
  const document = new Window().document as unknown as Document;
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const events: string[] = [];
  let factories = 0,
    loads = 0,
    gain = 1;
  const driver: AudioDriver = {
    unlock: async () => 'ready',
    async decode() {
      events.push('decode');
      return {};
    },
    start(_clip, options) {
      gain = options.gain;
      events.push('start');
      return {
        setGain(value) {
          gain = value;
        },
        pause() {
          events.push('pause');
        },
        resume() {
          events.push('resume');
        },
        stop() {
          events.push('stop');
        },
      };
    },
    release() {
      events.push('release');
    },
    close() {
      events.push('close');
    },
  };
  return {
    events,
    driver,
    gain: () => gain,
    factories: () => factories,
    loads: () => loads,
    assets: {
      transport: () => ({
        async load() {
          loads++;
          return new ArrayBuffer(4);
        },
        release() {
          events.push('raw-release');
        },
      }),
    },
    audio: {
      driver() {
        factories++;
        return driver;
      },
      maxEffects: 1 as const,
    },
  };
}

test('application audio exposes readonly controls, blocks without loading, updates gain and stops before releasing/closing on exit', async () => {
  const f = fixture(),
    app = await mountApplication(
      host(),
      defineApplication({ root: Root, assets: f.assets, audio: f.audio }),
    );
  assert.equal(f.factories(), 1);
  assert.ok(app.audio);
  assert.equal(app.audio.state(), 'locked');
  assert.deepEqual(await app.audio.playEffect(Sounds, 'click'), {
    status: 'blocked',
    reason: 'locked',
  });
  assert.equal(f.loads(), 0);
  assert.deepEqual(await app.audio.unlock(), { status: 'ready' });
  app.audio.setVolume('master', 0.5);
  app.audio.setVolume('effects', 0.4);
  const played = await app.audio.playEffect(Sounds, 'click');
  assert.equal(played.status, 'played');
  assert.equal(f.gain(), 0.2);
  app.audio.setMuted(true);
  assert.equal(f.gain(), 0);
  app.audio.setMuted(false);
  assert.equal(f.gain(), 0.2);
  assert.equal(Reflect.set(app.audio.preferences().volumes, 'master', 1), false);
  app.dispose();
  await settle();
  app.dispose();
  assert.equal(app.audio.state(), 'disposed');
  assert.equal(f.events.filter((v) => v === 'stop').length, 1);
  assert.equal(f.events.filter((v) => v === 'close').length, 1);
  assert.ok(f.events.indexOf('stop') < f.events.indexOf('release'));
  assert.ok(f.events.indexOf('release') < f.events.indexOf('close'));
  assert.deepEqual(await app.audio.playEffect(Sounds, 'click'), { status: 'cancelled' });
});

test('audio configuration is opt-in, validated before factory execution and respects external driver ownership', async () => {
  const plain = await mountApplication(host(), defineApplication({ root: Root }));
  assert.equal(plain.audio, undefined);
  plain.dispose();
  const f = fixture();
  assert.throws(
    () => defineApplication({ root: Root, audio: f.audio }),
    /requires application assets/,
  );
  assert.throws(
    () => defineApplication({ root: Root, assets: f.assets, audio: { ...f.audio, maxEffects: 0 } }),
    /positive effect limit/,
  );
  assert.equal(f.factories(), 0);
  const external = await mountApplication(
    host(),
    defineApplication({ root: Root, assets: f.assets, audio: { ...f.audio, ownsDriver: false } }),
  );
  external.dispose();
  assert.equal(f.events.includes('close'), false);
});

test('failed root setup rolls back the constructed audio service and malformed driver factories close adopted resources', async () => {
  const f = fixture(),
    Fail = defineComponent({
      selector: 'audio-failed-root',
      $template: '',
      setup() {
        throw new Error('root failed');
      },
    });
  await assert.rejects(
    mountApplication(host(), defineApplication({ root: Fail, assets: f.assets, audio: f.audio })),
    /root failed/,
  );
  assert.equal(f.factories(), 1);
  assert.equal(f.events.filter((v) => v === 'close').length, 1);
  let closed = 0;
  await assert.rejects(
    mountApplication(
      host(),
      defineApplication({
        root: Root,
        assets: f.assets,
        audio: {
          driver: () =>
            ({
              close() {
                closed++;
              },
            }) as AudioDriver,
        },
      }),
    ),
    /AudioDriver methods are missing/,
  );
  assert.equal(closed, 1);
});
