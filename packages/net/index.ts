export interface Decoder<T> {
  parse(value: unknown): T;
}
export interface Peer {
  readonly id: string;
  send(message: unknown): void;
}

export class RoomDirectory<T> {
  private readonly entries = new Map<string, { value: T; members: Set<string> }>();
  constructor(
    readonly capacity = 10,
    readonly maxRooms = 100,
  ) {}
  get size(): number {
    return this.entries.size;
  }
  create(id: string, value: T): void {
    if (this.entries.has(id)) throw new Error('房间已存在');
    if (this.entries.size >= this.maxRooms) throw new Error('房间数量已达上限');
    this.entries.set(id, { value, members: new Set() });
  }
  get(id: string): T | undefined {
    return this.entries.get(id)?.value;
  }
  join(id: string, member: string): T {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('房间不存在');
    if (entry.members.has(member)) throw new Error('已经加入房间');
    if (entry.members.size >= this.capacity)
      throw new Error(`房间已满（最多 ${this.capacity} 人）`);
    entry.members.add(member);
    return entry.value;
  }
  leave(id: string, member: string): boolean {
    const entry = this.entries.get(id);
    entry?.members.delete(member);
    return entry?.members.size === 0;
  }
  remove(id: string): void {
    this.entries.delete(id);
  }
  values(): IterableIterator<T> {
    return [...this.entries.values()].map((entry) => entry.value).values();
  }
}

export class RateLimit {
  private started = 0;
  private count = 0;
  constructor(
    readonly maximum: number,
    readonly windowMs = 1000,
  ) {}
  allow(now: number): boolean {
    if (now - this.started >= this.windowMs) {
      this.started = now;
      this.count = 0;
    }
    return ++this.count <= this.maximum;
  }
}

export type ConnectionErrorKind = 'decode' | 'handler' | 'transport' | 'heartbeat' | 'queue';
export interface ConnectionFailure {
  kind: ConnectionErrorKind;
  cause: unknown;
}
export interface ConnectionOptions<Client = unknown, Server = unknown> {
  onError?: (failure: ConnectionFailure) => void;
  reconnect?: { maxAttempts?: number; delayMs?: number; maxDelayMs?: number };
  heartbeat?: {
    intervalMs: number;
    timeoutMs: number;
    message: () => Client;
    isResponse?: (message: Server) => boolean;
  };
  maxQueuedMessages?: number;
  maxQueuedBytes?: number;
  maxBufferedBytes?: number;
  socketFactory?: (url: string) => WebSocket;
}
export class BrowserConnection<Client, Server> {
  private socket: WebSocket | undefined;
  private state: 'idle' | 'connecting' | 'open' | 'closed' | 'error' = 'idle';
  private url = '';
  private active = false;
  private epoch = 0;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
  private pump: ReturnType<typeof setTimeout> | undefined;
  private queue: Array<{ data: string; bytes: number; key: string | undefined }> = [];
  private queuedBytes = 0;
  private sent = 0;
  private received = 0;
  lastError: ConnectionFailure | undefined;
  constructor(
    private readonly decoder: Decoder<Server>,
    private readonly onMessage: (message: Server) => void,
    private readonly onStatus: (status: 'connecting' | 'open' | 'closed' | 'error') => void,
    private readonly options: ConnectionOptions<Client, Server> = {},
  ) {
    const positive = [
      options.reconnect?.delayMs ?? 250,
      options.reconnect?.maxDelayMs ?? 10000,
      options.maxBufferedBytes ?? 256 * 1024,
      options.heartbeat?.intervalMs ?? 1,
      options.heartbeat?.timeoutMs ?? 1,
    ];
    if (
      !positive.every((value) => Number.isFinite(value) && value > 0) ||
      ![
        options.maxQueuedMessages ?? 64,
        options.maxQueuedBytes ?? 256 * 1024,
        options.reconnect?.maxAttempts ?? 5,
      ].every((value) => Number.isInteger(value) && value >= 0)
    )
      throw new Error('Invalid connection options');
  }
  get status(): 'idle' | 'connecting' | 'open' | 'closed' | 'error' {
    return this.state;
  }
  get stats() {
    return {
      sentMessages: this.sent,
      receivedMessages: this.received,
      queuedMessages: this.queue.length,
      queuedBytes: this.queuedBytes,
      bufferedBytes: this.socket?.bufferedAmount ?? 0,
      reconnectAttempts: this.attempts,
    };
  }
  private updateStatus(status: 'connecting' | 'open' | 'closed' | 'error'): void {
    this.state = status;
    this.invokeHandler(() => this.onStatus(status));
  }
  private captureRejection(result: unknown, onRejected: (cause: unknown) => void): void {
    if (
      result &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      void Promise.resolve(result).catch(onRejected);
    }
  }
  private invokeHandler(callback: () => unknown): void {
    try {
      this.captureRejection(callback(), (cause) => this.report('handler', cause));
    } catch (cause) {
      this.report('handler', cause);
    }
  }

