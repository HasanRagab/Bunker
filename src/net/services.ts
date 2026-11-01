import { createClient } from "../http/client";
import type { BaseCtx, RouteMap, Router } from "../http/router";
import type { ServiceRegistry } from "./registry";
import { createHttpServiceFetcher } from "./transports/http";
import { createTcpServiceFetcher } from "./transports/tcp";

/** Create a round-robin client for service instances discovered from a registry. */
export function createServiceClient(
  registry: ServiceRegistry,
  name: string,
  options: { timeoutMs?: number; maxFrameBytes?: number } = {},
): { fetch(request: Request): Promise<Response>; discover(): Promise<import("./registry").ServiceInstance[]> } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new TypeError(`Invalid service name: ${name}`);
  let next = 0;
  const transports = new Map<string, (input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
  return {
    discover: () => registry.discover(name),
    fetch: async (request) => {
      const instances = await registry.discover(name);
      if (instances.length === 0) throw new Error(`No healthy instances registered for service: ${name}`);
      const instance = instances[next++ % instances.length]!;
      const transportKey = `${instance.instanceId}\n${instance.transport}\n${instance.endpoint}`;
      let transport = transports.get(transportKey);
      if (!transport) {
        transport = instance.transport === "http"
          ? createHttpServiceFetcher(instance.endpoint)
          : createTcpServiceFetcher(instance.endpoint, options);
        transports.set(transportKey, transport);
      }
      return transport(request);
    },
  };
}

/** Create a typed API client that discovers a service instance for each request. */
export function createDiscoveredClient<Ctx extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  registry: ServiceRegistry,
  name: string,
  router: Router<Ctx, Routes, Prefix>,
  options: { timeoutMs?: number; maxFrameBytes?: number; headers?: RequestInit["headers"] } = {},
) {
  const service = createServiceClient(registry, name, options);
  return createClient("http://service.local", router, {
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    fetcher: (input, init) => service.fetch(
      input instanceof Request ? input : new Request(String(input), init),
    ),
  });
}
