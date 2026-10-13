import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const COLORS = ['#202c37', '#d94b45', '#e6a323', '#318465', '#3477bf', '#8d5bb5'] as const;
export const pointSchema = z
  .object({ x: z.number().finite().min(0).max(960), y: z.number().finite().min(0).max(600) })
  .strict();
export const strokeSchema = z
  .object({
    points: z.array(pointSchema).min(1).max(64),
    color: z.enum(COLORS),
    width: z.number().min(1).max(24),
  })
  .strict();
const roundId = z.number().int().nonnegative();
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), name: z.string().trim().min(1).max(16) }).strict(),
  z
    .object({
      type: z.literal('join'),
      roomId: z.string().regex(/^[A-Z0-9]{6}$/),
      name: z.string().trim().min(1).max(16),
    })
    .strict(),
  z.object({ type: z.literal('leave') }).strict(),
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('next') }).strict(),
  z.object({ type: z.literal('sync') }).strict(),
  z.object({ type: z.literal('stroke'), roundId, stroke: strokeSchema }).strict(),
  z.object({ type: z.literal('clear'), roundId }).strict(),
  z.object({ type: z.literal('guess'), roundId, text: z.string().trim().min(1).max(80) }).strict(),
]);
export const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number(),
  guessed: z.boolean(),
});
export const chatSchema = z.object({
  id: z.number(),
  name: z.string(),
  text: z.string(),
  correct: z.boolean(),
});
export const snapshotSchema = z.object({
  roomId: z.string(),
  revision: z.number().int(),
  phase: z.enum(['lobby', 'drawing', 'reveal', 'finished']),
  hostId: z.string(),
  drawerId: z.string().nullable(),
  roundId,
  round: z.number(),
  totalRounds: z.number(),
  endsAt: z.number(),
  serverTime: z.number(),
  hint: z.string(),
  word: z.string().nullable(),
  players: z.array(playerSchema).max(10),
  strokes: z.array(strokeSchema).max(2000),
  messages: z.array(chatSchema).max(50),
});
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    playerId: z.string(),
    version: z.literal(PROTOCOL_VERSION),
  }),
  z.object({ type: z.literal('snapshot'), state: snapshotSchema }),
  z.object({
    type: z.literal('stroke'),
    revision: z.number().int(),
    roundId,
    stroke: strokeSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('left') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type RoomSnapshot = z.infer<typeof snapshotSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
