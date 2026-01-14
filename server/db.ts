import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// ✅ OPTIMASI: Connection pool configuration
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Max 20 connections
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Timeout after 10s
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// ✅ Error handling untuk pool
pool.on('error', (err) => {
  console.error('❌ Unexpected DB pool error:', err);
});

pool.on('connect', () => {
  console.log('✅ New DB connection established');
});

// ✅ Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔴 SIGTERM received, closing DB pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔴 SIGINT received, closing DB pool...');
  await pool.end();
  process.exit(0);
});

export const db = drizzle(pool, { schema });