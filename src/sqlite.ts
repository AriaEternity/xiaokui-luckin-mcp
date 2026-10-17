import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,fstatSync,constants} from 'node:fs';

// 独立项目使用 Node 24 内置 SQLite，避免复制私人项目数据库或原生依赖。
export class SqliteDatabase {
  readonly database: DatabaseSync;
  constructor(path: string) {
    if ((process.umask() & 0o077) !== 0o077) throw Error('PRIVATE_UMASK_REQUIRED');
    const fd=openSync(path,constants.O_RDWR|constants.O_CREAT|(constants.O_NOFOLLOW??0),0o600);
    try {
      const info=fstatSync(fd);
      if(!info.isFile()||info.nlink!==1||(process.platform!=='win32'&&((info.mode&0o077)!==0||info.uid!==process.getuid?.())))throw Error('OAUTH_DATABASE_PRIVATE_REQUIRED');
    } finally {closeSync(fd);}
    this.database = new DatabaseSync(path);
  }
  pragma(sql: string) { this.database.exec('PRAGMA ' + sql); }
  exec(sql: string) { this.database.exec(sql); }
  prepare(sql: string) { return this.database.prepare(sql); }
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const value = fn();
        this.database.exec('COMMIT');
        return value;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };
  }
  close() { this.database.close(); }
}
