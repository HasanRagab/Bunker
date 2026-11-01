import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const createBunker = fileURLToPath(new URL("../bin/create-bunker.js", import.meta.url));
const bunker = fileURLToPath(new URL("../bin/bunker.js", import.meta.url));

describe("scaffold commands", () => {
  it("creates a runnable project with the requested package name", async () => {
    const root = await mkdtemp(join(tmpdir(), "bunker-scaffold-"));
    try {
      const created = spawnSync(process.execPath, [createBunker, "my-api"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(created.status).toBe(0);
      const packageJson = JSON.parse(await readFile(join(root, "my-api", "package.json"), "utf8"));
      expect(packageJson.name).toBe("my-api");
      expect(await readFile(join(root, "my-api", "src", "main.ts"), "utf8")).toContain("createApp");

      const duplicate = spawnSync(process.execPath, [createBunker, "my-api"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(duplicate.status).toBe(1);
      expect(duplicate.stderr).toContain("that path already exists");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates a typed route module and rejects invalid names", async () => {
    const root = await mkdtemp(join(tmpdir(), "bunker-module-"));
    try {
      const generated = spawnSync(process.execPath, [bunker, "generate", "module", "user-profiles"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(generated.status).toBe(0);
      const source = await readFile(join(root, "src", "modules", "user-profiles.ts"), "utf8");
      expect(source).toContain('name: "user-profiles"');
      expect(source).toContain("routes: (router) => router.get");

      const invalid = spawnSync(process.execPath, [bunker, "generate", "module", "../escape"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("Usage: bunker generate module");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
