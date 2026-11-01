/**
 * Wrap a fetch handler with baseline security response headers.
 * @example
 * ```ts
 * const fetch = withSecurityHeaders(router.fetch);
 * ```
 */
export function withSecurityHeaders(
  handler: (req: Request) => Promise<Response>,
  headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'",
  },
): (req: Request) => Promise<Response> {
  return async (req) => {
    const response = await handler(req);
    const output = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) output.headers.set(name, value);
    return output;
  };
}
