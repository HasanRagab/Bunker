import { z } from "zod";
import { err, ok, type Result } from "../core/result";

export interface HttpClientError {
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createHttpClient(options: {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  retryMethods?: readonly string[];
  requestId?: () => string | undefined;
  fetcher?: Fetcher;
} = {}) {
  const {
    timeoutMs = 10_000,
    retries = 0,
    retryDelayMs = 200,
    retryMethods = ["GET", "HEAD", "OPTIONS"],
    requestId,
    fetcher = fetch,
  } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be positive");
  if (!Number.isInteger(retries) || retries < 0) throw new RangeError("retries must be a non-negative integer");
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new RangeError("retryDelayMs must be non-negative");

  return {
    async request<S extends z.ZodType>(url: string | URL, schema: S, init: RequestInit = {}): Promise<Result<z.output<S>, HttpClientError>> {
      const canRetry = retryMethods.includes((init.method ?? "GET").toUpperCase());
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
        try {
          const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
          const headers = new Headers(init.headers);
          const id = requestId?.();
          if (id && !headers.has("x-request-id")) headers.set("x-request-id", id);
          const response = await fetcher(url, { ...init, headers, signal });
          if (!response.ok) {
            const message = await response.text();
            if (canRetry && attempt < retries && response.status >= 500) {
              await Bun.sleep(retryDelayMs * (attempt + 1));
              continue;
            }
            return err({ message: message || response.statusText, status: response.status });
          }
          const data: unknown = response.status === 204 ? undefined : await response.json();
          const parsed = schema.safeParse(data);
          return parsed.success ? ok(parsed.data) : err({ message: "Response validation failed", cause: parsed.error });
        } catch (cause) {
          if (!canRetry || attempt >= retries) {
            return err({ message: cause instanceof Error ? cause.message : "Request failed", cause });
          }
          await Bun.sleep(retryDelayMs * (attempt + 1));
        } finally {
          clearTimeout(timer);
        }
      }
      return err({ message: "Request failed after retries" });
    },
  };
}
