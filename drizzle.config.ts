import { defineConfig } from "drizzle-kit";

// Reads DATABASE_URL from the environment. `db:generate` produces SQL migrations
// from db/schema.ts without a live DB; `db:migrate`/`db:push` need a running
// Postgres (the local Supabase stack provides it).
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres",
  },
  strict: true,
});
