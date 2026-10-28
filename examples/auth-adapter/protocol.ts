/** Example-only protocol. A real application owns its identity and permissions contract. */
export const permissions = ['play', 'claim-reward'] as const;
export type Permission = (typeof permissions)[number];
export interface LoginInput {
  readonly username: string;
  readonly password: string;
}
export interface User {
  readonly id: string;
  readonly displayName: string;
  readonly permissions: readonly Permission[];
}
export interface SessionResponse {
  readonly user: User | null;
  readonly csrfToken: string;
}
export function decodeSession(value: unknown): SessionResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid session response');
  const response = value as Record<string, unknown>;
  if (typeof response.csrfToken !== 'string' || !response.csrfToken.trim())
    throw new Error('Session response requires a CSRF token');
  if (response.user === null) return { user: null, csrfToken: response.csrfToken };
  if (!response.user || typeof response.user !== 'object') throw new Error('Invalid user');
  const user = response.user as Record<string, unknown>;
  if (
    typeof user.id !== 'string' ||
    !user.id.trim() ||
    typeof user.displayName !== 'string' ||
    !Array.isArray(user.permissions) ||
    user.permissions.some((key: unknown) => !permissions.includes(key as Permission))
  )
    throw new Error('Invalid display identity');
  // Select only display fields; never forward arbitrary response fields into the session.
  return {
    csrfToken: response.csrfToken,
    user: { id: user.id, displayName: user.displayName, permissions: [...user.permissions] },
  };
}
export class HttpAuthError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`Auth adapter ${operation} returned HTTP ${status}`);
    this.name = 'HttpAuthError';
  }
}
