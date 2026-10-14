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

export type ConnectionErrorKind = 'decode' | 'handler' | 'transport';
export interface ConnectionFailure {
  kind: ConnectionErrorKind;
  cause: unknown;
}
export interface ConnectionOptions {
  onError?: (failure: ConnectionFailure) => void;
}

export class BrowserConnection<Client, Server> {
  private socket: WebSocket | undefined;
  lastError: ConnectionFailure | undefined;
  private state: 'idle' | 'connecting' | 'open' | 'closed' | 'error' = 'idle';
  constructor(
    private readonly decoder: Decoder<Server>,
    private readonly onMessage: (message: Server) => void,
    private readonly onStatus: (status: 'connecting' | 'open' | 'closed' | 'error') => void,
    private readonly options: ConnectionOptions = {},
  ) {}
  get status(): 'idle' | 'connecting' | 'open' | 'closed' | 'error' {
    return this.state;
  }
  private updateStatus(status: 'connecting' | 'open' | 'closed' | 'error'): void {
    this.state = status;
    this.onStatus(status);
  }
  connect(url: string): void {
    this.close();
    this.updateStatus('connecting');
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => this.updateStatus('open');
    socket.onmessage = (event) => {
      let message: Server;
      try {
        message = this.decoder.parse(JSON.parse(String(event.data)));
      } catch (cause) {
        this.report('decode', cause);
        this.updateStatus('error');
        socket.close(1002, 'Invalid server message');
        return;
      }
      try {
        this.onMessage(message);
      } catch (cause) {
        this.report('handler', cause);
      }
    };
    socket.onclose = () => this.updateStatus('closed');
    socket.onerror = (cause) => {
      this.report('transport', cause);
      this.updateStatus('error');
    };
  }
  private report(kind: ConnectionErrorKind, cause: unknown): void {
    this.lastError = { kind, cause };
    try {
      this.options.onError?.(this.lastError);
    } catch (error) {
      this.lastError = { kind: 'handler', cause: error };
    }
  }
  send(message: Client): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 256 * 1024)
      return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      this.state = 'closed';
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }
}
