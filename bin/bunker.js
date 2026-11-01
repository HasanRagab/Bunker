#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [command, kind, requestedName] = process.argv.slice(2);
if (command !== "generate" || kind !== "module" || !requestedName ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(requestedName)) {
  console.error("Usage: bunker generate module <name> (lowercase letters, numbers, and hyphens)");
  process.exitCode = 1;
} else {
  const moduleDirectory = join(process.cwd(), "src", "modules");
  const modulePath = join(moduleDirectory, `${requestedName}.ts`);
  const identifier = requestedName.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
  const exportName = `${identifier}Module`;
  const source = `import { defineModule } from "@2hasan2/bunker/http";

export const ${exportName} = defineModule({
  name: "${requestedName}",
  prefix: "/${requestedName}",
  routes: (router) => router.get("/", {
    handler: () => ({ items: [] }),
  }),
});
`;

  try {
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(modulePath, source, { flag: "wx" });
    console.log(`Created ${modulePath}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      console.error(`Cannot generate ${requestedName}: ${modulePath} already exists. Choose another module name.`);
    } else {
      console.error(`Could not generate ${requestedName}: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  }
}
