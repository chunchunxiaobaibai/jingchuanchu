import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  defineService,
  provideService,
  defineStore,
  defineComponent,
  mountComponent,
  signal,
  ServiceError,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { ComponentOwner } from '../packages/app/runtime/component-owner.js';
import { ServiceRegistry } from '../packages/app/runtime/services.js';
import { StoreRegistry } from '../packages/app/runtime/store.js';

test('services are lazy, cached by provider owner, identity-based and inherited with explicit overrides', () => {
  let factories = 0;
  const closed: string[] = [];
  const Settings = defineService({
    name: 'settings',
    factory(context) {
      factories++;
      context.own(() => {
        closed.push('root');
      });
      return { theme: 'root' };
    },
  });
  const SameName = defineService({
    name: 'settings',
    factory() {
      return { theme: 'different-definition' };
    },
  });
  const Consumer = defineService({
    name: 'consumer',
    factory(context) {
      return context.useService(Settings);
    },
  });
  const registry = new ServiceRegistry([
      provideService(Settings),
      provideService(SameName),
      provideService(Consumer),
    ]),
    one = new ComponentOwner(undefined, { services: registry }),
    two = new ComponentOwner(undefined, { services: registry });
  const child = new ComponentOwner(one),
    privatePage = new ComponentOwner(one, {
      services: new ServiceRegistry([
        provideService(Settings, (context) => {
          context.own(() => {
            closed.push('page');
          });
          return { theme: 'page' };
        }),
      ]),
    });
  assert.equal(factories, 0);
  const shared = child.resolve('services', Settings);
  assert.equal(one.resolve('services', Settings), shared);
  assert.equal(factories, 1);
  assert.notEqual(two.resolve('services', Settings), shared);
  assert.equal(factories, 2);
  assert.equal(privatePage.resolve('services', Settings).theme, 'page');
  assert.equal(privatePage.resolve('services', Consumer), shared);
  assert.equal(one.resolve('services', SameName).theme, 'different-definition');
  privatePage.dispose();
  assert.deepEqual(closed, ['page']);
  assert.equal(child.resolve('services', Settings), shared);
  one.dispose();
  two.dispose();
  assert.deepEqual(closed, ['page', 'root', 'root']);
});

test('component and store cleanup precedes service disposal, and dependants dispose before dependencies', () => {
  const calls: string[] = [];
  const Connection = defineService({
    name: 'connection',
    factory(context) {
      let closed = false;
      context.own(() => {
        closed = true;
        calls.push('connection');
      });
      return { check: () => assert.equal(closed, false) };
    },
  });
  const Client = defineService({
    name: 'client',
    factory(context) {
      const connection = context.useService(Connection);
      context.own(() => {
        connection.check();
        calls.push('client');
      });
      return connection;
    },
  });
  const Game = defineStore({
    name: 'game',
    setup(context) {
      const client = context.useService(Client),
        count = signal(1);
      context.own(() => {
        client.check();
        calls.push('store');
      });
      return { state: { count }, getters: {}, actions: { check: () => client.check() } };
    },
  });
  const View = defineComponent({
    selector: 'service-view',
    $template: '<span>view</span>',
    setup(context) {
      return { game: context.useStore(Game), client: context.useService(Client) };
    },
    onDestroy(context) {
      context.exposed.client.check();
      context.exposed.game.actions.check();
      calls.push('view');
    },
  });
  const owner = new ComponentOwner(undefined, {
    services: new ServiceRegistry([provideService(Connection), provideService(Client)]),
    stores: new StoreRegistry([], { automatic: true }),
  });
  const window = new Window(),
    host = window.document.createElement('div') as unknown as HTMLElement;
  mountComponent(host, View, { owner });
  owner.dispose();
  assert.deepEqual(calls, ['view', 'store', 'client', 'connection']);
  assert.equal(host.childNodes.length, 0);
  owner.dispose();
});

