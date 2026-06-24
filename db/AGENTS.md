# Instructions for Codex in `db/`

<!-- sphere-agents-standard:start -->

## Scope

This directory owns local SQLite schema and hosted/Postgres compatibility
migrations. Inherit the repository root `AGENTS.md`; this file adds database
rules only.

## Required Boundaries

- `db/local-sqlite-schema.sql` is the desktop local-first schema.
- `db/migrations/` is for hosted/Postgres compatibility.
- Keep SQLite/local storage first-class for desktop routes and packaged app
  behavior.
- Use migrations and schema updates intentionally. Do not silently change data
  shape without updating the relevant local-first code paths and documentation
  evidence.
- Do not run hosted database push/migrate/generate commands against production
  or user databases unless the Human Request explicitly authorizes that exact
  external mutation.

## Commands

Supported commands from `package.json`:

```bash
npm run local:db:schema
npm run db:generate
npm run db:migrate
npm run db:push
```

The `db:*` commands are hosted/Drizzle-oriented. Treat them as mutation-capable
and stop unless the Human Request explicitly covers their use. `local:db:schema`
prints local schema information and is appropriate for local inspection.

## Evidence

For schema work, report affected tables/columns, migration/local schema files,
commands run, and whether local-first SQLite behavior was verified.

<!-- sphere-agents-standard:end -->

