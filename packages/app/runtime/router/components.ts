import { defineComponent, input, output } from '../component.js';
import { computed } from '../reactivity.js';
import { getComponentMount } from '../component-runtime.js';
import { registerRouteOutlet } from './outlets.js';
import type { RouteTarget, NavigationResult } from './types.js';

/** Register explicitly in a root/layout's components before using <router-outlet>. */
export const RouterOutlet = defineComponent({
  selector: 'router-outlet',
  $template: '',
  onMount(context) {
    const mount = getComponentMount(context.scope);
    if (!mount) throw new Error('RouterOutlet is not mounted');
    context.own(registerRouteOutlet({ host: mount.host, owner: mount.owner }));
  },
});

export const RouteLink = defineComponent({
  selector: 'route-link',
  inputs: {
    to: input<RouteTarget>({ required: true }),
    replace: input<boolean>({ default: false }),
    target: input<string>({ default: '_self' }),
    download: input<string | null>({ default: null }),
  },
  outputs: { navigated: output<NavigationResult>() },
  $template: '<a ref="link"><slot></slot></a>',
  $bindings: [
    {
      path: [0],
      kind: 'property',
      name: 'href',
      source: 'RouteLink:href',
      evaluate: (scope) => scope.href,
    },
    {
      path: [0],
      kind: 'property',
      name: 'target',
      source: 'RouteLink:target',
      evaluate: (scope) => scope.target,
    },
    {
      path: [0],
      kind: 'property',
      name: 'aria-current',
      source: 'RouteLink:current',
      evaluate: (scope) => scope.current,
    },
    {
      path: [0, 0],
      kind: 'slot',
      name: 'default',
      source: 'RouteLink:slot',
      evaluate: () => true,
      view: { html: '', bindings: [] },
    },
  ],
  setup(context) {
    const router = context.router;
    return {
      href: computed(() => router.href(context.inputs.to() as RouteTarget)),
      target: context.inputs.target,
      current: computed(() =>
        router.current()?.fullPath === router.resolve(context.inputs.to() as RouteTarget).fullPath
          ? 'page'
          : null,
      ),
    };
  },
  onMount(context) {
    const anchor = context.element<HTMLAnchorElement>('link');
    const download = context.inputs.download();
    if (download !== null) anchor.setAttribute('download', download);
    const intent = () => {
      if (
        (anchor.target && anchor.target.toLowerCase() !== '_self') ||
        anchor.hasAttribute('download')
      )
        return;
      void context.router.preload(context.inputs.to() as RouteTarget, { trigger: 'intent' });
    };
    context.on('link', 'pointerenter', intent);
    context.on('link', 'focus', intent);
    context.on('link', 'click', async (event) => {
      const click = event as MouseEvent;
      if (
        click.defaultPrevented ||
        click.button !== 0 ||
        click.ctrlKey ||
        click.metaKey ||
        click.shiftKey ||
        click.altKey ||
        (anchor.target && anchor.target.toLowerCase() !== '_self') ||
        anchor.hasAttribute('download')
      )
        return;
      click.preventDefault();
      const result = await (context.inputs.replace()
        ? context.router.replace(context.inputs.to() as RouteTarget)
        : context.router.push(context.inputs.to() as RouteTarget));
      if (!context.signal.aborted) context.emit('navigated', result);
    });
  },
  onInputsChanged(context) {
    const anchor = context.element('link'),
      download = context.inputs.download();
    if (download === null) anchor.removeAttribute('download');
    else anchor.setAttribute('download', download);
  },
});
