/**
 * Start a Bun HTTP server with a fetch-compatible handler.
 * @example
 * ```ts
 * const server = serve(api.fetch, { port: 3000 });
 * ```
 */
export function serve(
  fetch: (req: Request) => Promise<Response>,
  opts: { port?: number; reusePort?: boolean } = {},
) {
  return Bun.serve({ port: opts.port ?? 3000, reusePort: opts.reusePort ?? false, fetch });
}
