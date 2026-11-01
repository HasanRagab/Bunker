import { Database } from "bun:sqlite";
import { createRepository } from "@2hasan2/bunker/data";
import { z } from "zod";

const db = new Database(":memory:", { create: true, strict: true });
db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)");

const users = createRepository(db, {
  table: "users",
  schema: z.object({ id: z.string(), name: z.string() }),
});
const inserted = users.insert({ id: "user-1", name: "Ada" });
const found = users.get("user-1");

void [inserted, found];
db.close();
