import type { Decoder } from '@xiaobai/net';

export type ClientMessage = { type: 'ping' };
export type ServerMessage =
  { type: 'pong'; serverTime: number } | { type: 'error'; message: string };
export const clientDecoder: Decoder<ClientMessage> = {
  parse(value) {
    if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'ping')
      throw new Error('Invalid client message');
    return { type: 'ping' };
  },
};
export const serverDecoder: Decoder<ServerMessage> = {
  parse(value) {
    if (typeof value !== 'object' || value === null || !('type' in value))
      throw new Error('Invalid server message');
    if (
      value.type === 'pong' &&
      'serverTime' in value &&
      typeof value.serverTime === 'number' &&
      Number.isFinite(value.serverTime)
    )
      return { type: 'pong', serverTime: value.serverTime };
    if (value.type === 'error' && 'message' in value && typeof value.message === 'string')
      return { type: 'error', message: value.message };
    throw new Error('Invalid server message');
  },
};
