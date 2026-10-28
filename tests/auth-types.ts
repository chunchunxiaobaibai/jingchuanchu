import type { AuthService } from '@xiaobaibaifqy/jingchuanchu-app/application';
type Login = { username: string; password: string };
type User = { id: string; name: string };
function contract(auth: AuthService<Login, User>) {
  void auth.login({ username: 'user', password: 'input-only' });
  // @ts-expect-error login preserves the Provider input contract
  void auth.login('user');
  const current = auth.session();
  if (current.status === 'authenticated') {
    const name: string = current.user.name;
    void name;
    // @ts-expect-error credentials are not part of the declared display identity
    current.user.password;
    // @ts-expect-error session identity is readonly
    current.user.id = 'other';
  }
  // @ts-expect-error the session signal is readonly
  auth.session.set({ status: 'anonymous' });
}
void contract;
