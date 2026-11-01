# Data guide

The raw SQLite example is [`snippets/data.ts`](./snippets/data.ts).

## SQLite repositories

**What it does:** `openDatabase()` opens a strict Bun SQLite database and
returns a `Result`. `createRepository()` validates CRUD inputs and rows with a
Zod object schema; `withDatabase()` injects a database into HTTP context.

**When to use it:** Use the repository for small synchronous SQLite-backed
data access without adding an ORM.

**Example:**

```ts
import { Database } from "bun:sqlite";
import { createRepository } from "@2hasan2/bunker/data";
import { z } from "zod";

const db = new Database(":memory:", { create: true, strict: true });
db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
const users = createRepository(db, {
  table: "users",
  schema: z.object({ id: z.string(), name: z.string() }),
});
const inserted = users.insert({ id: "u1", name: "Ada" });
db.close();
```

**Gotchas:** Table and column names are identifiers, not values; the
repository validates them. SQL values are bound parameters. Close the database
during shutdown.

## Drizzle adapter

**What it does:** `@2hasan2/bunker/data/drizzle` wraps Drizzle's Bun SQLite
driver and migration runner with typed database helpers.

**When to use it:** Use Drizzle when you need schema-driven queries,
migrations, and ORM-level query composition. Install `drizzle-orm` and
`drizzle-zod` as optional peers.

**Example:** Define tables in your application, then pass them in the adapter's
`schema` option. Copy the checked [Drizzle snippet](./snippets/drizzle.ts).

**Gotchas:** Bunker does not bundle an application schema. Keep table
definitions and migrations in your application; import Drizzle only from the
`/data/drizzle` subpath.
