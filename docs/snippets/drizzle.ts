import { Database } from "bun:sqlite";
import { createDrizzleDatabase } from "@2hasan2/bunker/data/drizzle";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});
const sqlite = new Database(":memory:", { create: true, strict: true });
const database = createDrizzleDatabase(sqlite, { schema: { users } });

void database;
sqlite.close();
