import './style.css';
import { Engine } from '../../packages/core/index.js';
import { Canvas2D, bindPointer, runBrowser, type Point } from '../../packages/browser/index.js';
import { BrowserConnection } from '../../packages/net/index.js';
import {
  COLORS,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type RoomSnapshot,
  type Stroke,
} from '../../games/draw-guess/protocol.js';
import {
  element,
  refs,
  notify,
  dismissNotice,
  renderConnection,
  renderRoom,
  renderTimer,
} from './view.js';

const engine = new Engine();
const renderer = new Canvas2D(refs.canvas);
let state: RoomSnapshot | undefined;
let playerId = '';
let clockOffset = 0;
let dirty = true;
let syncing = false;
let active: Point[] | undefined;
let hasNewPoints = false;
let pending: Stroke[] = [];
let color: Stroke['color'] = COLORS[0];
let strokeColor: Stroke['color'] = color;
let strokeWidth = 5;
const canDraw = (): boolean => state?.phase === 'drawing' && state.drawerId === playerId;
const send = (message: ClientMessage): boolean => {
  if (connection.send(message)) return true;
  notify('连接不可用，请重新连接后加入房间。', true);
  return false;
};
const resetDrawing = (): void => {
  active = undefined;
  hasNewPoints = false;
  pending = [];
  dirty = true;
};
const receive = (message: ServerMessage): void => {
  switch (message.type) {
    case 'welcome':
      playerId = message.playerId;
      break;
    case 'snapshot': {
      const previous = state;
      state = message.state;
      if (previous?.roomId !== state.roomId) dismissNotice();
      clockOffset = state.serverTime - Date.now();
      syncing = false;
      pending = [];
      if (previous?.roundId !== state.roundId || !canDraw()) resetDrawing();
      renderRoom(state, playerId);
      dirty = true;
      break;
    }
    case 'stroke':
      if (!state || message.roundId !== state.roundId) return;
      if (message.revision !== state.revision + 1) {
        if (!syncing) {
          syncing = true;
          send({ type: 'sync' });
        }
        return;
      }
      state.strokes.push(message.stroke);
      state.revision = message.revision;
      if (canDraw()) pending.shift();
      dirty = true;
      break;
    case 'error':
      notify(message.message, true);
      resetDrawing();
      if (state && !syncing) {
        syncing = true;
        send({ type: 'sync' });
      }
      break;
    case 'left':
      state = undefined;
      resetDrawing();
      renderRoom(state, playerId);
      break;
  }
};
const connection = new BrowserConnection<ClientMessage, ServerMessage>(
  serverMessageSchema,
  receive,
  (status) => {
    renderConnection(status);
    if (status === 'closed' || status === 'error') {
      state = undefined;
      syncing = false;
      resetDrawing();
      renderRoom(state, playerId);
      notify('连接已断开。重新连接后，可使用房间码再次加入。', true);
    }
  },
);
const connect = (): void =>
  connection.connect(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
engine.scope.own(() => connection.close());

for (const [index, value] of COLORS.entries()) {
  const button = document.createElement('button');
  button.className = 'color';
  button.style.backgroundColor = value;
  button.type = 'button';
  button.setAttribute('aria-label', ['墨黑', '珊瑚红', '暖黄', '草绿', '海蓝', '紫色'][index]!);
  button.setAttribute('aria-pressed', String(value === color));
  button.addEventListener('click', () => {
    color = value;
    for (const item of element('colors').querySelectorAll('button'))
      item.setAttribute('aria-pressed', String(item === button));
  });
  element('colors').append(button);
}
const flushStroke = (finish = false): void => {
  if (!active || !canDraw() || !state) {
    active = undefined;
    return;
  }
  if (hasNewPoints) {
    const stroke: Stroke = {
      points: active.map((point) => ({ ...point })),
      color: strokeColor,
      width: strokeWidth,
    };
    if (send({ type: 'stroke', roundId: state.roundId, stroke })) pending.push(stroke);
    active = [active[active.length - 1]!];
    hasNewPoints = false;
  }
  if (finish) active = undefined;
  dirty = true;
};
const move = (event: PointerEvent): void => {
  if (!active || !canDraw()) return;
  const point = renderer.toPoint(event.clientX, event.clientY);
  const last = active[active.length - 1]!;
  if (Math.hypot(last.x - point.x, last.y - point.y) < 1) return;
  active.push(point);
  hasNewPoints = true;
  dirty = true;
  if (active.length >= 64) flushStroke();
};
bindPointer(
  refs.canvas,
  {
    down: (event) => {
      if (!canDraw()) return;
      active = [renderer.toPoint(event.clientX, event.clientY)];
      strokeColor = color;
      strokeWidth = Number(refs.brush.value);
      hasNewPoints = true;
      dirty = true;
    },
    move,
    up: (event) => {
      move(event);
      flushStroke(true);
    },
  },
  engine.scope,
);
const strokeTimer = setInterval(() => flushStroke(), 80);
engine.scope.own(() => clearInterval(strokeTimer));

element('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = refs.name.value.trim();
  if (!name) {
    refs.name.focus();
    notify('先填写你的昵称。', true);
    return;
  }
  send({ type: 'create', name });
});
element('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = refs.name.value.trim();
  if (!name) {
    refs.name.focus();
    notify('先填写你的昵称。', true);
    return;
  }
  send({ type: 'join', name, roomId: refs.roomCode.value.trim().toUpperCase() });
});
element('guess-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = refs.guess.value.trim();
  if (state && text && send({ type: 'guess', roundId: state.roundId, text })) refs.guess.value = '';
});
refs.action.addEventListener('click', () => {
  if (state) send({ type: state.phase === 'reveal' ? 'next' : 'start' });
});
element('clear').addEventListener('click', () => {
  if (state && canDraw()) {
    resetDrawing();
    send({ type: 'clear', roundId: state.roundId });
  }
});
element('leave').addEventListener('click', () => send({ type: 'leave' }));
element('reconnect').addEventListener('click', connect);
element('copy-code').addEventListener('click', () => {
  if (!state) return;
  void navigator.clipboard?.writeText(state.roomId).then(
    () => notify('房间码已复制，发给朋友吧。'),
    () => notify(`房间码：${state!.roomId}`),
  );
  if (!navigator.clipboard) notify(`房间码：${state.roomId}`);
});
engine.addSystem({
  id: 'draw-guess-render',
  phase: 'render',
  update: () => {
    renderTimer(state, clockOffset);
    if (!dirty) return;
    renderer.clear();
    for (const stroke of state?.strokes ?? []) renderer.stroke(stroke);
    for (const stroke of pending) renderer.stroke(stroke);
    if (active) renderer.stroke({ points: active, color: strokeColor, width: strokeWidth });
    dirty = false;
  },
});
const hidden = (): void => {
  if (document.hidden) flushStroke(true);
};
document.addEventListener('visibilitychange', hidden);
engine.scope.own(() => document.removeEventListener('visibilitychange', hidden));
window.addEventListener('pagehide', () => engine.dispose(), { once: true });
renderRoom(undefined, playerId);
connect();
runBrowser(engine, (error) => {
  console.error(error);
  notify('画布运行异常，请刷新页面。', true);
});
