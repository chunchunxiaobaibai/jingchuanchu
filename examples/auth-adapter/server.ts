import { randomBytes, timingSafeEqual } from 'node:crypto';
import { decodeSession, type LoginInput, type User } from './protocol.js';
const cookieName = '__Host-jcc-auth-example';
interface Session {
  readonly id: string;
  readonly csrf: string;
  readonly user: User | null;
  readonly expires: number;
}
/** In-memory test backend, using actual Request/Response protocol without an account database. */
export function createExampleAuthBackend(options: {
  origin: string;
  basePath: string;
  authenticate: (input: LoginInput) => User | null | PromiseLike<User | null>;
  beforeRevoke?: (user: User | null) => void | PromiseLike<void>;
  now?: () => number;
  ttlMs?: number;
}) {
  const origin = new URL(options.origin),
    ttl = options.ttlMs ?? 30 * 60_000;
  if (
    origin.origin !== options.origin ||
    origin.protocol !== 'https:' ||
    !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(options.basePath) ||
    !Number.isSafeInteger(ttl) ||
    ttl < 1000 ||
    typeof options.authenticate !== 'function'
  )
    throw new Error(
      'Configure an HTTPS origin, absolute API path, verifier and positive session lifetime',
    );
  const now = options.now ?? Date.now,
    sessions = new Map<string, Session>();
  let closed = false;
  const cookie = (session?: Session) =>
    `${cookieName}=${session?.id ?? ''}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${session ? Math.floor(ttl / 1000) : 0}`;
  const json = (value: unknown, status: number, setCookie?: string) =>
    Response.json(value, {
      status,
      headers: { 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
    });
  const failure = (status: number, error: string) => json({ error }, status);
  function find(request: Request): Session | undefined {
    const ids = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(cookieName + '='))
      .map((part) => part.slice(cookieName.length + 1));
    if (ids.length !== 1) return undefined;
    const session = sessions.get(ids[0]!);
    if (session && session.expires > now()) return session;
    if (session) sessions.delete(session.id);
    return undefined;
  }
  function create(user: User | null): Session {
    const session: Session = {
      id: randomBytes(32).toString('hex'),
      csrf: randomBytes(32).toString('hex'),
      user,
      expires: now() + ttl,
    };
    sessions.set(session.id, session);
    return session;
  }
  function validCsrf(request: Request, session: Session): boolean {
    const supplied = Buffer.from(request.headers.get('x-csrf-token') ?? ''),
      expected = Buffer.from(session.csrf);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  return Object.freeze({
    async handle(request: Request): Promise<Response> {
      if (closed) return failure(503, 'closed');
      try {
        const url = new URL(request.url);
        if (url.origin !== options.origin || url.search || url.hash)
          return failure(404, 'not-found');
        const route = url.pathname.slice(options.basePath.length);
        if (
          !url.pathname.startsWith(options.basePath + '/') ||
          !['/session', '/login', '/logout', '/reward'].includes(route)
        )
          return failure(404, 'not-found');
        if (route === '/session') {
          if (request.method !== 'GET') return failure(405, 'method');
          const existing = find(request),
            session = existing ?? create(null);
          return json(
            { user: session.user, csrfToken: session.csrf },
            session.user ? 200 : 401,
            cookie(session),
          );
        }
        if (request.method !== 'POST') return failure(405, 'method');
        if (request.headers.get('origin') !== options.origin) return failure(403, 'origin');
        if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
          return failure(415, 'content-type');
        const text = await request.text();
        if (text.length > 8192) return failure(413, 'body-size');
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return failure(400, 'json');
        }
        if (closed || request.signal.aborted) return failure(503, 'cancelled');
        const session = find(request);
        if (!session || (route === '/reward' && !session.user))
          return failure(401, 'unauthenticated');
        if (!validCsrf(request, session)) return failure(403, 'csrf');
        if (route === '/login') {
          if (
            !body ||
            typeof body !== 'object' ||
            !('username' in body) ||
            !('password' in body) ||
            typeof body.username !== 'string' ||
            !body.username.trim() ||
            body.username.length > 256 ||
            typeof body.password !== 'string' ||
            body.password.length > 4096
          )
            return failure(400, 'credentials');
          let user: User | null;
          try {
            user = await options.authenticate({ username: body.username, password: body.password });
          } catch {
            return failure(503, 'verifier-unavailable');
          }
          // An asynchronous verifier must not revive an expired/revoked/cancelled request.
          if (closed || request.signal.aborted || find(request) !== session)
            return failure(401, 'stale-session');
          if (!user) return failure(401, 'credentials');
          const selected = decodeSession({ user, csrfToken: session.csrf }).user!;
          const safeUser = Object.freeze({
            ...selected,
            permissions: Object.freeze([...selected.permissions]),
          });
          sessions.delete(session.id);
          const next = create(safeUser);
          return json({ user: next.user, csrfToken: next.csrf }, 200, cookie(next));
        }
        if (route === '/logout') {
          try {
            await options.beforeRevoke?.(session.user);
          } catch {
            return failure(503, 'revocation-unavailable');
          }
          if (closed || request.signal.aborted) return failure(503, 'cancelled');
          if (find(request) !== session) return failure(401, 'stale-session');
          sessions.delete(session.id);
          return new Response(null, {
            status: 204,
            headers: { 'Cache-Control': 'no-store', 'Set-Cookie': cookie() },
          });
        }
        if (!session.user!.permissions.includes('claim-reward')) return failure(403, 'forbidden');
        return json({ reward: 1 }, 200);
      } catch {
        return failure(500, 'internal');
      }
    },
    dispose() {
      closed = true;
      sessions.clear();
    },
  });
}
