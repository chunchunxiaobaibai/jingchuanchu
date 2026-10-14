import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketHost } from '@xiaobaibaifqy/jingchuanchu-net-server';
import { BrowserConnection, RoomDirectory } from '@xiaobaibaifqy/jingchuanchu-net';
test('ten real clients join, exchange heartbeats and release all peers', async () => {
  const http = createServer(),
    rooms = new RoomDirectory<null>();
  rooms.create('room', null);
  const failures: string[] = [];
  const host = new WebSocketHost(
    http,
    {
      parse(value: unknown) {
        if (!value || typeof value !== 'object' || !('type' in value))
          throw new Error('Invalid message');
        return value as { type: string };
      },
    },
    {
      open() {},
      close(peer) {
        rooms.leave('room', peer.id);
      },
      error(peer, message) {
        peer.send({ type: 'error', message });
      },
      message(peer, message) {
        if (message.type === 'join') {
          rooms.join('room', peer.id);
          peer.send({ type: 'joined' });
        } else if (message.type === 'ping') peer.send({ type: 'pong' });
      },
    },
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert(address && typeof address !== 'string');
  const clients: BrowserConnection<{ type: string }, { type: string }>[] = [];
  try {
    let pongs = 0;
    await Promise.all(
      Array.from(
        { length: 10 },
        () =>
          new Promise<void>((resolve, reject) => {
            let client: BrowserConnection<{ type: string }, { type: string }>;
            const timeout = setTimeout(() => reject(new Error('Join timeout')), 3000);
            client = new BrowserConnection(
              { parse: (value) => value as { type: string } },
              (message) => {
                if (message.type === 'joined') {
                  clearTimeout(timeout);
                  resolve();
                }
                if (message.type === 'pong') pongs++;
              },
              (status) => {
                if (status === 'open') client.send({ type: 'join' });
              },
              {
                heartbeat: {
                  intervalMs: 25,
                  timeoutMs: 500,
                  message: () => ({ type: 'ping' }),
                  isResponse: (message) => message.type === 'pong',
                },
                onError: (error) => failures.push(error.kind),
              },
            );
            clients.push(client);
            client.connect(`ws://127.0.0.1:${address.port}/ws`);
          }),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Capacity timeout')), 3000);
      let extra: BrowserConnection<{ type: string }, { type: string }>;
      extra = new BrowserConnection(
        { parse: (value) => value as { type: string } },
        (message) => {
          if (message.type === 'error') {
            clearTimeout(timeout);
            resolve();
          }
        },
        (status) => {
          if (status === 'open') extra.send({ type: 'join' });
        },
      );
      clients.push(extra);
      extra.connect(`ws://127.0.0.1:${address.port}/ws`);
    });
    const until = Date.now() + 2000;
    while (pongs < 10 && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(pongs >= 10);
    assert.deepEqual(failures, []);
  } finally {
    for (const client of clients) client.close();
    await host.close();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
  }
  assert.equal(rooms.leave('room', 'nobody'), true);
});
