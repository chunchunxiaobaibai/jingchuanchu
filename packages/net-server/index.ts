import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { RateLimit, type Decoder, type Peer } from '@xiaobaibaifqy/jingchuanchu-net';

export class WebSocketHost<Client> {
  private readonly server: WebSocketServer;
  private readonly sessions = new Map<
    WebSocket,
    { peer: Peer; alive: boolean; limit: RateLimit }
  >();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  constructor(
    http: Server,
    decoder: Decoder<Client>,
    handlers: {
      open(peer: Peer): void;
      message(peer: Peer, message: Client): void;
      close(peer: Peer): void;
      error(peer: Peer, message: string): void;
    },
    allowedOrigins: readonly string[] = [],
  ) {
    this.server = new WebSocketServer({
      server: http,
      path: '/ws',
      maxPayload: 32 * 1024,
      perMessageDeflate: false,
      verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => {
        if (this.sessions.size >= 1000) return false;
        if (!origin) return true; // Non-browser clients; no credentials are used in this local demo.
        try {
          return allowedOrigins.includes(origin) || new URL(origin).host === req.headers.host;
        } catch {
          return false;
        }
      },
    });
    this.server.on('connection', (socket) => {
      const peer: Peer = {
        id: randomUUID(),
        send: (message) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (socket.bufferedAmount > 1024 * 1024) {
            socket.close(1013, 'Slow consumer');
            return;
          }
          socket.send(JSON.stringify(message), (error) => {
            if (error) socket.terminate();
          });
        },
      };
      const session = { peer, alive: true, limit: new RateLimit(100) };
      this.sessions.set(socket, session);
      socket.on('error', () => socket.terminate());
      socket.on('pong', () => {
        session.alive = true;
      });
      socket.on('message', (data, binary) => {
        if (!session.limit.allow(Date.now())) {
          socket.close(1008, 'Message rate exceeded');
          return;
        }
        let message: Client;
        try {
          if (binary) throw new Error('Binary payload is unsupported');
          message = decoder.parse(JSON.parse(data.toString()));
        } catch {
          handlers.error(peer, '消息格式无效');
          return;
        }
        try {
          handlers.message(peer, message);
        } catch (error) {
          handlers.error(peer, error instanceof Error ? error.message : '操作失败');
        }
      });
      socket.on('close', () => {
        this.sessions.delete(socket);
        handlers.close(peer);
      });
      handlers.open(peer);
    });
    this.heartbeat = setInterval(() => {
      for (const [socket, session] of this.sessions) {
        if (!session.alive) {
          socket.terminate();
          continue;
        }
        session.alive = false;
        socket.ping();
      }
    }, 30_000);
  }
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const socket of this.sessions.keys()) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
