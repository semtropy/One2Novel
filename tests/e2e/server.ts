import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { createDb, initializeDb } from '../../apps/server/src/platform/db.js';
import { seedConfig, saveConfig } from '../../apps/server/src/orchestrator/config.js';
import { Orchestrator } from '../../apps/server/src/orchestrator/service.js';
import { createApp } from '../../apps/server/src/http.js';
import { FakeModel, testSettings } from '../fixtures/fake-model.js';
import { migrateTestDb } from '../fixtures/migrate.js';
import { AppError } from '../../apps/server/src/platform/core.js';
const dir = mkdtempSync(resolve(tmpdir(), 'one2novel-browser-')),
  file = resolve(dir, 'test.db');
const native = new Database(file);
migrateTestDb(native);
native.close();
const db = createDb(`file:${file.replaceAll('\\', '/')}`);
await initializeDb(db);
await seedConfig(db);
await saveConfig(db, 'models', testSettings, 0);
process.env.PORT = '7466';
const gateway = new FakeModel();
gateway.delay = 100;
gateway.beforeCall = async (r) => {
  const input = r.input as {
    text?: string;
    base?: { worldRules: Record<string, { description: string }> };
  };
  if (
    r.prompt === 'state.validate' &&
    Object.values(input.base?.worldRules || {}).some(
      (rule) => rule.description === '浏览器测试：需要人工修订',
    ) &&
    !input.text?.includes('人工修订完成')
  )
    throw new AppError('IMMUTABLE_RULE', '本章与既定规则冲突，请修订正文');
};
const engine = new Orchestrator(db, gateway);
const server = createServer(createApp(db, engine, gateway));
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(7466, '127.0.0.1', resolve);
});
engine.start();
console.log('Isolated browser test server ready');
const close = async () => {
  server.close();
  await engine.stop();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
