import { defineConfig } from "drizzle-kit";

// Hosted/web Postgres compatibility. The desktop product uses embedded SQLite
// through db/local-sqlite-schema.sql and lib/local/database.ts.
// `db:generate` produces SQL migrations from db/schema.ts without a live DB;
// `db:migrate`/`db:push` need a running Postgres database.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres",
  },
  strict: true,
});
