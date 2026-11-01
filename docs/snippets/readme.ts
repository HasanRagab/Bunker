import { z } from "zod";
import { Router, serve } from "@2hasan2/bunker/http";

const api = Router.create().get("/hello/:name", {
  response: z.object({ message: z.string() }),
  handler: ({ params }) => ({ message: `Hello, ${params.name}!` }),
});

serve(api.fetch, { port: 3000 });
