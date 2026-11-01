import { err, ok, type Result } from "../core/result";

/**
 * Parsed multipart fields and accepted file values.
 * @example
 * ```ts
 * const result: UploadResult = { fields: {}, files: [] };
 * ```
 */
export interface UploadResult {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly File[];
}

/**
 * Parse multipart form values while enforcing size, count, and MIME limits.
 * @example
 * ```ts
 * const upload = await parseUploads(request, { maxBytes: 5_000_000, allowedTypes: ["image/png"] });
 * ```
 */
export async function parseUploads(
  request: Request,
  options: { maxBytes: number; maxFiles?: number; allowedTypes?: readonly string[] },
): Promise<Result<UploadResult, Error>> {
  const { maxBytes, maxFiles = 10, allowedTypes } = options;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative integer");
    if (!Number.isInteger(maxFiles) || maxFiles < 0) throw new RangeError("maxFiles must be a non-negative integer");
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new TypeError("Expected multipart/form-data");
    const announcedLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(announcedLength) && announcedLength > maxBytes) throw new RangeError("Upload exceeds maximum size");
    if (!request.body) throw new TypeError("Request has no body");

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError("Upload exceeds maximum size");
      }
      chunks.push(part.value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const form = await new Request(request.url, { method: "POST", headers: request.headers, body }).formData();
    const fields: Record<string, string> = {};
    const files: File[] = [];
    for (const [name, value] of form.entries()) {
      if (typeof value === "string") fields[name] = value;
      else files.push(value);
    }
    if (files.length > maxFiles) throw new RangeError(`Upload contains more than ${maxFiles} files`);
    const acceptedTypes = allowedTypes?.map((type) => type.split(";")[0]!.trim().toLowerCase());
    const disallowed = files.find((file) => acceptedTypes && !acceptedTypes.includes(file.type.split(";")[0]!.trim().toLowerCase()));
    if (disallowed) throw new TypeError(`Unsupported file type: ${disallowed.type || "unknown"}`);
    return ok({ fields, files });
  } catch (cause) {
    return err(cause instanceof Error ? cause : new Error(String(cause)));
  }
}
