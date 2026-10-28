import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { createGameClock } from '@xiaobaibaifqy/jingchuanchu-app/application';
const clock = createGameClock({ scope: new Scope() });
clock.tween({
  from: 0,
  to: 100,
  duration: 1,
  onUpdate(value) {
    const number: number = value;
    void number;
  },
});
clock.tween({
  from: { x: 0, alpha: 1 },
  to: { x: 100, alpha: 0 },
  duration: 1,
  onUpdate(value) {
    const x: number = value.x;
    void x;
    // @ts-expect-error output field names remain exact
    value.missing;
    // @ts-expect-error output is readonly
    value.x = 5;
  },
});
// @ts-expect-error target must match the source fields
clock.tween({ from: { x: 0 }, to: { y: 100 }, duration: 1, onUpdate() {} });
// @ts-expect-error numeric input requires numeric output
clock.tween({ from: 0, to: { x: 100 }, duration: 1, onUpdate() {} });
// @ts-expect-error only specified easing names are accepted
clock.tween({ from: 0, to: 1, duration: 1, easing: 'bounce', onUpdate() {} });
