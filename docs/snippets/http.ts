import { z } from "zod";
import {
  composeApps,
  createClient,
  createTestApp,
  defineModule,
  pageSchema,
  paginateArray,
  parseUploads,
  rateLimit,
  Router,
  withCors,
  withSecurityHeaders,
  websocketRoute,
  bearerAuth,
  type BaseCtx,
} from "@2hasan2/bunker/http";
import { memoryRateLimit } from "@2hasan2/bunker/infra";

const user = z.object({ id: z.string(), name: z.string() });
const api = Router.create().get("/users/:id", {
  response: user,
  handler: ({ params }) => ({ id: params.id, name: "Ada" }),
});

const client = createClient("http://localhost:3000", api);
const result = await client.request("GET", "/users/:id", { params: { id: "u1" } });
const testApp = createTestApp(api);
const response = await testApp.req.get("/users/u1");
const openApiDocument = api.openAPI();
const page = pageSchema(user);
const paginated = paginateArray([{ id: "u1", name: "Ada" }], { limit: 20 });
const secureFetch = withSecurityHeaders(api.fetch);
const corsFetch = withCors(api.fetch, { origin: "https://app.example.test" });
const authenticate = bearerAuth(async () => ({ id: "u1" }));
const limitedApi = Router.create().use(authenticate).use(rateLimit<BaseCtx & { user: { id: string } }>({
  limit: 60,
  windowMs: 60_000,
  store: memoryRateLimit(),
  key: ({ user }) => user.id,
}));
const socketRoute = websocketRoute(z.object({ text: z.string() }), {
  message: (socket, message) => socket.send(message.text),
});
const uploaded = await parseUploads(new Request("http://localhost/upload"), { maxBytes: 1_000 });

const users = defineModule({
  name: "users",
  routes: (router) => router.get("/users", { handler: () => [] }),
});
const composed = composeApps(Router.create(), [{
  prefix: "/api",
  register: (router) => router.get("/users", { handler: () => [] }),
}]);

void [result, response, openApiDocument, page, paginated, secureFetch, corsFetch, limitedApi, socketRoute, uploaded, users, composed];
