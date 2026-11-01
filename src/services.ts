import { createConnection, createServer, type Socket, type Server } from "node:net";
import type { BaseCtx, RouteMap, Router } from "./http/router";
import { createClient } from "./http/client";
import type { RedisClient } from "./redis";

export interface ServiceInstance {
  readonly name: string;
  readonly instanceId: string;
  readonly endpoint: string;
  readonly transport: "http" | "tcp";
}

export interface ServiceRegistration {
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export interface ServiceRegistry {
  register(instance: ServiceInstance, options?: { ttlMs?: number; heartbeatMs?: number }): Promise<ServiceRegistration>;
  discover(name: string): Promise<ServiceInstance[]>;
}

export function createServiceClient(
  registry: ServiceRegistry,
  name: string,
  options: { timeoutMs?: number; maxFrameBytes?: number } = {},
): { fetch(request: Request): Promise<Response>; discover(): Promise<ServiceInstance[]> } {
  validateServiceName(name);
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

export function createDiscoveredClient<C extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  registry: ServiceRegistry,
  name: string,
  router: Router<C, Routes, Prefix>,
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

export class MemoryServiceRegistry implements ServiceRegistry {
  #instances = new Map<string, Map<string, { instance: ServiceInstance; expiresAt: number }>>();

  async register(instance: ServiceInstance, options: { ttlMs?: number; heartbeatMs?: number } = {}): Promise<ServiceRegistration> {
    const ttlMs = options.ttlMs ?? 30_000;
    const heartbeatMs = options.heartbeatMs ?? Math.floor(ttlMs / 3);
    validateRegistration(instance, ttlMs, heartbeatMs);
    let active = true;
    const save = async () => {
      if (!active) throw new Error("Service registration is closed");
      const entries = this.#instances.get(instance.name) ?? new Map();
      entries.set(instance.instanceId, { instance, expiresAt: Date.now() + ttlMs });
      this.#instances.set(instance.name, entries);
    };
    await save();
    const timer = setInterval(() => {
      void save().catch((cause) => console.error("Service registry heartbeat failed", cause));
    }, heartbeatMs);
    timer.unref();
    return {
      refresh: save,
      close: async () => {
        if (!active) return;
        active = false;
        clearInterval(timer);
        const entries = this.#instances.get(instance.name);
        entries?.delete(instance.instanceId);
        if (entries?.size === 0) this.#instances.delete(instance.name);
      },
    };
  }

  async discover(name: string): Promise<ServiceInstance[]> {
    const entries = this.#instances.get(name);
    if (!entries) return [];
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(id);
    }
    if (entries.size === 0) {
      this.#instances.delete(name);
      return [];
    }
    return [...entries.values()].map(({ instance }) => instance);
  }
}

export class RedisServiceRegistry implements ServiceRegistry {
  constructor(private readonly redis: RedisClient, private readonly prefix = "kit:services:") {}

  async register(instance: ServiceInstance, options: { ttlMs?: number; heartbeatMs?: number } = {}): Promise<ServiceRegistration> {
    const ttlMs = options.ttlMs ?? 30_000;
    const heartbeatMs = options.heartbeatMs ?? Math.floor(ttlMs / 3);
    validateRegistration(instance, ttlMs, heartbeatMs);
    const key = this.key(instance.name);
    const member = JSON.stringify(instance);
    let active = true;
    const refresh = async () => {
      if (!active) throw new Error("Service registration is closed");
      const expiresAt = Date.now() + ttlMs;
      const result = await this.redis.eval(REGISTRY_UPSERT, {
        keys: [key],
        arguments: [String(expiresAt), member],
      });
      if (Number(result) !== 1) throw new Error("Redis service registry heartbeat failed");
    };
    await refresh();
    const timer = setInterval(() => {
      void refresh().catch((cause) => console.error("Redis service registry heartbeat failed", cause));
    }, heartbeatMs);
    timer.unref();
    return {
      refresh,
      close: async () => {
        if (!active) return;
        active = false;
        clearInterval(timer);
        await this.redis.eval(REGISTRY_REMOVE, {
          keys: [key],
          arguments: [member],
        });
      },
    };
  }

  async discover(name: string): Promise<ServiceInstance[]> {
    validateServiceName(name);
    const key = this.key(name);
    const result = await this.redis.eval(REGISTRY_DISCOVER, {
      keys: [key],
      arguments: [String(Date.now())],
    });
    if (!Array.isArray(result)) throw new Error("Invalid Redis service registry response");
    return result.map(parseServiceInstance);
  }

  private key(name: string): string {
    validateServiceName(name);
    return `${this.prefix}{${name}}`;
  }
}

export class MemoryServiceTransport {
  #handlers = new Map<string, (request: Request) => Promise<Response>>();

