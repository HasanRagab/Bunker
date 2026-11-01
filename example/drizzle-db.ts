import { eq } from "drizzle-orm";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createDrizzleDatabase,
  insertUserSchema,
  migrateDatabase,
  posts,
  schema,
  updateUserSchema,
  users,
  withDrizzleDatabase,
} from "../src";
import { Router, type BunSQLiteDatabase } from "../src";
import { z } from "zod";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

export function createAppDatabase(path = "./data/app.sqlite") {
  mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, strict: true });
  const db = createDrizzleDatabase(client, { schema });
  return { db, close: () => client.close() };
}

export function migrateAppDatabase(path = "./data/app.sqlite", migrationsFolder = "./drizzle") {
  mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, { create: true, strict: true });
  try {
    const db = createDrizzleDatabase(client, { schema });
    const result = migrateDatabase(db, migrationsFolder);
    if (!result.ok) throw result.error;
  } finally {
    client.close();
  }
}

export function insertUser(
  db: AppDatabase,
  input: unknown,
) {
  const user = insertUserSchema.parse(input);
  return db.insert(users).values(user).returning().get();
}

export function updateUser(
  db: AppDatabase,
  id: string,
  patch: unknown,
) {
  const update = updateUserSchema.parse(patch);
  return db.update(users).set(update).where(eq(users.id, id)).returning().get();
}

export function listUserPosts(
  db: AppDatabase,
  userId: string,
) {
  return db.query.posts.findMany({
    where: eq(posts.authorId, userId),
    with: { author: true },
  });
}

export function usersRouter(db: AppDatabase) {
  return Router.create()
    .use(withDrizzleDatabase(db))
    .post("/users", {
      body: insertUserSchema,
      response: z.object({ id: z.string(), name: z.string(), email: z.email(), createdAt: z.date() }),
      handler: ({ db: contextDb, body }) => contextDb.insert(users).values(body).returning().get(),
    });
}
