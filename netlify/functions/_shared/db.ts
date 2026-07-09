import { getConnectionString, getDatabase } from "@netlify/database";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../database/schema.js";

let drizzlePool: pg.Pool | undefined;
let pgPool: pg.Pool | undefined;

function getSkillGroupsConnectionString() {
  return process.env.SKILLGROUPS_DATABASE_URL || getConnectionString();
}

export function getSqlDatabase() {
  return getDatabase({ connectionString: getSkillGroupsConnectionString() });
}

export function getPgPool() {
  pgPool ??= new pg.Pool({ connectionString: getSkillGroupsConnectionString() });
  return pgPool;
}

export function getDrizzleDatabase() {
  drizzlePool ??= new pg.Pool({ connectionString: getConnectionString() });
  return drizzle(drizzlePool, { schema });
}