  register(name: string, handler: (request: Request) => Promise<Response>): () => void {
    validateServiceName(name);
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

export function createMemoryServiceFetcher(
  transport: MemoryServiceTransport,
  name: string,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  validateServiceName(name);
  return async (input, init) => {
    const request = input instanceof Request
      ? input
      : new Request(new URL(input.toString(), "http://memory.local").toString(), init);
    return transport.fetch(name, request);
  };
}

export function createHttpServiceFetcher(endpoint: string): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const base = new URL(endpoint);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new TypeError("HTTP service endpoints must use http or https");
  return async (input, init) => {
    const source = input instanceof Request ? input : new Request(new URL(input.toString(), base).toString(), init);
    const sourceUrl = new URL(source.url);
    const target = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, base);
    const body = source.method === "GET" || source.method === "HEAD"
      ? undefined
      : await source.arrayBuffer();
    return fetch(new Request(target.toString(), {
      method: source.method,
      headers: source.headers,
      signal: source.signal,
      ...(body === undefined ? {} : { body }),
    }));
  };
}

export interface TcpServiceServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

interface TcpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: [string, string][];
  readonly body: string | null;
}

interface TcpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: [string, string][];
  readonly body: string | null;
}

const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;

export async function serveTcpService(
  handler: (request: Request) => Promise<Response>,
  options: { host?: string; port: number; timeoutMs?: number; maxFrameBytes?: number },
): Promise<TcpServiceServer> {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new RangeError("TCP timeout must be positive");
  validateFrameLimit(maxFrameBytes);
  const server = createServer((socket) => {
    socket.setTimeout(timeoutMs, () => socket.destroy());
    void handleTcpSocket(socket, handler, maxFrameBytes);
  });
  server.on("error", (error) => console.error("TCP service server error", error));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, host);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("TCP service failed to bind to a network address");
  }
  return {
    host,
    port: address.port,
    close: () => closeServer(server),
  };
}

export function createTcpServiceFetcher(
  endpoint: string,
  options: { timeoutMs?: number; maxFrameBytes?: number } = {},
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const address = new URL(endpoint);
  if (address.protocol !== "tcp:") throw new TypeError("TCP service endpoints must use tcp");
  const port = Number(address.port);
  if (!address.hostname || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("TCP service endpoint must include a host and valid port");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new RangeError("TCP timeout must be positive");
  validateFrameLimit(maxFrameBytes);

  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(input.toString(), address).toString(), init);
    const body = request.method === "GET" || request.method === "HEAD"
      ? null
      : toBase64(new Uint8Array(await request.arrayBuffer()));
    const payload: TcpRequest = {
      method: request.method,
      url: `${address.protocol === "tcp:" ? "http:" : address.protocol}//${address.host}${new URL(request.url).pathname}${new URL(request.url).search}`,
      headers: [...request.headers],
      body,
    };
    const encoded = encodeFrame(payload);
    if (encoded.byteLength - 4 > maxFrameBytes) throw new RangeError("TCP service request exceeds maximum frame size");

    const socket = createConnection({ host: address.hostname, port });
    socket.setTimeout(timeoutMs);
    try {
      const response = await exchangeFrame(socket, encoded, maxFrameBytes);
      if (response.body === null) return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
      return new Response(fromBase64(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      socket.destroy();
    }
  };
}

export function composeApps<C extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  router: Router<C, Routes, Prefix>,
  apps: readonly { readonly prefix: string; readonly register: (router: Router<any, any, any>) => unknown }[],
): Router<C, Routes, Prefix> {
  for (const app of apps) {
    if (!app.prefix.startsWith("/")) throw new TypeError(`App prefix must start with "/": ${app.prefix}`);
    app.register(router.group(app.prefix));
  }
  return router;
}

async function handleTcpSocket(
  socket: Socket,
  handler: (request: Request) => Promise<Response>,
  maxFrameBytes: number,
): Promise<void> {
  try {
    const payload = await readFrame<TcpRequest>(socket, maxFrameBytes);
    const body = payload.body === null ? undefined : fromBase64(payload.body);
    const request = new Request(payload.url, {
      method: payload.method,
      headers: payload.headers,
      ...(body === undefined || payload.method === "GET" || payload.method === "HEAD" ? {} : { body }),
    });
    const response = await handler(request);
    const responseBody = response.body === null ? null : toBase64(new Uint8Array(await response.arrayBuffer()));
    const responsePayload: TcpResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers].filter(([name]) => name.toLowerCase() !== "content-length"),
      body: responseBody,
    };
    const frame = encodeFrame(responsePayload);
    if (frame.byteLength - 4 > maxFrameBytes) {
      socket.end(encodeFrame({
        status: 502,
        statusText: "Bad Gateway",
        headers: [["content-type", "application/json"]],
        body: toBase64(new TextEncoder().encode(JSON.stringify({ error: "TCP service response exceeds maximum frame size" }))),
      } satisfies TcpResponse));
      return;
    }
    socket.end(frame);
  } catch {
    if (!socket.destroyed) {
      const payload: TcpResponse = {
        status: 500,
        statusText: "Internal Server Error",
        headers: [["content-type", "application/json"]],
        body: toBase64(new TextEncoder().encode(JSON.stringify({ error: "TCP service request failed" }))),
      };
      socket.end(encodeFrame(payload));
    }
  }
}

