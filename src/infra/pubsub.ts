import type { z } from "zod";
import type { Awaitable } from "../core/types";

export type EventSchemas = Record<string, z.ZodType>;
export type EventPayloads<Schemas extends EventSchemas> = { [K in keyof Schemas]: z.output<Schemas[K]> };

export interface PubSub<Events extends { [K in keyof Events]: unknown }> {
  publish<K extends keyof Events>(event: K, payload: Events[K]): Promise<void>;
  subscribe<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => Awaitable<void>,
  ): Promise<() => Promise<void>>;
}
