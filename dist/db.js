"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
require("dotenv/config");
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to Postgres");
}
/**
 * A single shared pool avoids opening a new database connection per request.
 * The pool is imported and reused by the HTTP handlers.
 */
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: connectionString.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
});
