import { defineModule } from "@2hasan2/bunker/http";

export const userProfilesModule = defineModule({
  name: "user-profiles",
  prefix: "/user-profiles",
  routes: (router) => router.get("/", {
    handler: () => ({ items: [] }),
  }),
});
