import { describe, expect, it } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const sourceRoot = resolve(import.meta.dir, "../src");
const importPattern = /\b(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === ".ts" ? [path] : [];
  }));
  return nested.flat();
}

function resolveImport(importer: string, specifier: string): string | undefined {
  const base = resolve(dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, resolve(base, "index.ts")];
  return candidates.find((candidate) => candidate.startsWith(`${sourceRoot}${sep}`) && candidate.endsWith(".ts"));
}

describe("source architecture", () => {
  it("keeps core independent and infra independent of HTTP", async () => {
    const files = await sourceFiles(sourceRoot);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        if (!specifier) continue;
        const target = resolveImport(file, specifier);
        if (!target) continue;
        const sourceGroup = relative(sourceRoot, file).split(sep)[0];
        const targetGroup = relative(sourceRoot, target).split(sep)[0];
        if (sourceGroup === "core") expect(targetGroup).toBe("core");
        if (sourceGroup === "infra") expect(targetGroup).not.toBe("http");
      }
    }
  });

  it("does not import example or test code from source", async () => {
    const files = await sourceFiles(sourceRoot);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        if (!specifier) continue;
        const target = resolve(dirname(file), specifier);
        expect(isAbsolute(relative(sourceRoot, target))).toBe(false);
        expect(relative(sourceRoot, target).split(sep)).not.toContain("example");
        expect(relative(sourceRoot, target).split(sep)).not.toContain("test");
      }
    }
  });

  it("contains no relative import cycles", async () => {
    const files = await sourceFiles(sourceRoot);
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const source = await readFile(file, "utf8");
      graph.set(file, [...source.matchAll(importPattern)]
        .flatMap((match) => {
          const specifier = match[1];
          return specifier ? [resolveImport(file, specifier)].filter((target): target is string => target !== undefined) : [];
        }));
    }

    const active = new Set<string>();
    const visited = new Set<string>();
    const visit = (file: string): void => {
      if (active.has(file)) throw new Error(`Import cycle includes ${relative(sourceRoot, file)}`);
      if (visited.has(file)) return;
      active.add(file);
      for (const dependency of graph.get(file) ?? []) visit(dependency);
      active.delete(file);
      visited.add(file);
    };
    for (const file of files) visit(file);
  });
});
