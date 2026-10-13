import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketHost } from '../../packages/net/server.js';
import { RateLimit, RoomDirectory, type Peer } from '../../packages/net/index.js';
import { DrawGuessRoom } from '../../games/draw-guess/room.js';
import {
  clientMessageSchema,
  PROTOCOL_VERSION,
  type ClientMessage,
} from '../../games/draw-guess/protocol.js';

interface Session {
  peer: Peer;
  roomId: string | undefined;
  drawing: RateLimit;
  guessing: RateLimit;
}
export async function createGameServer(
  options: {
    port?: number;
    host?: string;
    staticDir?: string;
    allowedOrigins?: readonly string[];
  } = {},
) {
  const rooms = new RoomDirectory<DrawGuessRoom>();
  const sessions = new Map<string, Session>();
  const staticDir = options.staticDir ? resolve(options.staticDir) : undefined;
  const http = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (!staticDir || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    let file: string;
    try {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      file = resolve(staticDir, '.' + (path === '/' ? '/index.html' : path));
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }
    if (!file.startsWith(staticDir + sep)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    void readFile(file).then(
      (body) => {
        response.writeHead(200, {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      },
      () => {
        response.writeHead(404);
        response.end('Not found');
      },
    );
  });
  const leave = (session: Session): void => {
    if (!session.roomId) return;
    const id = session.roomId;
    session.roomId = undefined;
    rooms.get(id)?.removePlayer(session.peer.id);
    if (rooms.leave(id, session.peer.id)) {
      rooms.get(id)?.dispose();
      rooms.remove(id);
    }
  };
  const requireRoom = (session: Session): DrawGuessRoom => {
    const room = session.roomId ? rooms.get(session.roomId) : undefined;
    if (!room) throw new Error('请先加入房间');
    return room;
  };
  const handle = (peer: Peer, message: ClientMessage): void => {
    const session = sessions.get(peer.id)!;
    if (message.type === 'create' || message.type === 'join') {
      if (session.roomId) throw new Error('请先离开当前房间');
      let id: string;
      if (message.type === 'create') {
        do {
          id = randomBytes(3).toString('hex').toUpperCase();
        } while (rooms.get(id));
        const room = new DrawGuessRoom(id);
        try {
          rooms.create(id, room);
        } catch (error) {
          room.dispose();
          throw error;
        }
        room.events.on(
          'send',
          ({ playerId, message: outgoing }) => sessions.get(playerId)?.peer.send(outgoing),
          room.engine.scope,
        );
      } else id = message.roomId;
      const room = rooms.join(id, peer.id);
      session.roomId = id;
      room.addPlayer(peer.id, message.name);
      return;
    }
    if (message.type === 'leave') {
      leave(session);
      peer.send({ type: 'left' });
      return;
    }
    const room = requireRoom(session);
    switch (message.type) {
      case 'start':
        room.start(peer.id);
        break;
      case 'next':
        room.next(peer.id);
        break;
      case 'sync':
        room.sync(peer.id);
        break;
      case 'stroke':
      case 'clear':
        if (!session.drawing.allow(Date.now())) throw new Error('绘画操作过于频繁');
        if (message.type === 'stroke') room.draw(peer.id, message.roundId, message.stroke);
        else room.clear(peer.id, message.roundId);
        break;
      case 'guess':
        if (!session.guessing.allow(Date.now())) throw new Error('猜词过于频繁，请稍后再试');
        room.guess(peer.id, message.roundId, message.text);
        break;
    }
  };
  const transport = new WebSocketHost(
    http,
    clientMessageSchema,
    {
      open: (peer) => {
        sessions.set(peer.id, {
          peer,
          roomId: undefined,
          drawing: new RateLimit(40),
          guessing: new RateLimit(5, 5000),
        });
        peer.send({ type: 'welcome', playerId: peer.id, version: PROTOCOL_VERSION });
      },
      message: handle,
      error: (peer, message) => peer.send({ type: 'error', message }),
      close: (peer) => {
        const session = sessions.get(peer.id);
        if (session) leave(session);
        sessions.delete(peer.id);
      },
    },
    options.allowedOrigins,
  );
  let previous = performance.now();
  const interval = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - previous) / 1000;
    previous = now;
    for (const room of rooms.values()) room.engine.advance(elapsed);
  }, 100);
  try {
    await new Promise<void>((resolveListen, reject) => {
      http.once('error', reject);
      http.listen(options.port ?? 3001, options.host ?? '0.0.0.0', () => {
        http.off('error', reject);
        resolveListen();
      });
    });
  } catch (error) {
    clearInterval(interval);
    await transport.close();
    throw error;
  }
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  return {
    port: address.port,
    async close(): Promise<void> {
      clearInterval(interval);
      await transport.close();
      for (const room of rooms.values()) room.dispose();
      await new Promise<void>((resolveClose, reject) =>
        http.close((error) => (error ? reject(error) : resolveClose())),
      );
    },
  };
}
