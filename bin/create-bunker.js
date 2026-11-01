#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectName = process.argv[2];
if (!projectName || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectName)) {
  console.error("Usage: create-bunker <project-name> (lowercase letters, numbers, and hyphens)");
  process.exitCode = 1;
} else {
  const projectPath = resolve(process.cwd(), projectName);
  const templatePath = fileURLToPath(new URL("../templates/bunker/", import.meta.url));

  try {
    await mkdir(projectPath);
    await cp(templatePath, projectPath, { recursive: true });
    const packagePath = join(projectPath, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    packageJson.name = projectName;
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    console.log(`Created ${projectName}. Next: cd ${projectName} && bun install && bun run dev`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      console.error(`Cannot create ${projectName}: that path already exists. Choose a new project name.`);
    } else {
      console.error(`Could not create ${projectName}: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  }
}
