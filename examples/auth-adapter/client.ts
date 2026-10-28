import type { CancellationSignal } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AuthProvider } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { decodeSession, HttpAuthError, type LoginInput, type User } from './protocol.js';

export interface HttpAuthProvider extends AuthProvider<LoginInput, User> {
  claimReward(signal: CancellationSignal): Promise<{ readonly reward: number }>;
}
/** Same-origin cookie session example; supply the application's actual origin and API URL. */
export function createHttpAuthProvider(options: {
  applicationOrigin: string;
  baseURL: string;
  fetch?: typeof globalThis.fetch;
}): HttpAuthProvider {
  const origin = new URL(options.applicationOrigin),
    base = new URL(options.baseURL);
  if (
    origin.origin !== options.applicationOrigin ||
    !['http:', 'https:'].includes(origin.protocol) ||
    base.origin !== origin.origin ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error(
      'Auth API must use the configured application origin without credentials/query/hash',
    );
  const fetchRequest = options.fetch ?? globalThis.fetch;
  if (typeof fetchRequest !== 'function') throw new Error('A fetch implementation is required');
  let csrfToken: string | undefined;
  const endpoint = (path: string) => base.href.replace(/\/$/, '') + '/' + path;

  async function request<T>(
    path: string,
    signal: CancellationSignal,
    body: unknown,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    const controller = new AbortController();
    const off = signal.subscribe(() => controller.abort(signal.reason));
    try {
      const response = await fetchRequest(endpoint(path), {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
        ...(body !== undefined
          ? {
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken! },
              body: JSON.stringify(body),
            }
          : {}),
      });
      signal.throwIfAborted();
      const result = await consume(response);
      signal.throwIfAborted();
      return result;
    } finally {
      off();
    }
  }
  async function readSession(response: Response, signal: CancellationSignal) {
    const decoded = decodeSession(await response.json());
    signal.throwIfAborted();
    if (response.status === 401 && decoded.user !== null)
      throw new Error('An expired session cannot contain an authenticated identity');
    csrfToken = decoded.csrfToken;
    return decoded;
  }
  async function restore(signal: CancellationSignal) {
    return request('session', signal, undefined, async (response) => {
      // Only a validated 401 anonymous response means an expired/missing session.
      if (response.status !== 200 && response.status !== 401)
        throw new HttpAuthError(response.status, 'restore');
      return readSession(response, signal);
    });
  }

  async function ensureCsrf(signal: CancellationSignal) {
    if (!csrfToken) await restore(signal);
  }
  return Object.freeze({
    restore,
    async login(input: LoginInput, signal: CancellationSignal) {
      await ensureCsrf(signal);
      signal.throwIfAborted();
      return request(
        'login',
        signal,
        { username: input.username, password: input.password },
        async (response) => {
          if (response.status !== 200) throw new HttpAuthError(response.status, 'login');
          const decoded = await readSession(response, signal);
          if (!decoded.user) throw new Error('Successful login requires a confirmed user');
          return decoded;
        },
      );
    },
    async logout(signal: CancellationSignal) {
      await ensureCsrf(signal);
      await request('logout', signal, {}, async (response) => {
        if (response.status !== 204) throw new HttpAuthError(response.status, 'logout');
      });
      signal.throwIfAborted();
      csrfToken = undefined;
    },
    decode(value: unknown) {
      const { user } = decodeSession(value);
      return user ? { status: 'authenticated' as const, user } : { status: 'anonymous' as const };
    },
    async claimReward(signal: CancellationSignal) {
      await ensureCsrf(signal);
      return request('reward', signal, {}, async (response) => {
        if (response.status !== 200) throw new HttpAuthError(response.status, 'reward');
        const value: unknown = await response.json();
        signal.throwIfAborted();
        if (
          !value ||
          typeof value !== 'object' ||
          !('reward' in value) ||
          typeof value.reward !== 'number' ||
          !Number.isFinite(value.reward)
        )
          throw new Error('Invalid reward response');
        return { reward: value.reward };
      });
    },
  });
}
