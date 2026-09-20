import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "./schema";
import { executeStatements, PortalSql } from "./postgres-client";

export function getDb() {
  return drizzle(async (sql, params) => {
    const [result] = await executeStatements([{ sql, params }]);
    return { rows: result.rows };
  }, { schema });
}

export function getSql() { return new PortalSql(); }
