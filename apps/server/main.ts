import { resolve } from 'node:path';
import { createGameServer } from './service.js';

const server = await createGameServer({
  port: Number(process.env.PORT ?? 3001),
  staticDir: resolve(process.cwd(), 'dist/client'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(','),
});
console.log(`游戏服务已启动：http://localhost:${server.port}（开发网页：http://localhost:5173）`);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return; closing = true;
  void server.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
});
