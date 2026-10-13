import { Engine, EventBus } from '@xiaobaibaifqy/jingchuanchu-core';
import { component, resource, type Entity } from '@xiaobaibaifqy/jingchuanchu-ecs';
import type { RoomSnapshot, ServerMessage, Stroke } from './protocol.js';

export const Player = component<{ id: string; name: string }>('Player');
export const Score = component<{ value: number }>('Score');
export const Guessed = component<boolean>('Guessed');
interface RoundState {
  phase: RoomSnapshot['phase'];
  hostId: string;
  drawerId: string | null;
  roundId: number;
  turn: number;
  order: string[];
  endsAt: number;
  word: string;
  revision: number;
}
export const Round = resource<RoundState>('Round');
const WORDS = [
  '苹果',
  '雨伞',
  '自行车',
  '小猫',
  '太阳',
  '冰淇淋',
  '火箭',
  '西瓜',
  '雪人',
  '眼镜',
  '大象',
  '月亮',
];

/** Game owns rules; engine owns entities, execution and lifetime. No socket or DOM imports. */
export class DrawGuessRoom {
  readonly engine = new Engine({ tickRate: 10 });
  readonly events = new EventBus<{ send: { playerId: string; message: ServerMessage } }>();
  private readonly players = new Map<string, Entity>();
  private strokes: Stroke[] = [];
  private points = 0;
  private messages: RoomSnapshot['messages'] = [];
  private messageId = 0;
  private readonly clock: () => number;
  private readonly chooseWord: () => string;
  private readonly duration: number;
  constructor(
    readonly id: string,
    options: { clock?: () => number; chooseWord?: () => string; durationMs?: number } = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.chooseWord =
      options.chooseWord ?? (() => WORDS[Math.floor(Math.random() * WORDS.length)]!);
    this.duration = options.durationMs ?? 60_000;
    this.engine.install([
      {
        id: 'draw-guess',
        setup: (engine, scope) => {
          engine.provide(
            Round,
            {
              phase: 'lobby',
              hostId: '',
              drawerId: null,
              roundId: 0,
              turn: -1,
              order: [],
              endsAt: 0,
              word: '',
              revision: 0,
            },
            scope,
          );
          engine.addSystem(
            {
              id: 'round-timeout',
              update: () => {
                if (this.round.phase === 'drawing' && this.clock() >= this.round.endsAt)
                  this.reveal();
              },
            },
            scope,
          );
          scope.own(() => this.events.clear());
        },
      },
    ]);
    this.engine.start();
  }
  get size(): number {
    return this.players.size;
  }
  private get round(): RoundState {
    return this.engine.world.getResource(Round);
  }
  addPlayer(id: string, name: string): void {
    if (this.players.has(id)) throw new Error('已经加入房间');
    if (this.size >= 10) throw new Error('房间已满（最多 10 人）');
    const entity = this.engine.world.create();
    this.players.set(id, entity);
    this.engine.world.set(entity, Player, { id, name });
    this.engine.world.set(entity, Score, { value: 0 });
    this.engine.world.set(entity, Guessed, false);
    if (!this.round.hostId) this.round.hostId = id;
    this.publish();
  }
  removePlayer(id: string): void {
    const entity = this.players.get(id);
    if (!entity) return;
    this.players.delete(id);
    this.engine.world.destroy(entity);
    if (this.round.hostId === id) this.round.hostId = this.players.keys().next().value ?? '';
    if (this.size < 2) {
      this.round.phase = 'lobby';
      this.round.drawerId = null;
      this.round.word = '';
      this.round.endsAt = 0;
      this.round.order = [];
      this.round.turn = -1;
      this.resetDrawing();
      for (const remaining of this.players.values())
        this.engine.world.set(remaining, Guessed, false);
    } else if (
      this.round.phase === 'drawing' &&
      (this.round.drawerId === id || this.allGuessed())
    ) {
      this.reveal();
      return;
    }
    this.publish();
  }
  start(id: string): void {
    this.assertHost(id);
    if (!['lobby', 'finished'].includes(this.round.phase)) throw new Error('游戏已经开始');
    if (this.size < 2) throw new Error('至少需要 2 位玩家');
    this.round.order = [...this.players.keys()];
    this.round.turn = -1;
    for (const entity of this.players.values()) this.engine.world.require(entity, Score).value = 0;
    this.messages = [];
    this.beginNext();
  }
  next(id: string): void {
    this.assertHost(id);
    if (this.round.phase !== 'reveal') throw new Error('当前回合尚未结束');
    this.beginNext();
  }
  draw(id: string, roundId: number, stroke: Stroke): void {
    this.assertDrawing(id, roundId);
    if (this.strokes.length >= 2000 || this.points + stroke.points.length > 20_000)
      throw new Error('画布笔画已达上限，请清空画布');
    this.strokes.push(stroke);
    this.points += stroke.points.length;
    this.round.revision++;
    const message: ServerMessage = {
      type: 'stroke',
      revision: this.round.revision,
      roundId,
      stroke,
    };
    for (const playerId of this.players.keys()) this.events.emit('send', { playerId, message });
  }
  clear(id: string, roundId: number): void {
    this.assertDrawing(id, roundId);
    this.resetDrawing();
    this.publish();
  }
  guess(id: string, roundId: number, text: string): void {
    this.assertRound(roundId);
    const entity = this.requirePlayer(id);
    if (id === this.round.drawerId) throw new Error('绘画者不能猜词');
    if (this.engine.world.require(entity, Guessed)) throw new Error('你已经猜对了');
    const correct =
      text.trim().normalize('NFKC').toLocaleLowerCase() ===
      this.round.word.normalize('NFKC').toLocaleLowerCase();
    if (correct) {
      const guessedCount = [...this.players.values()].filter((e) =>
        this.engine.world.require(e, Guessed),
      ).length;
      this.engine.world.require(entity, Score).value += Math.max(40, 100 - guessedCount * 20);
      this.engine.world.set(entity, Guessed, true);
      const drawer = this.players.get(this.round.drawerId!);
      if (drawer) this.engine.world.require(drawer, Score).value += 25;
    }
    this.messages.push({
      id: ++this.messageId,
      name: this.engine.world.require(entity, Player).name,
      text: correct ? '猜对了！' : text,
      correct,
    });
    this.messages = this.messages.slice(-50);
    if (this.allGuessed()) this.reveal();
    else this.publish();
  }
  sync(id: string): void {
    this.requirePlayer(id);
    this.events.emit('send', {
      playerId: id,
      message: { type: 'snapshot', state: this.snapshot(id) },
    });
  }
  snapshot(viewer: string): RoomSnapshot {
    const round = this.round;
    return {
      roomId: this.id,
      revision: round.revision,
      phase: round.phase,
      hostId: round.hostId,
      drawerId: round.drawerId,
      roundId: round.roundId,
      round: Math.max(0, round.turn + 1),
      totalRounds: round.order.length,
      endsAt: round.endsAt,
      serverTime: this.clock(),
      hint: round.word ? `${[...round.word].length} 个字` : '',
      word:
        round.phase === 'reveal' || round.phase === 'finished' || viewer === round.drawerId
          ? round.word || null
          : null,
      players: [...this.engine.world.query(Player, Score, Guessed)].map((entity) => ({
        ...this.engine.world.require(entity, Player),
        score: this.engine.world.require(entity, Score).value,
        guessed: this.engine.world.require(entity, Guessed),
      })),
      strokes: this.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      })),
      messages: this.messages.map((message) => ({ ...message })),
    };
  }
  dispose(): void {
    this.engine.dispose();
  }
  private beginNext(): void {
    do {
      this.round.turn++;
    } while (
      this.round.turn < this.round.order.length &&
      !this.players.has(this.round.order[this.round.turn]!)
    );
    if (this.round.turn >= this.round.order.length) {
      this.round.turn = this.round.order.length - 1;
      this.round.phase = 'finished';
      this.publish();
      return;
    }
    this.round.drawerId = this.round.order[this.round.turn]!;
    this.round.roundId++;
    this.round.word = this.chooseWord();
    this.round.endsAt = this.clock() + this.duration;
    this.round.phase = 'drawing';
    this.resetDrawing();
    this.messages = [];
    for (const entity of this.players.values()) this.engine.world.set(entity, Guessed, false);
    this.publish();
  }
  private reveal(): void {
    this.round.phase = 'reveal';
    this.round.endsAt = 0;
    this.publish();
  }
  private publish(): void {
    this.round.revision++;
    for (const playerId of this.players.keys()) this.sync(playerId);
  }
  private resetDrawing(): void {
    this.strokes = [];
    this.points = 0;
  }
  private allGuessed(): boolean {
    const guessers = [...this.players.entries()].filter(([id]) => id !== this.round.drawerId);
    return (
      guessers.length > 0 &&
      guessers.every(([, entity]) => this.engine.world.require(entity, Guessed))
    );
  }
  private requirePlayer(id: string): Entity {
    const entity = this.players.get(id);
    if (!entity) throw new Error('玩家不在房间内');
    return entity;
  }
  private assertHost(id: string): void {
    this.requirePlayer(id);
    if (this.round.hostId !== id) throw new Error('仅房主可以操作');
  }
  private assertRound(id: number): void {
    if (this.round.phase === 'drawing' && this.clock() >= this.round.endsAt) this.reveal();
    if (this.round.phase !== 'drawing' || this.round.roundId !== id)
      throw new Error('回合已结束或指令已过期');
  }
  private assertDrawing(id: string, roundId: number): void {
    this.assertRound(roundId);
    this.requirePlayer(id);
    if (this.round.drawerId !== id) throw new Error('只有绘画者可以修改画布');
  }
}
