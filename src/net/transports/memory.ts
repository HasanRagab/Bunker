import { assertServiceName } from "../registry";

/**
 * Register and call fetch handlers directly in one process.
 * @example
 * ```ts
 * const transport = new MemoryServiceTransport();
 * const unregister = transport.register("catalog", async () => Response.json({ ok: true }));
 * ```
 */
export class MemoryServiceTransport {
  #handlers = new Map<string, (request: Request) => Promise<Response>>();

  register(name: string, handler: (request: Request) => Promise<Response>): () => void {
    assertServiceName(name);
    if (this.#handlers.has(name)) throw new Error(`Memory service already registered: ${name}`);
    this.#handlers.set(name, handler);
    return () => {
      if (this.#handlers.get(name) === handler) this.#handlers.delete(name);
    };
  }

  async fetch(name: string, request: Request): Promise<Response> {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Memory service not found: ${name}`);
    return handler(request);
  }
}

/**
 * Create a fetcher for a handler registered on a memory transport.
 * @example
 * ```ts
 * const fetcher = createMemoryServiceFetcher(transport, "catalog");
 * ```
 */
export function createMemoryServiceFetcher(
  transport: MemoryServiceTransport,
  name: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  assertServiceName(name);
  return async (input, init) => {
    const request = input instanceof Request
      ? input
      : new Request(new URL(input.toString(), "http://memory.local").toString(), init);
    return transport.fetch(name, request);
  };
}
