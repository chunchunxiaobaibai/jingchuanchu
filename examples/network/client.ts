import { Engine } from '@xiaobai/core';
import { networkModule } from '@xiaobai/net/module';
import { serverDecoder, type ClientMessage, type ServerMessage } from './protocol.js';

/** Invoke in your browser application; creating the module does not connect until start. */
export function createPingClient(url: string, onMessage: (message: ServerMessage) => void) {
  const engine = new Engine();
  const network = networkModule<ClientMessage, ServerMessage>({
    url,
    decoder: serverDecoder,
    onMessage,
  });
  engine.install([network]);
  const connection = engine.world.getResource(network.connection);
  engine.start();
  return { engine, connection, ping: () => connection.send({ type: 'ping' }) };
}