test('failed and cyclic factories dispose candidates and the registry can retry without stale entries', () => {
  const empty = () => ({ ready: true });
  const A = defineService({
    name: 'alpha',
    factory(context): ReturnType<typeof empty> {
      context.useService(B);
      return empty();
    },
  });
  const B = defineService({
    name: 'beta',
    factory(context): ReturnType<typeof empty> {
      context.useService(A);
      return empty();
    },
  });
  let attempts = 0,
    cleanups = 0,
    signal: import('@xiaobaibaifqy/jingchuanchu-core').CancellationSignal | undefined;
  const Retry = defineService({
    name: 'retry',
    factory(context) {
      signal = context.signal;
      context.own(() => {
        cleanups++;
      });
      if (++attempts === 1) throw new Error('unavailable');
      return { ready: true };
    },
  });
  const owner = new ComponentOwner(undefined, {
    services: new ServiceRegistry([provideService(A), provideService(B), provideService(Retry)]),
  });
  assert.throws(() => owner.resolve('services', A), /alpha -> beta -> alpha/);
  assert.equal(owner.children.size, 0);
  assert.throws(() => owner.resolve('services', Retry), /Service retry.*factory.*unavailable/);
  assert.equal(cleanups, 1);
  assert.equal(signal!.aborted, true);
  assert.equal(owner.resolve('services', Retry).ready, true);
  assert.equal(attempts, 2);
  owner.dispose();
  assert.equal(cleanups, 2);
  assert.equal(signal!.aborted, true);
});

test('missing/disposed owner lookups and duplicate providers identify the requested service', () => {
  const Config = defineService({ name: 'config', factory: () => ({ value: 1 }) }),
    owner = new ComponentOwner();
  assert.throws(() => owner.resolve('services', Config), /Missing service: config/);
  assert.throws(
    () => new ServiceRegistry([provideService(Config), provideService(Config)]),
    (error) =>
      error instanceof ServiceError && error.source === 'config' && error.operation === 'provide',
  );
  owner.dispose();
  assert.throws(() => owner.resolve('services', Config), /service config.*disposed/);
});

test('factory cleanup errors preserve the original failure and do not block remaining cleanup', () => {
  const original = new Error('factory failed');
  let cleaned = false;
  const Broken = defineService({
    name: 'broken',
    factory(context) {
      context.own(() => {
        cleaned = true;
      });
      context.own(() => {
        throw new Error('cleanup failed');
      });
      throw original;
    },
  });
  const owner = new ComponentOwner(undefined, {
    services: new ServiceRegistry([provideService(Broken)]),
  });
  assert.throws(
    () => owner.resolve('services', Broken),
    (error) =>
      error instanceof ServiceError &&
      error.source === 'broken' &&
      error.cause instanceof AggregateError &&
      error.cause.errors[0] === original,
  );
  assert.equal(cleaned, true);
  assert.equal(owner.children.size, 0);
  owner.dispose();
});

test('normal disposal reports the failing service source and still releases other providers', () => {
  let healthyClosed = false;
  const Good = defineService({
    name: 'healthy',
    factory(context) {
      context.own(() => {
        healthyClosed = true;
      });
      return {};
    },
  });
  const Bad = defineService({
    name: 'bad-exit',
    factory(context) {
      context.own(() => {
        throw new Error('close failed');
      });
      return {};
    },
  });
  const owner = new ComponentOwner(undefined, {
    services: new ServiceRegistry([provideService(Good), provideService(Bad)]),
  });
  owner.resolve('services', Good);
  owner.resolve('services', Bad);
  const flatten = (error: unknown): unknown[] => [
    error,
    ...(error instanceof AggregateError ? error.errors.flatMap(flatten) : []),
    ...(error instanceof Error && error.cause !== undefined ? flatten(error.cause) : []),
  ];
  assert.throws(
    () => owner.dispose(),
    (error) =>
      flatten(error).some(
        (value) =>
          value instanceof ServiceError &&
          value.source === 'bad-exit' &&
          value.operation === 'dispose',
      ),
  );
  assert.equal(healthyClosed, true);
  owner.dispose();
});
