# Database guide

The toolkit supports SQLite through Bun and optional Drizzle ORM integration. It also
retains a small raw-SQL repository API for applications that prefer explicit
queries. Choose one API per feature rather than mixing both styles in the same
repository without a reason.

## Define tables once

Define your application's schema in its own module. Drizzle table definitions provide query types;
`drizzle-zod` derives runtime validation schemas from those same definitions.

```ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const insertNoteSchema = createInsertSchema(notes);
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
```

For relations, include the tables and relation declarations in the schema
object passed to Drizzle. This enables typed relational queries.

## Open and inject the database

```ts
import { Database } from "bun:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { createDrizzleDatabase, withDrizzleDatabase } from "@2hasan2/bunker/data/drizzle";
import { Router } from "@2hasan2/bunker/http";

const notes = sqliteTable("notes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});
const insertNoteSchema = createInsertSchema(notes);
const schema = { notes };

const client = new Database("./data/app.sqlite", { create: true, strict: true });
const db = createDrizzleDatabase(client, { schema });
const api = Router.create().use(withDrizzleDatabase(db)).post("/notes", {
  body: insertNoteSchema,
  handler: ({ db, body }) => db.insert(notes).values(body).returning().get(),
});
```

Register `client.close()` with your application's cleanup lifecycle. The
factory returns Drizzle's synchronous Bun SQLite database, so do not add
unnecessary `await` calls to local query methods.

## Generate and apply migrations

The example Drizzle Kit configuration reads `example/db/schema.ts` and writes
migrations to `example/drizzle/`. Copy the configuration into your application
and point it at your schema. Apply the generated directory through the matching
`migrationsFolder` argument to `migrateDatabase()`.

```sh
# After changing a table definition:
bun run db:generate

# Apply pending committed migrations to DATABASE_URL, or the default file:
bun run db:migrate
```

Review generated SQL before committing it. Commit the migration SQL and
Drizzle's metadata together with the schema change. `bun run db:migrate` applies
the checked-in migration directory; it does not generate migrations.

At deployment time, either run migrations as a one-off step before starting
new application instances or call `migrateDatabase(db, folder)` from a
controlled startup process. Do not have every web instance race migrations
unless startup is protected by a distributed lock. For rolling deployments,
use expand/contract migrations so old and new application versions can overlap.

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `./data/app.sqlite` | SQLite database file path |
| `DRIZZLE_MIGRATIONS_FOLDER` | `./example/drizzle` | Runtime migration directory |

Example:

```sh
DATABASE_URL=./data/dev.sqlite bun run db:migrate
```

The migration runner returns `Result<void, Error>` so callers can handle
failures explicitly. The CLI script fails the process when a migration fails.
The example schema is supplied as a starting point, not as the recommended
schema for every application.

## Raw Bun SQLite repository alternative

`openDatabase()` and `createRepository()` remain available for synchronous
Zod-backed CRUD. Use them when you want a small validated repository and are
comfortable managing the table DDL yourself. This API does not generate or run
Drizzle migrations. See the [reference repository example](./reference.md#sqlite-repositories-and-typed-orm)
and [`src/data/db/index.ts`](../src/data/db/index.ts).
