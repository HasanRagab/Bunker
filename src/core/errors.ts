/**
 * HTTP boundary error with a status code and optional response details.
 * @example
 * ```ts
 * throw HttpError.notFound("User not found");
 * ```
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest = (msg = "Bad Request", details?: unknown) => new HttpError(400, msg, details);
  static unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);
  static forbidden = (msg = "Forbidden") => new HttpError(403, msg);
  static notFound = (msg = "Not Found") => new HttpError(404, msg);
  static conflict = (msg = "Conflict") => new HttpError(409, msg);
  static unprocessable = (msg = "Validation failed", details?: unknown) => new HttpError(422, msg, details);
}
