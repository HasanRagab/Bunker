export function serve(
  fetch: (req: Request) => Promise<Response>,
  opts: { port?: number; reusePort?: boolean } = {},
) {
  return Bun.serve({ port: opts.port ?? 3000, reusePort: opts.reusePort ?? false, fetch });
}
