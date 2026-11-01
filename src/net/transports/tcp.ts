import { createConnection, createServer, type Socket, type Server } from "node:net";
import { createLogger, type Logger } from "../../core/logger";

/** Bound TCP service and its cleanup handle.
 * @example
 * ```ts
 * const server: TcpServiceServer = await serveTcpService(api.fetch, { port: 4000 });
 * await server.close();
 * ```
 */
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

/**
 * Serve a fetch handler over the toolkit's framed TCP transport.
 * @example
 * ```ts
 * const server = await serveTcpService(api.fetch, { host: "127.0.0.1", port: 4000 });
 * ```
 */
export async function serveTcpService(
  handler: (request: Request) => Promise<Response>,
  options: { host?: string; port: number; timeoutMs?: number; maxFrameBytes?: number; logger?: Logger },
): Promise<TcpServiceServer> {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const logger = options.logger ?? createLogger();
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new RangeError("TCP timeout must be positive");
  validateFrameLimit(maxFrameBytes);
  const server = createServer((socket) => {
    socket.setTimeout(timeoutMs, () => socket.destroy());
    void handleTcpSocket(socket, handler, maxFrameBytes);
  });
  server.on("error", (error) => logger.error("TCP service server error", { error }));
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

/**
 * Create a fetcher for a TCP service endpoint.
 * @example
 * ```ts
 * const fetcher = createTcpServiceFetcher("tcp://127.0.0.1:4000");
 * ```
 */
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
