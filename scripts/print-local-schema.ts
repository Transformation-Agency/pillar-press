import { readFileSync } from "node:fs";

process.stdout.write(readFileSync("db/local-sqlite-schema.sql", "utf8"));
