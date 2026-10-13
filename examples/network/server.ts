import { createServer } from 'node:http';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketHost } from '@xiaobaibaifqy/jingchuanchu-net-server';
import { clientDecoder } from './protocol.js';

export async function createPingServer(port = 3002) {
  const http = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Ping server is running');
  });
  const host = new WebSocketHost(
    http,
    clientDecoder,
    {
      open() {},
      message(peer) {
        peer.send({ type: 'pong', serverTime: Date.now() });
      },
      close() {},
      error(peer, message) {
        peer.send({ type: 'error', message });
      },
    },
    ['http://localhost:5175', 'http://127.0.0.1:5175'],
  );
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, '127.0.0.1', () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await host.close();
    throw error;
  }
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP address');
  return {
    port: address.port,
    async close(): Promise<void> {
      await host.close();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createPingServer(Number(process.env.PORT ?? 3002));
  console.log(`Ping server listening on ws://127.0.0.1:${server.port}/ws`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      void server.close().then(
        () => process.exit(0),
        (error) => {
          console.error(error);
          process.exit(1);
        },
      );
    });
}