  connect(url: string): void {
    this.close();
    this.url = url;
    this.active = true;
    this.attempts = 0;
    this.openSocket();
  }
  private openSocket(): void {
    if (!this.active) return;
    const epoch = this.epoch;
    this.updateStatus('connecting');
    if (!this.active || this.epoch !== epoch) return;
    let socket: WebSocket;
    try {
      socket = this.options.socketFactory?.(this.url) ?? new WebSocket(this.url);
    } catch (cause) {
      this.report('transport', cause);
      if (this.epoch !== epoch) return;
      this.updateStatus('error');
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || !this.active) return;
      this.attempts = 0;
      this.updateStatus('open');
      if (this.socket !== socket) return;
      this.flush();
      this.scheduleHeartbeat();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      let message: Server;
      try {
        message = this.decoder.parse(JSON.parse(String(event.data)));
      } catch (cause) {
        this.report('decode', cause);
        if (this.socket !== socket) return;
        this.updateStatus('error');
        socket.close(1002, 'Invalid server message');
        return;
      }
      this.received++;
      this.invokeHandler(() => {
        if (!this.options.heartbeat?.isResponse || this.options.heartbeat.isResponse(message)) {
          clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = undefined;
        }
        return this.onMessage(message);
      });
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.detach(socket);
      this.socket = undefined;
      this.clearSocketTimers();
      this.updateStatus('closed');
      if (this.epoch !== epoch) return;
      if ([1006, 1011, 1012, 1013].includes(event?.code ?? 1006)) this.scheduleRetry();
      else this.endSession();
    };
    socket.onerror = (cause) => {
      if (this.socket !== socket) return;
      this.report('transport', cause);
      if (this.socket === socket) this.updateStatus('error');
    };
  }
  private scheduleRetry(): void {
    if (!this.active || this.retry !== undefined) return;
    if (!this.options.reconnect) {
      this.endSession();
      return;
    }
    const policy = this.options.reconnect;
    if (this.attempts >= (policy.maxAttempts ?? 5)) {
      this.endSession();
      return;
    }
    const delay = Math.min(
      (policy.delayMs ?? 250) * 2 ** this.attempts,
      policy.maxDelayMs ?? 10000,
    );
    this.attempts++;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.openSocket();
    }, delay);
  }
  private endSession(): void {
    this.active = false;
    if (this.queue.length)
      this.report('queue', new Error('Connection closed with unsent messages'));
    this.queue = [];
    this.queuedBytes = 0;
  }
  private scheduleHeartbeat(): void {
    const policy = this.options.heartbeat;
    if (!policy || !this.active || this.socket?.readyState !== WebSocket.OPEN) return;
    const socket = this.socket;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      try {
        const message = policy.message();
        if (this.socket !== socket || !this.active) return;
        if (this.send(message) && this.heartbeatTimeout === undefined)
          this.heartbeatTimeout = setTimeout(() => {
            this.heartbeatTimeout = undefined;
            if (this.socket !== socket) return;
            this.report('heartbeat', new Error('Heartbeat response timeout'));
            socket.close(1013, 'Heartbeat timeout');
          }, policy.timeoutMs);
      } catch (cause) {
        this.report('handler', cause);
      }
      this.scheduleHeartbeat();
    }, policy.intervalMs);
  }
  private report(kind: ConnectionErrorKind, cause: unknown): void {
    this.lastError = { kind, cause };
    try {
      this.captureRejection(this.options.onError?.(this.lastError), (cause) => {
        this.lastError = { kind: 'handler', cause };
      });
    } catch (error) {
      this.lastError = { kind: 'handler', cause: error };
    }
  }
  send(message: Client, options: { queue?: boolean; key?: string } = {}): boolean {
    const socket = this.socket;
    if (
      !options.queue &&
      (!socket ||
        socket.readyState !== WebSocket.OPEN ||
        socket.bufferedAmount > (this.options.maxBufferedBytes ?? 256 * 1024))
    )
      return false;
    const data = JSON.stringify(message);
    if (!options.queue) {
      socket!.send(data);
      this.sent++;
      return true;
    }
    if (!this.active) return false;
    const bytes = new TextEncoder().encode(data).byteLength;
    const index =
      options.key === undefined ? -1 : this.queue.findIndex((item) => item.key === options.key);
    const replaced = index < 0 ? 0 : this.queue[index]!.bytes;
    if (
      this.queuedBytes - replaced + bytes > (this.options.maxQueuedBytes ?? 256 * 1024) ||
      (index < 0 && this.queue.length >= (this.options.maxQueuedMessages ?? 64))
    ) {
      this.report('queue', new Error('Send queue capacity exceeded'));
      return false;
    }
    const item = { data, bytes, key: options.key };
    if (index < 0) this.queue.push(item);
    else this.queue[index] = item;
    this.queuedBytes = this.queuedBytes - replaced + bytes;
    this.flush();
    return true;
  }
  private flush(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (
      this.queue.length &&
      socket.bufferedAmount <= (this.options.maxBufferedBytes ?? 256 * 1024)
    ) {
      const item = this.queue[0]!;
      try {
        socket.send(item.data);
      } catch (cause) {
        this.report('transport', cause);
        socket.close(1013, 'Send failed');
        return;
      }
      if (this.queue[0] === item) {
        this.queue.shift();
        this.queuedBytes -= item.bytes;
      }
      this.sent++;
    }
    if (this.queue.length && this.pump === undefined)
      this.pump = setTimeout(() => {
        this.pump = undefined;
        this.flush();
      }, 16);
  }
  private detach(socket: WebSocket): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
  }
  private clearSocketTimers(): void {
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.heartbeatTimeout);
    clearTimeout(this.pump);
    this.heartbeatTimer = undefined;
    this.heartbeatTimeout = undefined;
    this.pump = undefined;
  }
  close(): void {
    this.active = false;
    this.epoch++;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.clearSocketTimers();
    this.queue = [];
    this.queuedBytes = 0;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      this.state = 'closed';
      this.detach(socket);
      socket.close();
    }
  }
}
