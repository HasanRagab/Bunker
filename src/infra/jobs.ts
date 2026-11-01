import { z } from "zod";
import { createLogger, type Logger } from "../core/logger";
import { err, ok, type Result } from "../core/result";

/** Serialized job stored by a queue adapter.
 * @example
 * ```ts
 * const job: QueuedJob = { id: "1", name: "cleanup", payload: {}, attempts: 0, maxAttempts: 3, retryDelayMs: 1_000, runAt: Date.now() };
 * ```
 */
export interface QueuedJob {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly backoff?: { readonly factor: number; readonly maxDelayMs: number };
  readonly runAt: number;
  readonly requestId?: string;
}

/** Pluggable storage contract used by queue workers.
 * @example
 * ```ts
 * const store: QueueStore = memoryQueue();
 * ```
 */
export interface QueueStore {
  enqueue(job: QueuedJob): Promise<void>;
  claim(now: number, visibilityTimeoutMs: number): Promise<QueuedJob | null>;
  extend?(id: string, leaseUntil: number): Promise<boolean>;
  retry(job: QueuedJob, runAt: number): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Context supplied to a job handler.
 * @example
 * ```ts
 * const context: JobContext = { id: "job-1", attempt: 1 };
 * ```
 */
export interface JobContext {
  readonly id: string;
  readonly requestId?: string;
  readonly attempt: number;
}

/**
 * Legacy class-based in-memory queue store.
 * @deprecated Use {@link memoryQueue}.
 * @example
 * ```ts
 * const store = new MemoryQueueStore();
 * ```
 */
export class MemoryQueueStore implements QueueStore {
  #jobs: QueuedJob[] = [];
  #processing = new Map<string, { job: QueuedJob; leaseUntil: number }>();

  async enqueue(job: QueuedJob): Promise<void> {
    this.#jobs.push(job);
  }

  async claim(now: number, visibilityTimeoutMs: number): Promise<QueuedJob | null> {
    for (const [id, entry] of this.#processing) {
      if (entry.leaseUntil <= now) {
        this.#processing.delete(id);
        this.#jobs.push(entry.job);
      }
    }
    const index = this.#jobs.findIndex((job) => job.runAt <= now);
    if (index < 0) return null;
    const [job] = this.#jobs.splice(index, 1);
    if (!job) return null;
    this.#processing.set(job.id, { job, leaseUntil: now + visibilityTimeoutMs });
    return job;
  }

  async extend(id: string, leaseUntil: number): Promise<boolean> {
    const current = this.#processing.get(id);
    if (!current) return false;
    this.#processing.set(id, { ...current, leaseUntil });
    return true;
  }

  async retry(job: QueuedJob, runAt: number): Promise<void> {
    this.#processing.delete(job.id);
    this.#jobs.push({ ...job, attempts: job.attempts + 1, runAt });
  }

  async remove(id: string): Promise<void> {
    this.#processing.delete(id);
    this.#jobs = this.#jobs.filter((job) => job.id !== id);
  }
}

/**
 * Create a process-local job queue store.
 * @example
 * ```ts
 * const queue = createQueue(memoryQueue());
 * ```
 */
export function memoryQueue(): MemoryQueueStore {
  return new MemoryQueueStore();
}

/** Typed job metadata and validated handler contract.
 * @example
 * ```ts
 * const cleanup: JobDefinition<{ id: string }> = defineJob("cleanup", z.object({ id: z.string() }), async () => {});
 * ```
 */
export interface JobDefinition<Payload> {
  readonly name: string;
  readonly schema: z.ZodType<Payload>;
  readonly handler: (payload: Payload, context: JobContext) => void | Promise<void>;
  readonly run: (payload: unknown, context: JobContext) => Promise<void>;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly backoff?: { readonly factor: number; readonly maxDelayMs: number };
}

/**
 * Define a typed job with a Zod payload schema and retry policy.
 * @example
 * ```ts
 * const email = defineJob("email", z.object({ to: z.string() }), async ({ to }) => sendEmail(to));
 * ```
 */
export function defineJob<Payload>(
  name: string,
  schema: z.ZodType<Payload>,
  handler: (payload: Payload, context: JobContext) => void | Promise<void>,
  options: {
    maxAttempts?: number;
    retryDelayMs?: number;
    backoff?: boolean | { factor?: number; maxDelayMs?: number };
  } = {},
): JobDefinition<Payload> {
  if (!name.trim()) throw new TypeError("Job name must not be empty; provide a descriptive job name.");
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const backoff = options.backoff === true ? {} : options.backoff || undefined;
  const retryBackoff = backoff
    ? { factor: backoff.factor ?? 2, maxDelayMs: backoff.maxDelayMs ?? 60_000 }
    : undefined;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("Invalid maxAttempts; set it to a positive integer.");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError("Invalid retryDelayMs; set it to a finite non-negative number of milliseconds.");
  }
  if (retryBackoff && (!Number.isFinite(retryBackoff.factor) || retryBackoff.factor < 1 ||
    !Number.isFinite(retryBackoff.maxDelayMs) || retryBackoff.maxDelayMs < 0)) {
    throw new RangeError("Invalid exponential backoff; set factor to at least 1 and maxDelayMs to a finite non-negative value.");
  }
  return {
    name,
    schema,
    handler,
    run: async (input, context) => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw parsed.error;
      await handler(parsed.data, context);
    },
    maxAttempts,
    retryDelayMs,
    ...(retryBackoff ? { backoff: retryBackoff } : {}),
  };
}

