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

test('explicit queued sends coalesce with bounds; retry cancels on close', async () => {
  const restore = sockets();
  const connection = new BrowserConnection<string, unknown>(
    { parse: (value) => value },
    () => {},
    () => {},
    { reconnect: { delayMs: 5, maxAttempts: 2 }, maxQueuedMessages: 2, maxQueuedBytes: 100 },
  );
  try {
    connection.connect('ws://test');
    assert.equal(connection.send('first', { queue: true, key: 'pointer' }), true);
    assert.equal(connection.send('latest', { queue: true, key: 'pointer' }), true);
    assert.equal(connection.send('reliable', { queue: true }), true);
    assert.equal(connection.send('overflow', { queue: true }), false);
    const first = Socket.instances[0]!;
    first.open();
    assert.deepEqual(first.sent, ['"latest"', '"reliable"']);
    first.onclose?.({ code: 1006 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(Socket.instances.length, 2);
    const second = Socket.instances[1]!;
    second.onclose?.({ code: 1006 });
    connection.close();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(Socket.instances.length, 2);
    assert.equal(connection.stats.queuedMessages, 0);
  } finally {
    connection.close();
    restore();
  }
});

test('backpressure drains bounded queues and heartbeats close silent sockets', async () => {
  const restore = sockets();
  const connection = new BrowserConnection<string, string>(
    { parse: (value) => String(value) },
    () => {},
    () => {},
    {
      maxBufferedBytes: 4,
      heartbeat: {
        intervalMs: 5,
        timeoutMs: 15,
        message: () => 'ping',
        isResponse: (value) => value === 'pong',
      },
    },
  );
  try {
    connection.connect('ws://test');
    const socket = Socket.instances[0]!;
    socket.open();
    socket.bufferedAmount = 10;
    assert.equal(connection.send('no'), false);
    assert.equal(connection.send('queued', { queue: true }), true);
    socket.bufferedAmount = 0;
    await new Promise((resolve) => setTimeout(resolve, 18));
    assert(socket.sent.includes('"queued"'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(socket.closed, true);
    assert.equal(connection.lastError?.kind, 'heartbeat');
  } finally {
    connection.close();
    restore();
  }
});

test('reentrant manual reconnect from status callbacks cannot leave a second retry behind', async () => {
  const restore = sockets();
  let connection!: BrowserConnection<string, unknown>;
  connection = new BrowserConnection(
    { parse: (value) => value },
    () => {},
    (status) => {
      if (status === 'closed') connection.connect('ws://replacement');
    },
    { reconnect: { delayMs: 5 } },
  );
  try {
    connection.connect('ws://first');
    Socket.instances[0]!.onclose?.({ code: 1006 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(Socket.instances.length, 2);
    assert.equal(Socket.instances[1]!.url, 'ws://replacement');
  } finally {
    connection.close();
    restore();
  }
});
