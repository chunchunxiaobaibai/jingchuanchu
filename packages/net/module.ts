import type { EngineModule } from '@xiaobaibaifqy/jingchuanchu-core';
import { resource, type Token } from '@xiaobaibaifqy/jingchuanchu-ecs';
import { BrowserConnection, type Decoder, type ConnectionOptions } from './index.js';

export interface NetworkModule<Client, Server> extends EngineModule {
  readonly connection: Token<BrowserConnection<Client, Server>>;
}
export function networkModule<Client, Server>(
  options: {
    id?: string;
    url: string | (() => string);
    decoder: Decoder<Server>;
    onMessage(message: Server): void;
    onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
  } & ConnectionOptions,
): NetworkModule<Client, Server> {
  const id = options.id ?? 'network';
  const connection = resource<BrowserConnection<Client, Server>>(`${id}:connection`);
  return {
    id,
    connection,
    setup(engine, scope) {
      const instance = new BrowserConnection<Client, Server>(
        options.decoder,
        options.onMessage,
        options.onStatus ?? (() => {}),
        options,
      );
      engine.provide(connection, instance, scope);
      scope.own(() => instance.close());
      const connect = (): void =>
        instance.connect(typeof options.url === 'function' ? options.url() : options.url);
      engine.events.on('started', connect, scope);
      engine.events.on(
        'resumed',
        () => {
          if (instance.status === 'idle') connect();
        },
        scope,
      );
      engine.events.on('stopped', () => instance.close(), scope);
    },
  };
}
