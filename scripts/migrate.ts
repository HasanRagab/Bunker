import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { createDrizzleDatabase, migrateDatabase } from "../src/db/drizzle";
import { defineEnv } from "../src/env";
import { z } from "zod";

const env = defineEnv({
  DATABASE_URL: z.string().default("./data/app.sqlite"),
  DRIZZLE_MIGRATIONS_FOLDER: z.string().default("./drizzle"),
});

mkdirSync(dirname(env.DATABASE_URL), { recursive: true });
const client = new Database(env.DATABASE_URL, { create: true, strict: true });
try {
  const db = createDrizzleDatabase(client);
  const result = migrateDatabase(db, env.DRIZZLE_MIGRATIONS_FOLDER);
  if (!result.ok) throw result.error;
  console.info("Database migrations applied", {
    database: env.DATABASE_URL,
    migrationsFolder: env.DRIZZLE_MIGRATIONS_FOLDER,
  });
} finally {
  client.close();
}
