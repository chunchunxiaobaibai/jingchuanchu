import type { RoomSnapshot } from '../../games/draw-guess/protocol.js';

export function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
}
const text = (id: string, value: string): void => {
  element(id).textContent = value;
};
const disabled = (id: string, value: boolean): void => {
  element<HTMLInputElement | HTMLButtonElement>(id).disabled = value;
};
export const refs = {
  canvas: element<HTMLCanvasElement>('canvas'),
  name: element<HTMLInputElement>('name'),
  roomCode: element<HTMLInputElement>('room-code'),
  guess: element<HTMLInputElement>('guess'),
  brush: element<HTMLInputElement>('brush'),
  action: element<HTMLButtonElement>('action'),
};
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function dismissNotice(): void {
  clearTimeout(noticeTimer);
  element('notice').hidden = true;
}
export function notify(message: string, error = false): void {
  const notice = element('notice');
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle('error', error);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 4500);
}
export function renderConnection(status: 'connecting' | 'open' | 'closed' | 'error'): void {
  text(
    'connection-status',
    { connecting: '正在连接', open: '已连接', closed: '连接已断开', error: '连接异常' }[status],
  );
  element('connection-dot').classList.toggle('online', status === 'open');
  element('reconnect').hidden = status === 'open' || status === 'connecting';
  disabled('create', status !== 'open');
  disabled('join', status !== 'open');
}
export function renderRoom(state: RoomSnapshot | undefined, playerId: string): void {
  element('lobby').hidden = !!state;
  element('game').hidden = !state;
  if (!state) return;
  const isDrawer = state.drawerId === playerId;
  const drawing = state.phase === 'drawing';
  const isHost = state.hostId === playerId;
  const me = state.players.find((player) => player.id === playerId);
  text('room-id', state.roomId);
  text('player-count', `${state.players.length} / 10`);
  text(
    'phase',
    {
      lobby: '等待开始',
      drawing: isDrawer ? '你来画' : '你来猜',
      reveal: '答案揭晓',
      finished: '本局结束',
    }[state.phase],
  );
  text(
    'prompt',
    state.phase === 'lobby'
      ? '等朋友们到齐'
      : state.word
        ? `题目：${state.word}`
        : `提示：${state.hint}`,
  );
  text('round-number', state.totalRounds ? `${state.round} / ${state.totalRounds} 回合` : '');
  const canvasMessage = element('canvas-message');
  canvasMessage.hidden = state.phase !== 'lobby' && state.phase !== 'finished';
  if (state.phase === 'finished') {
    const best = [...state.players].sort((a, b) => b.score - a.score)[0];
    canvasMessage.querySelector('strong')!.textContent = `本局冠军：${best?.name ?? '大家'}`;
    canvasMessage.querySelector('p')!.textContent = '房主可以再开一局，继续比拼想象力。';
  } else {
    canvasMessage.querySelector('strong')!.textContent = '画布已经准备好了';
    canvasMessage.querySelector('p')!.textContent = '至少 2 人加入后，房主就可以开始。';
  }
  const canDraw = drawing && isDrawer;
  refs.canvas.classList.toggle('drawable', canDraw);
  disabled('clear', !canDraw);
  disabled('brush', !canDraw);
  for (const button of element('colors').querySelectorAll('button')) button.disabled = !canDraw;
  const canGuess = drawing && !isDrawer && !me?.guessed;
  disabled('guess', !canGuess);
  disabled('send-guess', !canGuess);
  refs.guess.placeholder = isDrawer
    ? '你是画家，不能猜词'
    : me?.guessed
      ? '猜对了，等大家继续猜吧'
      : '你觉得画的是什么？';
  refs.action.hidden = !isHost || drawing;
  refs.action.textContent =
    state.phase === 'reveal' ? '下一回合' : state.phase === 'finished' ? '再来一局' : '开始游戏';
  refs.action.disabled = state.players.length < 2;
  text(
    'instruction',
    state.phase === 'lobby'
      ? '分享房间码，邀请朋友加入。'
      : state.phase === 'finished'
        ? '这一局的分数已结算。'
        : state.phase === 'reveal'
          ? isHost
            ? '点击下一回合，换一位画家。'
            : '等待房主开始下一回合。'
          : isDrawer
            ? '画出题目，让朋友猜到。不要直接写答案哦。'
            : me?.guessed
              ? '你猜对了！等其他朋友继续猜。'
              : '观察画面，把你猜到的词发出来。',
  );
  const players = element('players');
  players.replaceChildren();
  for (const player of state.players) {
    const li = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = [...player.name][0] ?? '?';
    const info = document.createElement('span');
    info.className = 'player-name';
    const name = document.createElement('strong');
    name.textContent = player.name + (player.id === playerId ? '（你）' : '');
    const detail = document.createElement('small');
    detail.textContent = [
      player.id === state.hostId ? '房主' : '',
      player.id === state.drawerId && drawing ? '正在绘画' : player.guessed ? '已猜中' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const score = document.createElement('span');
    score.className = 'player-score';
    score.textContent = String(player.score);
    info.append(name, detail);
    li.append(avatar, info, score);
    players.append(li);
  }
  const messages = element('messages');
  messages.replaceChildren();
  if (!state.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-chat';
    empty.textContent = drawing ? '大胆猜，灵感就在下一笔。' : '游戏开始后，在这里发送猜测。';
    messages.append(empty);
  }
  for (const message of state.messages) {
    const item = document.createElement('div');
    item.className = `chat${message.correct ? ' correct' : ''}`;
    const name = document.createElement('strong');
    name.textContent = message.name;
    const body = document.createElement('span');
    body.textContent = message.text;
    item.append(name, body);
    messages.append(item);
  }
  messages.scrollTop = messages.scrollHeight;
}
export function renderTimer(state: RoomSnapshot | undefined, clockOffset: number): void {
  text(
    'timer',
    state?.phase === 'drawing'
      ? `${Math.max(0, Math.ceil((state.endsAt - Date.now() - clockOffset) / 1000))}s`
      : '—',
  );
}
