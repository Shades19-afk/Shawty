import "./env";

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to connect to Postgres");
}

/**
 * A single shared pool avoids opening a new database connection per request.
 * The pool is imported and reused by the HTTP handlers.
 */
export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : undefined,
});
