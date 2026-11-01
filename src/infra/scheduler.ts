import { err, ok, type Result } from "../core/result";
import type { JobDefinition } from "./jobs";
import type { Lock } from "./lock";

const cronRanges: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

type Queue = { enqueue<Payload>(job: JobDefinition<Payload>, payload: unknown, options?: { delayMs?: number }): Promise<Result<string, Error>> };

export function createScheduler(
  queue: Queue,
  lock: Lock,
  options: { tickMs?: number; lockTtlMs?: number; onError?: (error: Error) => void } = {},
) {
  const tasks: Array<{ cron: string; job: JobDefinition<unknown>; payload: unknown; id: string; lastMinute: string }> = [];
  const tickMs = options.tickMs ?? 15_000;
  const lockTtlMs = options.lockTtlMs ?? 120_000;
  const onError = options.onError ?? ((error: Error) => console.error(error));
  if (!Number.isFinite(tickMs) || tickMs < 1) {
    throw new RangeError("Invalid scheduler tickMs; set it to at least 1 millisecond.");
  }
  if (!Number.isFinite(lockTtlMs) || lockTtlMs < tickMs) {
    throw new RangeError("Invalid scheduler lockTtlMs; set it to at least tickMs.");
  }
  let timer: ReturnType<typeof setInterval> | undefined;

  const add = <Payload>(cron: string, job: JobDefinition<Payload>, payload: Payload): Result<void, Error> => {
    try {
      validateCron(cron);
      tasks.push({ cron, job: job as JobDefinition<unknown>, payload, id: job.name, lastMinute: "" });
      return ok(undefined);
    } catch (cause) {
      return err(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };

  const tick = async (now = new Date()) => {
    const minute = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    for (const task of tasks) {
      if (task.lastMinute === minute || !matchesCron(task.cron, now)) continue;
      task.lastMinute = minute;
      const lease = await lock.acquire(`scheduler:${task.id}:${minute}`, lockTtlMs);
      if (!lease) continue;
      let queued = false;
      try {
        const result = await queue.enqueue(task.job, task.payload);
        if (result.ok) queued = true;
        else onError(result.error);
      } catch (cause) {
        onError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        if (!queued) {
          task.lastMinute = "";
          await lease.release().catch((cause) => onError(cause instanceof Error ? cause : new Error(String(cause))));
        }
      }
    }
  };

  return {
    add,
    async start() {
      if (timer) throw new Error("Scheduler is already running; stop it before starting another run.");
      timer = setInterval(() => {
        void tick().catch((cause) => onError(cause instanceof Error ? cause : new Error(String(cause))));
      }, tickMs);
      await tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}

function validateCron(expression: string): void {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("Invalid cron expression; provide five fields: minute hour day-of-month month day-of-week.");
  }
  fields.forEach((field, index) => {
    for (const part of field.split(",")) {
      const [range = "", stepValue] = part.split("/");
      const step = stepValue === undefined ? 1 : Number(stepValue);
      if (!Number.isInteger(step) || step < 1) {
        throw new Error(`Invalid cron step in "${part}"; set the step after "/" to a positive integer.`);
      }
      const bounds = cronRanges[index];
      if (!bounds) throw new Error(`Invalid cron field at position ${index + 1}; provide a standard five-field expression.`);
      const [min, max] = bounds;
      const match = range === "*" || /^\d+$/.test(range) || /^\d+-\d+$/.test(range);
      if (!match) {
        throw new Error(`Unsupported cron field "${part}"; use *, a number, a range, a comma-separated list, or /step.`);
      }
      const [startText, endText] = range === "*" ? [String(min), String(max)] : range.split("-");
      const start = Number(startText);
      const end = endText === undefined ? (stepValue === undefined ? start : max) : Number(endText);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        throw new Error(`Cron field "${part}" is out of range; values in field ${index + 1} must be ${min}-${max}.`);
      }
    }
  });
}

function matchesCron(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  const values = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
  const matches = (field: string, index: number, value: number) => {
    const [min, max] = cronRanges[index]!;
    return field.split(",").some((part) => {
      const [range = "", stepText] = part.split("/");
      const step = stepText === undefined ? 1 : Number(stepText);
      if (range === "*") return (value - min) % step === 0;
      const [startText, endText] = range.split("-");
      const start = Number(startText);
      const end = endText === undefined ? (stepText === undefined ? start : max) : Number(endText);
      return value >= start && value <= end && (value - start) % step === 0;
    });
  };
  const weekdaysMatch = matches(fields[4]!, 4, values[4]!) || (values[4] === 0 && matches(fields[4]!, 4, 7));
  const dayMatches = fields[2] === "*" && fields[4] === "*"
    ? true
    : fields[2] === "*"
      ? weekdaysMatch
      : fields[4] === "*"
        ? matches(fields[2]!, 2, values[2]!)
        : matches(fields[2]!, 2, values[2]!) || weekdaysMatch;
  return matches(fields[0]!, 0, values[0]!)
    && matches(fields[1]!, 1, values[1]!)
    && dayMatches
    && matches(fields[3]!, 3, values[3]!);
}
