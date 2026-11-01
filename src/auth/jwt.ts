import { z } from "zod";
import { err, ok, type Result } from "./result";

export async function signJwt<T extends object>(
  payload: T,
  secret: string,
  options: { expiresInSeconds?: number } = {},
): Promise<Result<string, Error>> {
  try {
    if (!secret) throw new TypeError("JWT secret must not be empty");
    if (options.expiresInSeconds !== undefined && (!Number.isFinite(options.expiresInSeconds) || options.expiresInSeconds <= 0)) {
      throw new RangeError("JWT lifetime must be a positive finite number");
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      ...payload,
      ...(options.expiresInSeconds === undefined ? {} : { exp: now + options.expiresInSeconds }),
    };
    const serialized = JSON.stringify(claims);
    if (serialized === undefined) throw new TypeError("JWT payload must be JSON serializable");
    const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64UrlEncode(serialized);
    const signingInput = `${header}.${body}`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
    return ok(`${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`);
  } catch (cause) {
    return err(asError(cause));
  }
}

export async function verifyJwt<S extends z.ZodType>(
  token: string,
  secret: string,
  schema: S,
  options: { clockSkewSeconds?: number } = {},
): Promise<Result<z.output<S>, Error>> {
  try {
    if (!secret) throw new TypeError("JWT secret must not be empty");
    if (options.clockSkewSeconds !== undefined && (!Number.isFinite(options.clockSkewSeconds) || options.clockSkewSeconds < 0)) {
      throw new RangeError("JWT clock skew must be non-negative");
    }
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed JWT");
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header: unknown = JSON.parse(base64UrlDecodeText(encodedHeader));
    if (typeof header !== "object" || header === null || !("alg" in header) || header.alg !== "HS256") throw new Error("Unsupported JWT algorithm");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!valid) throw new Error("Invalid JWT signature");
    const payload: unknown = JSON.parse(base64UrlDecodeText(encodedPayload));
    const claims = z.object({ exp: z.number().optional(), nbf: z.number().optional() }).passthrough().safeParse(payload);
    if (!claims.success) throw claims.error;
    const now = Math.floor(Date.now() / 1000);
    const skew = options.clockSkewSeconds ?? 0;
    if (claims.data.exp !== undefined && now - skew >= claims.data.exp) throw new Error("JWT has expired");
    if (claims.data.nbf !== undefined && now + skew < claims.data.nbf) throw new Error("JWT is not active yet");
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw parsed.error;
    return ok(parsed.data);
  } catch (cause) {
    return err(asError(cause));
  }
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64UrlDecodeText(value: string): string {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
