import mysql from "mysql2/promise";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  enableKeepAlive: true,
  // qbx_core stores money/charinfo/job as JSON-typed text — let mysql2 hand them
  // back as parsed objects when the column type is JSON.
  typeCast: true,
  // Read/write naive DATETIME columns as UTC. Without this mysql2 uses the
  // Node process's local zone, which drifts from how the value was stored.
  timezone: "Z",
});

// The FiveM MySQL box's system clock isn't UTC (it was ~7h off — a
// US-Pacific default), so server-evaluated CURRENT_TIMESTAMP / NOW() on
// our DEFAULT columns were being stored in that local zone while we read
// them back as UTC — the "7h ago" skew on fresh forum / changelog posts.
// Forcing the bridge's session time_zone to +00:00 makes every write
// (DEFAULT CURRENT_TIMESTAMP, NOW()) evaluate in UTC, so writes and reads
// finally agree. Numeric offset needs no timezone tables loaded. This is
// per-connection, scoped to the bridge — it doesn't touch how FiveM's own
// connections behave.
pool.on("connection", (conn) => {
  // Depending on mysql2 internals `conn` may be a promise- or
  // callback-style connection; Promise.resolve() normalises both so a
  // failure can't become an unhandled rejection. A numeric-offset SET
  // essentially never fails, but log it if it somehow does.
  Promise.resolve(conn.query("SET time_zone = '+00:00'")).catch((err) => {
    logger.error({ err }, "failed to set session time_zone to UTC");
  });
});

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    logger.error({ err }, "DB ping failed");
    return false;
  }
}
