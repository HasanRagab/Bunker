import type { z } from "zod";
import { createLogger, type Logger } from "../core/logger";
import type { Awaitable } from "../core/types";

/** Map event names to Zod payload schemas.
 * @example
 * ```ts
 * const schemas: EventSchemas = { "user.created": z.object({ id: z.string() }) };
 * ```
 */
export type EventSchemas = Record<string, z.ZodType>;

/** Infer event payload types from their Zod schemas.
 * @example
 * ```ts
 * type Events = EventPayloads<{ "user.created": typeof userSchema }>;
 * ```
 */
export type EventPayloads<Schemas extends EventSchemas> = { [K in keyof Schemas]: z.output<Schemas[K]> };

/** Typed publish/subscribe contract for event drivers.
 * @example
 * ```ts
 * const events: PubSub<{ "user.created": { id: string } }> = memoryPubSub(schemas);
 * ```
 */
export interface PubSub<Events extends { [K in keyof Events]: unknown }> {
  publish<K extends keyof Events>(event: K, payload: Events[K]): Promise<void>;
  subscribe<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => Awaitable<void>,
  ): Promise<() => Promise<void>>;
}

/**
 * An in-process pub/sub driver with the same validation contract as Redis.
 * @example
 * ```ts
 * const events = new MemoryPubSub({ "user.created": z.object({ id: z.string() }) });
 * ```
 */
export class MemoryPubSub<Events extends EventSchemas> implements PubSub<EventPayloads<Events>> {
  #listeners = new Map<keyof Events, Set<(payload: unknown) => Awaitable<void>>>();

  constructor(
    private readonly schemas: Events,
    private readonly logger: Logger = createLogger(),
  ) {}

  async publish<K extends keyof Events>(event: K, payload: EventPayloads<Events>[K]): Promise<void> {
    const schema = this.schemas[event];
    if (!schema) throw new Error(`No schema registered for event: ${String(event)}`);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw parsed.error;
    await Promise.all([...(this.#listeners.get(event) ?? [])].map(async (listener) => {
      try {
        await listener(parsed.data);
      } catch (cause) {
        this.logger.error("Memory pub/sub handler failed", { event: String(event), error: asError(cause) });
      }
    }));
  }

  async subscribe<K extends keyof Events>(
    event: K,
    listener: (payload: EventPayloads<Events>[K]) => Awaitable<void>,
  ): Promise<() => Promise<void>> {
    if (!this.schemas[event]) throw new Error(`No schema registered for event: ${String(event)}`);
    const listeners = this.#listeners.get(event) ?? new Set<(payload: unknown) => Awaitable<void>>();
    const wrapped = listener as (payload: unknown) => Awaitable<void>;
    listeners.add(wrapped);
    this.#listeners.set(event, listeners);
    return async () => {
      listeners.delete(wrapped);
      if (listeners.size === 0) this.#listeners.delete(event);
    };
  }
}

/**
 * Create a process-local typed pub/sub driver.
 * @example
 * ```ts
 * const events = memoryPubSub({ "user.created": z.object({ id: z.string() }) });
 * ```
 */
export function memoryPubSub<Events extends EventSchemas>(
  schemas: Events,
  logger?: Logger,
): MemoryPubSub<Events> {
  return new MemoryPubSub(schemas, logger);
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
