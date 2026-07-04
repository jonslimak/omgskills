import { getConnectionString, getDatabase } from "@netlify/database";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../database/schema.js";

let drizzlePool: pg.Pool | undefined;
let pgPool: pg.Pool | undefined;

export function getSqlDatabase() {
  return getDatabase();
}

export function getPgPool() {
  pgPool ??= new pg.Pool({ connectionString: getConnectionString() });
  return pgPool;
}

export function getDrizzleDatabase() {
  drizzlePool ??= new pg.Pool({ connectionString: getConnectionString() });
  return drizzle(drizzlePool, { schema });
}
