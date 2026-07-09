import type { Config, Context } from "@netlify/functions";
import type { Pool } from "pg";
import { requireAuth } from "./_shared/auth.js";
import { getSqlDatabase } from "./_shared/db.js";
import { errorResponse, jsonResponse, optionsResponse } from "./_shared/http.js";

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return optionsResponse(req);
  }

  try {
    await requireAuth(req);
    const db = getSqlDatabase();
    const pool = db.pool as unknown as Pool;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE skillgroup_smoke_check (id text PRIMARY KEY)");
      await client.query("INSERT INTO skillgroup_smoke_check (id) VALUES ($1)", ["ok"]);
      const result = await client.query("SELECT id FROM skillgroup_smoke_check WHERE id = $1", ["ok"]);
      await client.query("DELETE FROM skillgroup_smoke_check WHERE id = $1", ["ok"]);
      await client.query("COMMIT");

      return jsonResponse(req, {
        ok: true,
        rows: result.rowCount
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Response) {
      return errorResponse(req, error.status, await error.text());
    }
    return errorResponse(req, 500, "Database smoke check failed");
  }
};

export const config: Config = {
  path: "/api/portal/db-smoke"
};
