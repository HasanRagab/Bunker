declare const serviceValue: unique symbol;

/**
 * A typed key for a shared application service.
 * @example
 * ```ts
 * const userRepository = defineService<UserRepository>("userRepository");
 * ```
 */
export interface ServiceToken<Value> {
  readonly name: string;
  readonly key: symbol;
  readonly [serviceValue]?: Value;
}

type AnyServiceToken = ServiceToken<unknown>;
type TokenValue<Token> = Token extends ServiceToken<infer Value> ? Value : never;

/**
 * Define a typed service token.
 * @example
 * ```ts
 * const userRepository = defineService<UserRepository>("userRepository");
 * ```
 */
export function defineService<Value>(name: string): ServiceToken<Value> {
  if (!name.trim()) throw new TypeError("Service token name must not be empty; provide a descriptive name.");
  return Object.freeze({ name, key: Symbol(name) }) as ServiceToken<Value>;
}

/**
 * Create an isolated typed service registry.
 * @example
 * ```ts
 * const services = createServiceRegistry();
 * services.provide(userRepository, repository);
 * const repositoryForRoutes = services.resolve(userRepository);
 * ```
 */
export function createServiceRegistry() {
  const values = new Map<symbol, unknown>();
  return {
    provide<Token extends AnyServiceToken>(token: Token, value: TokenValue<Token>): void {
      if (values.has(token.key)) throw new Error(`Service "${token.name}" is already provided.`);
      values.set(token.key, value);
    },
    resolve<Token extends AnyServiceToken>(token: Token): TokenValue<Token> {
      if (!values.has(token.key)) {
        throw new Error(`Service "${token.name}" is missing; provide it with registry.provide(token, value) before resolving it.`);
      }
      return values.get(token.key) as TokenValue<Token>;
    },
    has(token: AnyServiceToken): boolean {
      return values.has(token.key);
    },
    clear(): void {
      values.clear();
    },
  };
}