/**
 * Create a queue facade and worker over a pluggable store.
 * @example
 * ```ts
 * const queue = createQueue(memoryQueue());
 * const result = await queue.enqueue(email, { to: "user@example.test" });
 * ```
 */
export function createQueue(
  store: QueueStore,
  options: {
    pollMs?: number;
    visibilityTimeoutMs?: number;
    onError?: (error: Error, job: QueuedJob) => void;
    onDeadLetter?: (error: Error, job: QueuedJob) => void | Promise<void>;
    logger?: Logger;
  } = {},
) {
  const { pollMs = 250, visibilityTimeoutMs = 30_000, onDeadLetter, logger = createLogger() } = options;
  const onError = options.onError ?? ((error: Error, job: QueuedJob) => logger.error("Background job failed", { error, jobId: job.id, jobName: job.name }));
  if (!Number.isFinite(pollMs) || pollMs < 1) {
    throw new RangeError("Invalid queue pollMs; set it to at least 1 millisecond.");
  }
  if (!Number.isFinite(visibilityTimeoutMs) || visibilityTimeoutMs < 1) {
    throw new RangeError("Invalid queue visibilityTimeoutMs; set it to at least 1 millisecond.");
  }
  let running = false;
  let worker: Promise<void> | undefined;

  return {
    async enqueue<Payload>(
      definition: JobDefinition<Payload>,
      input: z.input<JobDefinition<Payload>["schema"]>,
      options: { delayMs?: number; requestId?: string } = {},
    ): Promise<Result<string, Error>> {
      const parsed = definition.schema.safeParse(input);
      if (!parsed.success) return err(parsed.error);
      const delayMs = options.delayMs ?? 0;
      if (!Number.isFinite(delayMs) || delayMs < 0) {
        return err(new RangeError("Invalid job delayMs; set it to a finite non-negative number of milliseconds."));
      }
      const id = crypto.randomUUID();
      try {
        await store.enqueue({
          id,
          name: definition.name,
          payload: parsed.data,
          attempts: 0,
          maxAttempts: definition.maxAttempts,
          retryDelayMs: definition.retryDelayMs,
          ...(definition.backoff ? { backoff: definition.backoff } : {}),
          runAt: Date.now() + delayMs,
          ...(options.requestId ? { requestId: options.requestId } : {}),
        });
        return ok(id);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    start(definitions: readonly { readonly name: string; readonly run: (payload: unknown, context: JobContext) => Promise<void> }[]): { stop: () => Promise<void> } {
      if (running) throw new Error("Queue worker is already running; stop the current worker before starting another.");
      const handlers = new Map(definitions.map((definition) => [definition.name, definition]));
      running = true;
      worker = (async () => {
        while (running) {
          let job: QueuedJob | null;
          try {
            job = await store.claim(Date.now(), visibilityTimeoutMs);
          } catch (cause) {
            onError(asError(cause), { id: "", name: "queue", payload: null, attempts: 0, maxAttempts: 1, retryDelayMs: pollMs, runAt: Date.now() });
            await Bun.sleep(pollMs);
            continue;
          }
          if (!job) {
            await Bun.sleep(pollMs);
            continue;
          }
          const definition = handlers.get(job.name);
          if (!definition) {
            logger.error("Removing job with no registered handler", { jobId: job.id, jobName: job.name });
            onError(new Error(`No worker registered for job: ${job.name}`), job);
            await store.remove(job.id);
            continue;
          }
          const heartbeat = setInterval(() => {
            if (store.extend) {
              void store.extend(job.id, Date.now() + visibilityTimeoutMs).then((extended) => {
                if (!extended) onError(new Error("Job visibility lease was lost"), job);
              }).catch((cause) => onError(asError(cause), job));
            }
          }, Math.max(1, Math.floor(visibilityTimeoutMs / 3)));
          try {
            await definition.run(job.payload, {
              id: job.id,
              attempt: job.attempts + 1,
              ...(job.requestId ? { requestId: job.requestId } : {}),
            });
            await store.remove(job.id);
          } catch (cause) {
            const error = asError(cause);
            onError(error, job);
            if (job.attempts + 1 < job.maxAttempts) {
              const delayMs = job.backoff
                ? Math.min(job.backoff.maxDelayMs, job.retryDelayMs * job.backoff.factor ** job.attempts)
                : job.retryDelayMs;
              await store.retry(job, Date.now() + delayMs);
            } else {
              if (onDeadLetter) {
                try {
                  await onDeadLetter(error, job);
                } catch (cause) {
                  logger.error("Dead-letter handler failed", { error: asError(cause), jobId: job.id, jobName: job.name });
                }
              }
              await store.remove(job.id);
            }
          } finally {
            clearInterval(heartbeat);
          }
        }
      })();
      return {
        stop: async () => {
          running = false;
          await worker;
        },
      };
    },
  };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
