import assert from 'node:assert/strict';
import test from 'node:test';
import { Cancellation } from '@xiaobaibaifqy/jingchuanchu-core';
import { createWebAudioDriver } from '../templates/browser/src/app/web-audio-driver.js';
import { createBrowserAssetTransport } from '../templates/browser/src/app/asset-transport.js';

function fixture() {
  const nodes: Array<{
    buffer: unknown;
    loop: boolean;
    onended: (() => void) | null;
    starts: number[];
    stops: number;
    disconnects: number;
    connect(): void;
    disconnect(): void;
    start(when: number, offset: number): void;
    stop(): void;
  }> = [];
  const gains: Array<{
    gain: { value: number };
    disconnected: number;
    connect(): void;
    disconnect(): void;
  }> = [];
  let created = 0,
    resumes = 0,
    closes = 0;
  let decode: () => Promise<AudioBuffer> = async () => ({ duration: 10 }) as AudioBuffer;
  const context = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    async resume() {
      resumes++;
      context.state = 'running';
    },
    async close() {
      closes++;
      context.state = 'closed';
    },
    decodeAudioData() {
      return decode();
    },
    createGain() {
      const gain = {
        gain: { value: 1 },
        disconnected: 0,
        connect() {},
        disconnect() {
          this.disconnected++;
        },
      };
      gains.push(gain);
      return gain;
    },
    createBufferSource() {
      const node = {
        buffer: undefined as unknown,
        loop: false,
        onended: null as (() => void) | null,
        starts: [] as number[],
        stops: 0,
        disconnects: 0,
        connect() {},
        disconnect() {
          this.disconnects++;
        },
        start(_when: number, offset: number) {
          this.starts.push(offset);
        },
        stop() {
          this.stops++;
        },
      };
      nodes.push(node);
      return node;
    },
  };
  const driver = createWebAudioDriver(() => {
    created++;
    return context as unknown as AudioContext;
  });
  return {
    driver,
    context,
    nodes,
    gains,
    created: () => created,
    resumes: () => resumes,
    closes: () => closes,
    decoder: (fn: typeof decode) => {
      decode = fn;
    },
  };
}

test('Web Audio driver unlocks only on request and resumes voices from the paused offset without stale ended callbacks', async () => {
  const f = fixture();
  assert.equal(f.created(), 0);
  const unlock = f.driver.unlock();
  assert.equal(f.created(), 1);
  assert.equal(f.resumes(), 1);
  assert.equal(await unlock, 'ready');
  assert.equal(await f.driver.unlock(), 'ready');
  assert.equal(f.resumes(), 1);
  const audio = await f.driver.decode(new ArrayBuffer(8), new Cancellation());
  let ended = 0;
  const voice = await f.driver.start(audio, {
    loop: false,
    gain: 0.5,
    onEnded() {
      ended++;
    },
  });
  assert.equal(f.gains[0]!.gain.value, 0.5);
  f.context.currentTime = 3;
  const staleEnded = f.nodes[0]!.onended!;
  voice.pause();
  voice.pause();
  assert.equal(f.nodes[0]!.stops, 1);
  assert.equal(f.nodes[0]!.onended, null);
  f.context.currentTime = 20;
  voice.resume();
  assert.deepEqual(f.nodes[1]!.starts, [3]);
  staleEnded();
  assert.equal(ended, 0);
  voice.setGain(0.2);
  assert.equal(f.gains[0]!.gain.value, 0.2);
  f.nodes[1]!.onended!();
  assert.equal(ended, 1);
  assert.equal(f.gains[0]!.disconnected, 1);
  voice.stop();
  voice.resume();
  assert.equal(f.nodes.length, 2);
  assert.equal(ended, 1);
  f.driver.release(audio);
  assert.throws(() => f.driver.start(audio, { loop: false, gain: 1, onEnded() {} }), /released/);
  await f.driver.close();
  await f.driver.close();
  assert.equal(f.closes(), 1);
});

test('Web Audio loops wrap the paused offset, suspended contexts cannot start, and closing stops voices and pending decode', async () => {
  const f = fixture();
  await f.driver.unlock();
  const audio = await f.driver.decode(new ArrayBuffer(8), new Cancellation());
  let ended = 0;
  const voice = await f.driver.start(audio, {
    loop: true,
    gain: 1,
    onEnded() {
      ended++;
    },
  });
  f.context.currentTime = 23;
  voice.pause();
  voice.resume();
  assert.deepEqual(f.nodes[1]!.starts, [3]);
  assert.equal(f.nodes[1]!.loop, true);
  f.context.state = 'suspended';
  assert.throws(() => f.driver.start(audio, { loop: false, gain: 1, onEnded() {} }), /suspended/);
  let releaseDecode!: (buffer: AudioBuffer) => void;
  f.decoder(
    () =>
      new Promise((resolve) => {
        releaseDecode = resolve;
      }),
  );
  const pending = Promise.resolve(f.driver.decode(new ArrayBuffer(8), new Cancellation()));
  const cancelled = assert.rejects(pending, /cancelled/);
  await f.driver.close();
  await cancelled;
  assert.equal(f.nodes[1]!.stops, 1);
  assert.equal(f.gains[0]!.disconnected, 1);
  assert.equal(ended, 0);
  releaseDecode({ duration: 10 } as AudioBuffer);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(Promise.resolve(f.driver.unlock()), /disposed/);
});

test('cancelled decode ignores a late buffer and audio byte transport checks HTTP failures and cancellation', async () => {
  const f = fixture();
  await f.driver.unlock();
  let releaseDecode!: (buffer: AudioBuffer) => void;
  f.decoder(
    () =>
      new Promise((resolve) => {
        releaseDecode = resolve;
      }),
  );
  const signal = new Cancellation();
  const decoded = Promise.resolve(f.driver.decode(new ArrayBuffer(8), signal));
  const rejected = assert.rejects(decoded, /cancel decode/);
  signal.cancel(new Error('cancel decode'));
  await rejected;
  releaseDecode({ duration: 10 } as AudioBuffer);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await f.driver.close();
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  let nativeSignal: AbortSignal | undefined,
    response: Response = new Response(bytes);
  const transport = createBrowserAssetTransport(async (_input, init) => {
    nativeSignal = init?.signal as AbortSignal;
    return response;
  });
  const entry = { kind: 'audio' as const, url: '/collect.wav' };
  assert.deepEqual(await transport.load(entry, new Cancellation()), bytes);
  response = new Response(null, { status: 404 });
  await assert.rejects(Promise.resolve(transport.load(entry, new Cancellation())), /404/);
  let finishFetch!: (response: Response) => void;
  const delayed = createBrowserAssetTransport((_input, init) => {
    nativeSignal = init?.signal as AbortSignal;
    return new Promise((resolve) => {
      finishFetch = resolve;
    });
  });
  const page = new Cancellation();
  const loading = Promise.resolve(delayed.load(entry, page));
  const cancelled = assert.rejects(loading, /left page/);
  page.cancel(new Error('left page'));
  assert.equal(nativeSignal!.aborted, true);
  finishFetch(new Response(bytes));
  await cancelled;
});
