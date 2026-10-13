import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DrawGuessRoom } from '../games/draw-guess/room.js';
import { clientMessageSchema, serverMessageSchema } from '../games/draw-guess/protocol.js';

test('secret isolation, drawing permission, single scoring and turn rotation', () => {
  const room = new DrawGuessRoom('ABC123', { chooseWord: () => '苹果' });
  room.addPlayer('a', '甲'); room.addPlayer('b', '乙'); room.addPlayer('c', '丙');
  assert.throws(() => room.start('b')); room.start('a');
  const state = room.snapshot('b'); assert.equal(state.word, null); assert.equal(room.snapshot('a').word, '苹果');
  serverMessageSchema.parse({ type: 'snapshot', state });
  const stroke = { points: [{ x: 20, y: 20 }], color: '#202c37' as const, width: 4 };
  assert.throws(() => room.draw('b', state.roundId, stroke)); assert.throws(() => room.draw('a', state.roundId - 1, stroke));
  room.draw('a', state.roundId, stroke); assert.equal(room.snapshot('c').strokes.length, 1);
  room.guess('b', state.roundId, '苹果'); assert.throws(() => room.guess('b', state.roundId, '苹果'));
  assert.equal(room.snapshot('c').word, null); assert.equal(room.snapshot('c').messages[0]?.text, '猜对了！');
  room.guess('c', state.roundId, '苹果'); assert.equal(room.snapshot('c').phase, 'reveal');
  assert.deepEqual(room.snapshot('c').players.map(p => p.score), [50, 100, 80]);
  room.next('a'); assert.equal(room.snapshot('b').drawerId, 'b'); assert.equal(room.snapshot('b').strokes.length, 0); room.dispose();
});

test('timeout, host transfer, drawer departure, finished and restart', () => {
  let now = 0; const room = new DrawGuessRoom('ABC123', { clock: () => now, chooseWord: () => '太阳', durationMs: 1000 });
  room.addPlayer('a', '甲'); room.addPlayer('b', '乙'); room.addPlayer('c', '丙'); room.start('a');
  now = 1001; room.engine.advance(0.1); assert.equal(room.snapshot('b').phase, 'reveal');
  room.next('a'); room.removePlayer('b'); assert.equal(room.snapshot('c').phase, 'reveal');
  room.removePlayer('a'); assert.equal(room.snapshot('c').hostId, 'c'); assert.equal(room.snapshot('c').phase, 'lobby');
  room.addPlayer('d', '丁'); room.start('c'); room.guess('d', room.snapshot('d').roundId, '太阳'); room.next('c');
  room.guess('c', room.snapshot('c').roundId, '太阳'); room.next('c'); assert.equal(room.snapshot('c').phase, 'finished');
  room.start('c'); assert.equal(room.snapshot('c').players.every(p => p.score === 0), true); room.dispose();
});

test('capacity, late-join drawing snapshot and malformed protocol rejection', () => {
  const room = new DrawGuessRoom('ABC123'); room.addPlayer('0', '房主'); room.addPlayer('1', '玩家'); room.start('0');
  room.draw('0', room.snapshot('0').roundId, { color: '#202c37', width: 5, points: [{ x: 1, y: 2 }] });
  for (let i = 2; i < 10; i++) room.addPlayer(String(i), `玩家${i}`);
  assert.equal(room.snapshot('9').strokes.length, 1); assert.equal(room.snapshot('9').word, null); assert.throws(() => room.addPlayer('10', '超员'));
  assert.equal(clientMessageSchema.safeParse({ type: 'stroke', roundId: 1, stroke: { color: 'red', width: 5, points: [{ x: Infinity, y: 2 }] } }).success, false);
  assert.equal(clientMessageSchema.safeParse({ type: 'start', word: '作弊' }).success, false);
  room.dispose();
});
