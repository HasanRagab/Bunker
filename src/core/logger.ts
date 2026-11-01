/** Supported structured log levels, ordered from least to most severe.
 * @example
 * ```ts
 * const level: LogLevel = "info";
 * ```
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

type Fields = Record<string, unknown>;
type LogFn = (msg: string, fields?: Fields) => void;

/**
 * Structured logger contract with child bindings.
 * @example
 * ```ts
 * const logger: Logger = createLogger({ level: "info" });
 * ```
 */
export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  child(bindings: Fields): Logger;
}

/**
 * Create a structured JSON logger with optional bindings and output sink.
 * @example
 * ```ts
 * const logger = createLogger({ instanceId: "api-1" });
 * logger.info("Started");
 * ```
 */
export function createLogger(opts: { level?: LogLevel; bindings?: Fields; sink?: (line: string) => void; instanceId?: string } = {}): Logger {
  const { level = "info", bindings = {}, sink = console.log, instanceId = crypto.randomUUID() } = opts;
  const rootBindings = { instanceId, ...bindings };

  const emit = (lvl: LogLevel): LogFn => (msg, fields) => {
    if (order[lvl] < order[level]) return;
    sink(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...rootBindings, ...fields }));
  };

  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    child: (b) => createLogger({ level, instanceId, bindings: { ...bindings, ...b }, sink }),
  };
}
