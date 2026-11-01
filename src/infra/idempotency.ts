import { HttpError } from "../core/errors";
import type { CacheStore } from "./cache";

interface StoredResponse {
  readonly state: "pending" | "complete";
  readonly requestDigest: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export function withIdempotency(
  handler: (request: Request) => Promise<Response>,
  store: CacheStore,
  options: {
    ttlMs?: number;
    headerName?: string;
    keyPrefix?: string;
    scope?: (request: Request) => string | Promise<string>;
  } = {},
): (request: Request) => Promise<Response> {
  const { ttlMs = 86_400_000, headerName = "idempotency-key", keyPrefix = "bunker:idempotency:", scope } = options;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("Idempotency TTL must be positive");

  return async (request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-request-id", requestId);
    const routedRequest = new Request(request, { headers: requestHeaders });
    const withRequestId = (response: Response) => {
      const output = new Response(response.body, response);
      output.headers.set("x-request-id", requestId);
      return output;
    };
    if (!["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) return withRequestId(await handler(routedRequest));
    const idempotencyKey = request.headers.get(headerName);
    if (!idempotencyKey) return withRequestId(await handler(routedRequest));
    if (idempotencyKey.length > 200 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
      throw HttpError.badRequest("Invalid Idempotency-Key header");
    }

    const requestBody = new Uint8Array(await request.clone().arrayBuffer());
    const url = new URL(request.url);
    const authorization = request.headers.get("authorization") ?? "anonymous";
    const scopeKey = scope ? await scope(request) : authorization;
    const requestDigest = await digest(
      `${request.method.toUpperCase()}\n${url.pathname}${url.search}\n${request.headers.get("content-type") ?? ""}\n${base64(requestBody)}`,
    );
    const cacheKey = `${keyPrefix}${await digest(`${url.origin}\n${scopeKey}\n${idempotencyKey}`)}`;
    const pending: StoredResponse = { state: "pending", requestDigest };
    const pendingValue = JSON.stringify(pending);
    const claimed = await store.setIfAbsent(cacheKey, pendingValue, ttlMs);
    if (!claimed) {
      const current = await store.get(cacheKey);
      if (current === null) {
        return withRequestId(Response.json({ error: { message: "Idempotency record expired; retry the request" } }, { status: 409 }));
      }
      const stored = parseStored(current);
      if (stored.requestDigest !== requestDigest) {
        return withRequestId(Response.json({ error: { message: "Idempotency-Key was already used for a different request" } }, { status: 409 }));
      }
      if (stored.state === "pending") {
        return withRequestId(Response.json({ error: { message: "A request with this Idempotency-Key is still processing" } }, { status: 409 }));
      }
      return withRequestId(restoreResponse(stored));
    }

    try {
      const response = await handler(routedRequest);
      if (response.status >= 500) {
        await store.delete(cacheKey);
        return withRequestId(response);
      }
      const headers = Object.fromEntries([...response.headers].filter(([name]) =>
        !["connection", "content-length", "date", "transfer-encoding", "x-request-id"].includes(name.toLowerCase()),
      ));
      const saved: StoredResponse = {
        state: "complete",
        requestDigest,
        status: response.status,
        statusText: response.statusText,
        headers,
        body: base64(new Uint8Array(await response.clone().arrayBuffer())),
      };
      const savedValue = JSON.stringify(saved);
      if (!await store.compareAndSet(cacheKey, pendingValue, savedValue, ttlMs)) {
        return withRequestId(Response.json({ error: { message: "Idempotency record expired while the request was processing" } }, { status: 409 }));
      }
      return withRequestId(response);
    } catch (cause) {
      await store.compareAndDelete(cacheKey, pendingValue);
      throw cause;
    }
  };
}

function parseStored(value: string): StoredResponse {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" || parsed === null ||
    !("state" in parsed) || (parsed.state !== "pending" && parsed.state !== "complete") ||
    !("requestDigest" in parsed) || typeof parsed.requestDigest !== "string"
  ) throw new Error("Invalid idempotency record in cache");
  return parsed as StoredResponse;
}

function restoreResponse(saved: StoredResponse): Response {
  if (saved.state !== "complete" || saved.status === undefined || saved.body === undefined) {
    throw new Error("Incomplete idempotency response in cache");
  }
  const body = unbase64(saved.body);
  return new Response([204, 205, 304].includes(saved.status) ? null : body, {
    status: saved.status,
    ...(saved.statusText === undefined ? {} : { statusText: saved.statusText }),
    ...(saved.headers === undefined ? {} : { headers: saved.headers }),
  });
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64(new Uint8Array(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
