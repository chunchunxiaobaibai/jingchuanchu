import type { AccessService, AccessPolicy } from '@xiaobaibaifqy/jingchuanchu-app/application';
type User = { id: string; permissions: ('play' | 'edit')[] };
function contract(access: AccessService<'play' | 'edit', User>) {
  access.can('public');
  access.can({ session: 'required', all: ['play'], any: ['edit'] });
  // @ts-expect-error unknown permission keys are not accepted
  access.can({ session: 'required', all: ['admin'] });
  // @ts-expect-error missing session strategy is not accepted
  access.can({ all: ['play'] });
  const policy: AccessPolicy<'play'> = { session: 'required', all: ['play'] };
  // @ts-expect-error policy fields are readonly
  policy.session = 'optional';
}
void contract;
