import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

it('P5已存在的父子任务、用量、锁与事件在P6迁移后完整保留', () => {
  const db = new Database(':memory:');
  try {
    for (const name of ['20260905000000_initial', '20260906000000_batch'])
      db.exec(readFileSync(`apps/server/prisma/migrations/${name}/migration.sql`, 'utf8'));
    db.pragma('foreign_keys = ON');
    db.exec(`INSERT INTO Project (id,title,idea,genre,requirements,targetCount,targetLength,updatedAt)
      VALUES ('project','测试','灵感','悬疑','{}',3,500,CURRENT_TIMESTAMP);
      INSERT INTO Job (id,projectId,kind,chainEpoch,input,config,artifactRefs,updatedAt)
      VALUES ('parent','project','BATCH',0,'{}','{}','{}',CURRENT_TIMESTAMP);
      INSERT INTO Job (id,parentId,projectId,kind,number,chainEpoch,input,config,artifactRefs,httpUsed,generationText,updatedAt)
      VALUES ('child','parent','project','CHAPTER',1,0,'{}','{}','{}',7,'保留候选正文',CURRENT_TIMESTAMP);
      INSERT INTO ActiveCommand (projectId,jobId) VALUES ('project','parent');
      INSERT INTO JobEvent (jobId,type,payload) VALUES ('child','stage','{}');`);
    const before = db.prepare('SELECT * FROM Job ORDER BY id').all();
    db.exec(
      readFileSync('apps/server/prisma/migrations/20260907000000_library/migration.sql', 'utf8'),
    );
    db.exec(
      readFileSync(
        'apps/server/prisma/migrations/20260908000000_authorized_quotes/migration.sql',
        'utf8',
      ),
    );
    db.exec(readFileSync('apps/server/prisma/migrations/20260909000000_plan_versions/migration.sql', 'utf8'));
    expect(db.prepare('SELECT planRevision FROM Project WHERE id=?').get('project')).toEqual({ planRevision: 0 });
    expect(db.prepare('SELECT * FROM Job ORDER BY id').all()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(db.prepare('SELECT jobId FROM ActiveCommand').get()).toEqual({ jobId: 'parent' });
    expect(db.prepare('SELECT jobId FROM JobEvent').get()).toEqual({ jobId: 'child' });
    db.exec(`INSERT INTO Job (id,kind,chainEpoch,input,config,artifactRefs,updatedAt)
      VALUES ('library','REFERENCE_ANALYZE',0,'{}','{}','{}',CURRENT_TIMESTAMP);
      INSERT INTO LibraryCommand (scope,jobId) VALUES ('reference:example','library');`);
    expect(db.prepare('SELECT projectId FROM Job WHERE id=?').get('library')).toEqual({
      projectId: null,
    });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('AuthorizedQuote')).toEqual({
      name: 'AuthorizedQuote',
    });
  } finally {
    db.close();
  }
});