function exchangeFrame(socket: Socket, frame: Uint8Array, maxFrameBytes: number): Promise<TcpResponse> {
  return new Promise((resolve, reject) => {
    let buffer = new Uint8Array(0);
    let settled = false;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
      socket.off("end", onEnd);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Uint8Array) => {
      const next = new Uint8Array(buffer.length + chunk.length);
      next.set(buffer);
      next.set(chunk, buffer.length);
      buffer = next;
      if (buffer.length >= 4) {
        const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0);
        if (length > maxFrameBytes) return fail(new RangeError("TCP service response exceeds maximum frame size"));
        if (buffer.length >= length + 4) {
          try {
            const text = new TextDecoder().decode(buffer.subarray(4, length + 4));
            const response = parseTcpResponse(JSON.parse(text));
            settled = true;
            cleanup();
            resolve(response);
          } catch (cause) {
            fail(asError(cause));
          }
        }
      }
    };
    const onError = (error: Error) => fail(error);
    const onTimeout = () => fail(new Error("TCP service request timed out"));
    const onEnd = () => fail(new Error("TCP service closed before returning a response"));
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.once("end", onEnd);
    socket.once("connect", () => socket.end(frame));
  });
}

function readFrame<T>(socket: Socket, maxFrameBytes: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let buffer = new Uint8Array(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Uint8Array) => {
      const next = new Uint8Array(buffer.length + chunk.length);
      next.set(buffer);
      next.set(chunk, buffer.length);
      buffer = next;
      if (buffer.length < 4) return;
      const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0);
      if (length > maxFrameBytes) {
        cleanup();
        reject(new RangeError("TCP service request exceeds maximum frame size"));
        return;
      }
      if (buffer.length < length + 4) return;
      cleanup();
      try {
        resolve(JSON.parse(new TextDecoder().decode(buffer.subarray(4, length + 4))) as T);
      } catch (cause) {
        reject(asError(cause));
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function encodeFrame(value: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const frame = new Uint8Array(body.length + 4);
  new DataView(frame.buffer).setUint32(0, body.length);
  frame.set(body, 4);
  return frame;
}

function parseTcpResponse(value: unknown): TcpResponse {
  if (typeof value !== "object" || value === null || !("status" in value) || typeof value.status !== "number" ||
      !("statusText" in value) || typeof value.statusText !== "string" ||
      !("headers" in value) || !Array.isArray(value.headers) ||
      !("body" in value) || !(typeof value.body === "string" || value.body === null)) {
    throw new Error("Invalid TCP service response");
  }
  return value as TcpResponse;
}

function parseServiceInstance(value: unknown): ServiceInstance {
  if (typeof value === "string") {
    try {
      return parseServiceInstance(JSON.parse(value));
    } catch (cause) {
      throw new Error("Invalid service instance record", { cause });
    }
  }
  if (typeof value !== "object" || value === null ||
      !("name" in value) || typeof value.name !== "string" ||
      !("instanceId" in value) || typeof value.instanceId !== "string" ||
      !("endpoint" in value) || typeof value.endpoint !== "string" ||
      !("transport" in value) || (value.transport !== "http" && value.transport !== "tcp")) {
    throw new Error("Invalid service instance record");
  }
  return value as ServiceInstance;
}

function validateRegistration(instance: ServiceInstance, ttlMs: number, heartbeatMs: number): void {
  validateServiceName(instance.name);
  if (!instance.instanceId) throw new TypeError("Service instance ID must not be empty");
  if (instance.transport === "http") {
    const endpoint = new URL(instance.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new TypeError("Invalid HTTP service endpoint");
  } else {
    const endpoint = new URL(instance.endpoint);
    if (endpoint.protocol !== "tcp:" || !endpoint.hostname || !endpoint.port) throw new TypeError("Invalid TCP service endpoint");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 3) throw new RangeError("Service registry TTL must be at least 3ms");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1 || heartbeatMs >= ttlMs) {
    throw new RangeError("Heartbeat interval must be positive and shorter than the registration TTL");
  }
}

function validateServiceName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new TypeError(`Invalid service name: ${name}`);
}

function validateFrameLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("TCP frame limit must be a positive integer");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

const REGISTRY_UPSERT = `
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

const REGISTRY_DISCOVER = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '+inf')
`;

const REGISTRY_REMOVE = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;
