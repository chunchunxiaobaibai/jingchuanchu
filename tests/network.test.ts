import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../apps/server/service.js';
import { serverMessageSchema, type ServerMessage, type ClientMessage } from '../games/draw-guess/protocol.js';
import { RateLimit, RoomDirectory } from '../packages/net/index.js';

async function client(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = []; const waiters = new Set<() => void>();
  socket.on('message', data => { messages.push(serverMessageSchema.parse(JSON.parse(data.toString()))); for (const notify of waiters) notify(); });
  const wait = (predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Message timeout')); }, 3000);
    const check = (): void => { const index = messages.findIndex(predicate); if (index < 0) return; const message = messages.splice(index, 1)[0]!; clearTimeout(timer); waiters.delete(check); resolve(message); };
    waiters.add(check); check();
  });
  const welcome = await wait(message => message.type === 'welcome');
  assert.equal(welcome.type, 'welcome'); if (welcome.type !== 'welcome') throw new Error('Missing welcome');
  return { socket, id: welcome.playerId, send: (message: ClientMessage) => socket.send(JSON.stringify(message)), wait };
}

test('real WebSocket clients create, join, draw, guess and restore snapshots', async t => {
  const server = await createGameServer({ port: 0, host: '127.0.0.1' }); t.after(() => server.close());
  const a = await client(server.port); const b = await client(server.port);
  a.send({ type: 'create', name: '甲' });
  const created = await a.wait(m => m.type === 'snapshot'); if (created.type !== 'snapshot') throw new Error('Missing state');
  b.send({ type: 'join', name: '乙', roomId: created.state.roomId }); await b.wait(m => m.type === 'snapshot' && m.state.players.length === 2);
  b.send({ type: 'start' }); await b.wait(m => m.type === 'error' && m.message.includes('房主'));
  a.send({ type: 'start' });
  const drawing = await a.wait(m => m.type === 'snapshot' && m.state.phase === 'drawing'); if (drawing.type !== 'snapshot') throw new Error('Missing drawing state');
  const guessing = await b.wait(m => m.type === 'snapshot' && m.state.phase === 'drawing'); assert.equal(guessing.type === 'snapshot' && guessing.state.word, null);
  const stroke = { points: [{ x: 100, y: 100 }, { x: 200, y: 200 }], color: '#202c37' as const, width: 4 };
  b.send({ type: 'stroke', roundId: drawing.state.roundId, stroke }); await b.wait(m => m.type === 'error' && m.message.includes('绘画者'));
  a.send({ type: 'stroke', roundId: drawing.state.roundId, stroke }); const received = await b.wait(m => m.type === 'stroke'); assert.equal(received.type === 'stroke' && received.stroke.points.length, 2);
  const c = await client(server.port); c.send({ type: 'join', roomId: created.state.roomId, name: '丙' });
  const restored = await c.wait(m => m.type === 'snapshot'); assert.equal(restored.type === 'snapshot' && restored.state.strokes.length, 1);
  b.send({ type: 'guess', roundId: drawing.state.roundId, text: drawing.state.word! });
  const correct = await c.wait(m => m.type === 'snapshot' && m.state.players.some(p => p.id === b.id && p.guessed));
  assert.equal(correct.type === 'snapshot' && correct.state.word, null);
  c.send({ type: 'guess', roundId: drawing.state.roundId, text: drawing.state.word! });
  await a.wait(m => m.type === 'snapshot' && m.state.phase === 'reveal');
  a.socket.close(); await b.wait(m => m.type === 'snapshot' && m.state.hostId === b.id);
  b.send({ type: 'next' }); await c.wait(m => m.type === 'snapshot' && m.state.phase === 'drawing' && m.state.drawerId === b.id);
  c.socket.send('{bad json'); await c.wait(m => m.type === 'error' && m.message === '消息格式无效');
});

test('actual room refuses eleventh player without evicting members', async t => {
  const server = await createGameServer({ port: 0, host: '127.0.0.1' }); t.after(() => server.close());
  const host = await client(server.port); host.send({ type: 'create', name: '房主' });
  const created = await host.wait(m => m.type === 'snapshot'); if (created.type !== 'snapshot') throw new Error('Missing state');
  for (let i = 1; i < 10; i++) { const peer = await client(server.port); peer.send({ type: 'join', name: `玩家${i}`, roomId: created.state.roomId }); await peer.wait(m => m.type === 'snapshot'); }
  const extra = await client(server.port); extra.send({ type: 'join', name: '多余', roomId: created.state.roomId });
  await extra.wait(m => m.type === 'error' && m.message.includes('房间已满'));
  host.send({ type: 'sync' }); await host.wait(m => m.type === 'snapshot' && m.state.players.length === 10);
});

test('room registry and rate limits enforce reusable transport boundaries', () => {
  const directory = new RoomDirectory<number>(2, 1); directory.create('a', 42);
  assert.equal(directory.join('a', '1'), 42); directory.join('a', '2'); assert.throws(() => directory.join('a', '3'));
  assert.throws(() => directory.create('b', 43)); assert.equal(directory.leave('a', '1'), false); assert.equal(directory.leave('a', '2'), true);
  directory.remove('a'); assert.equal(directory.size, 0);
  const limit = new RateLimit(2); assert.equal(limit.allow(1000), true); assert.equal(limit.allow(1001), true); assert.equal(limit.allow(1002), false); assert.equal(limit.allow(2000), true);
});
