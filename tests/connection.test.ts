import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserConnection } from '@xiaobaibaifqy/jingchuanchu-net';
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  closed = false;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code: number }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  constructor(readonly url: string) {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
function sockets() {
  const original = globalThis.WebSocket;
  Socket.instances = [];
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  return () => {
    globalThis.WebSocket = original;
  };
}
test('business handler failures do not close valid transport; invalid messages do', () => {
  const restore = sockets();
  const errors: string[] = [];
  const connection = new BrowserConnection<unknown, unknown>(
    { parse: (value) => value },
    () => {
      throw new Error('handler');
    },
    () => {},
    { onError: (error) => errors.push(error.kind) },
  );
  try {
    connection.connect('ws://test');
    const socket = Socket.instances[0]!;
    socket.open();
    socket.onmessage?.({ data: '{"ok":true}' });
    assert.equal(connection.status, 'open');
    assert.equal(socket.closed, false);
    socket.onmessage?.({ data: 'bad-json' });
    assert.equal(socket.closed, true);
    assert.deepEqual(errors, ['handler', 'decode']);
  } finally {
    connection.close();
    restore();
  }
});
