import { createServer } from 'node:http';
import { createDb, initializeDb } from './platform/db.js';
import { acquireDataLock } from './platform/data-lock.js';
import { seedConfig } from './orchestrator/config.js';
import { ChatAnywhere } from './platform/llm.js';
import { Orchestrator } from './orchestrator/service.js';
import { createApp } from './http.js';
const dataLock = acquireDataLock(),
  db = createDb(),
  gateway = new ChatAnywhere(),
  engine = new Orchestrator(db, gateway);
const server = createServer();
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(process.env.PORT || 7456), '127.0.0.1', resolve);
  });
  await initializeDb(db);
  await seedConfig(db);
  await engine.recover();
  server.on('request', createApp(db, engine, gateway));
  engine.start();
  console.log(`One2Novel ready: http://127.0.0.1:${process.env.PORT || 7456}`);
} catch {
  server.close();
  await db.$disconnect();
  dataLock.release();
  console.error('启动失败：请先运行 pnpm db:migrate，确认数据库及端口可用。');
  process.exitCode = 1;
}
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  server.close();
  await engine.stop();
  await db.$disconnect();
  dataLock.release();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
