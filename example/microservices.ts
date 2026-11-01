import { z } from "zod";
import {
  composeApps,
  createServiceClient,
  MemoryServiceTransport,
  Router,
  serveTcpService,
  type BaseCtx,
  type RouteMap,
  type ServiceRegistry,
} from "../src";

const CatalogItem = z.object({ id: z.string(), name: z.string() });
const catalogModule = <C extends BaseCtx, Routes extends RouteMap, Prefix extends string>(router: Router<C, Routes, Prefix>) => {
  router.get("/items/:id", {
    response: CatalogItem,
    handler: ({ params }) => ({ id: params.id, name: "Example item" }),
  });
};

export function createCombinedBackend() {
  return composeApps(Router.create(), [
    { prefix: "/catalog", register: catalogModule },
    {
      prefix: "/health-info",
      register: (router) => router.get("/", { handler: () => ({ status: "ok" }) }),
    },
  ]);
}

export function createInProcessCatalog() {
  const service = Router.create().get("/items/:id", {
    response: CatalogItem,
    handler: ({ params }) => ({ id: params.id, name: "In-process item" }),
  });
  const transport = new MemoryServiceTransport();
  const unregister = transport.register("catalog", service.fetch);
  return { transport, unregister };
}

export async function startTcpCatalog(
  registry: ServiceRegistry,
  options: { host?: string; advertiseHost?: string; port: number },
) {
  const service = Router.create().get("/items/:id", {
    response: CatalogItem,
    handler: ({ params }) => ({ id: params.id, name: "Remote item" }),
  });
  const server = await serveTcpService(service.fetch, options);
  let registration;
  try {
    const advertiseHost = options.advertiseHost ?? server.host;
    registration = await registry.register({
      name: "catalog",
      instanceId: crypto.randomUUID(),
      endpoint: `tcp://${advertiseHost}:${server.port}`,
      transport: "tcp",
    });
  } catch (cause) {
    await server.close();
    throw cause;
  }
  return async () => {
    await registration.close();
    await server.close();
  };
}

export async function requestCatalogItem(registry: ServiceRegistry, id: string) {
  const catalog = createServiceClient(registry, "catalog");
  const response = await catalog.fetch(new Request(`http://catalog/items/${encodeURIComponent(id)}`));
  if (!response.ok) throw new Error(`Catalog service returned HTTP ${response.status}`);
  const parsed = CatalogItem.safeParse(await response.json());
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}
