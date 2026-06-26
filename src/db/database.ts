import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export type Db = Database.Database;

/** DI tokens. */
export const DB = 'DB_CONNECTION';
export const CELEBRITY_THRESHOLD = 'CELEBRITY_THRESHOLD';

/** Create a SQLite database (file path or ':memory:') with the schema applied. */
export function createDatabase(path = ':memory:'): Db {
  const db = new Database(path);
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.exec(SCHEMA_SQL);
  return db;
}
