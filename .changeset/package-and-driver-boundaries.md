---
"@2hasan2/bunker": major
---

Move Drizzle APIs to `@2hasan2/bunker/data/drizzle`, make Drizzle integrations optional peers, and standardize built-in Redis key prefixes from `kit:` to `bunker:`. Existing keys written under `kit:` are not migrated automatically; set an explicit legacy prefix where continued access is needed.
