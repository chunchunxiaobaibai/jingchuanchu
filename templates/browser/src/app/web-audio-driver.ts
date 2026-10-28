import type {
  AudioDriver,
  AudioVoice,
  DecodedAudio,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

/** An application-owned, lazy Web Audio adapter. Only unlock creates/resumes the context. */
export function createWebAudioDriver(createContext = () => new AudioContext()): AudioDriver {
  let context: AudioContext | undefined,
    closed = false,
    closing: Promise<void> | undefined;
  const buffers = new Map<DecodedAudio, AudioBuffer>();
  const voices = new Set<AudioVoice>();
  const decodes = new Set<() => void>();
  const activeContext = () => {
    if (closed) throw new Error('Audio driver is disposed');
    if (!context) throw new Error('Audio driver is locked');
    return context;
  };
  const volume = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid audio gain');
    return value;
  };
  return {
    unlock() {
      if (closed) return Promise.reject(new Error('Audio driver is disposed'));
      // Both construction and resume must enter synchronously in the user's event handler.
      const target = (context ??= createContext());
      if (target.state === 'closed') return Promise.reject(new Error('Audio context is closed'));
      const state = () =>
        target.state === 'running' ? ('ready' as const) : ('suspended' as const);
      return target.state === 'running' ? Promise.resolve(state()) : target.resume().then(state);
    },
    decode(data, signal) {
      const target = activeContext();
      signal.throwIfAborted();
      return new Promise<DecodedAudio>((resolve, reject) => {
        let settled = false,
          unsubscribe = () => {};
        const finish = (error: unknown, buffer?: AudioBuffer) => {
          if (settled) return;
          settled = true;
          unsubscribe();
          decodes.delete(cancel);
          if (buffer && !closed && !signal.aborted) {
            const token = Object.freeze({});
            buffers.set(token, buffer);
            resolve(token);
          } else reject(error ?? new Error('Audio decode cancelled'));
        };
        const cancel = () => finish(signal.reason ?? new Error('Audio decode cancelled'));
        decodes.add(cancel);
        unsubscribe = signal.subscribe(cancel);
        if (settled) return;
        try {
          void target.decodeAudioData(data).then(
            (buffer) => finish(undefined, buffer),
            (error) => finish(error),
          );
        } catch (error) {
          finish(error);
        }
      });
    },
    start(audio, options) {
      const target = activeContext(),
        buffer = buffers.get(audio);
      if (target.state !== 'running') throw new Error('Audio context is suspended');
      if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0)
        throw new Error('Audio buffer is missing or released');
      const gain = target.createGain();
      let source: AudioBufferSourceNode | undefined,
        offset = 0,
        began = 0,
        stopped = false;
      const detachSource = () => {
        const previous = source;
        source = undefined;
        if (previous) {
          previous.onended = null;
          try {
            previous.stop();
          } finally {
            previous.disconnect();
          }
        }
      };
      const retire = () => {
        if (stopped) return;
        stopped = true;
        try {
          detachSource();
        } finally {
          gain.disconnect();
          voices.delete(voice);
        }
      };
      const begin = () => {
        if (stopped || source) return;
        if (closed || target.state !== 'running') throw new Error('Audio context is suspended');
        if (!options.loop && offset >= buffer.duration) {
          retire();
          options.onEnded();
          return;
        }
        const node = target.createBufferSource();
        source = node;
        node.buffer = buffer;
        node.loop = options.loop;
        node.connect(gain);
        node.onended = () => {
          if (stopped || source !== node) return;
          source = undefined;
          node.onended = null;
          node.disconnect();
          retire();
          options.onEnded();
        };
        began = target.currentTime;
        try {
          node.start(0, offset);
        } catch (error) {
          retire();
          throw error;
        }
      };
      const voice: AudioVoice = {
        setGain(value) {
          if (!stopped) gain.gain.value = volume(value);
        },
        pause() {
          if (stopped || !source) return;
          offset += Math.max(0, target.currentTime - began);
          offset = options.loop ? offset % buffer.duration : Math.min(offset, buffer.duration);
          detachSource();
        },
        resume: begin,
        stop: retire,
      };
      try {
        gain.gain.value = volume(options.gain);
        gain.connect(target.destination);
        voices.add(voice);
        begin();
        return voice;
      } catch (error) {
        retire();
        throw error;
      }
    },
    release(audio) {
      buffers.delete(audio);
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const errors: unknown[] = [];
        for (const cancel of [...decodes]) cancel();
        for (const voice of [...voices]) {
          try {
            voice.stop();
          } catch (error) {
            errors.push(error);
          }
        }
        buffers.clear();
        try {
          if (context && context.state !== 'closed') await context.close();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, 'Audio driver cleanup failed');
      })();
      return closing;
    },
  };
}
