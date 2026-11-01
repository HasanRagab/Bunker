/**
 * Create a string-keyed service container.
 * @deprecated Use {@link defineService} and {@link createServiceRegistry} instead.
 * @example
 * ```ts
 * const services = createContainer({ logger: createLogger() });
 * const logger = services.get("logger");
 * ```
 */
export function createContainer<Services extends Record<string, unknown>>(services: Services) {
  const values = new Map<string, unknown>(Object.entries(services));
  return {
    get<Key extends keyof Services>(key: Key): Services[Key] {
      if (!values.has(String(key))) throw new Error(`Service not registered: ${String(key)}`);
      return values.get(String(key)) as Services[Key];
    },
    has(key: keyof Services): boolean {
      return values.has(String(key));
    },
    provide<Key extends string, Value>(key: Key, value: Value) {
      if (values.has(key)) throw new Error(`Service already registered: ${key}`);
      values.set(key, value);
      return this as typeof this & { get(key: Key): Value };
    },
  };
}
