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
