/** Shown under the password field when better-auth rejects the request origin. */
export const ORIGIN_REJECTED_MESSAGE =
  "This address isn't allowed to sign you in. Use the production site, a Vercel preview for this project, or localhost.";

const ORIGIN_MESSAGES = new Set(["invalid origin", "missing or null origin"]);
const ORIGIN_CODES = new Set(["invalid_origin", "missing_or_null_origin"]);

export function isOriginRejection(message?: string | null, code?: string | null): boolean {
  return ORIGIN_MESSAGES.has((message ?? "").trim().toLowerCase()) || ORIGIN_CODES.has((code ?? "").trim().toLowerCase());
}

/** Maps better-auth's "Invalid origin" to a message that says what to open instead. */
export function explainAuthError(message?: string | null, code?: string | null): string {
  if (isOriginRejection(message, code)) return ORIGIN_REJECTED_MESSAGE;
  if ((message ?? "").trim().toLowerCase() === "email not verified" || (code ?? "").trim().toUpperCase() === "EMAIL_NOT_VERIFIED") {
    return "Verify your email first. Open the link we sent, then sign in.";
  }
  const text = (message ?? "").trim();
  return text || "Something went wrong — try again.";
}

/** Shown when better-auth swallows a missing-column error into an empty 500. */
export const DATABASE_AUTH_MESSAGE =
  "Sign-in could not read the account database. Try again in a moment.";

/**
 * Better Auth's router returns `new Response(null, { status: 500 })` when a
 * database error mentions a missing column or table. Replace that empty body
 * so the sign-in form can show a sentence instead of "Something went wrong".
 */
export async function withReadableAuthFailure(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  let text = "";
  try {
    text = await response.clone().text();
  } catch {
    return response;
  }
  if (text.trim()) return response;
  return Response.json(
    { message: DATABASE_AUTH_MESSAGE, code: "DATABASE_UNAVAILABLE" },
    { status: 503 },
  );
}

/** Rewrites a 403 origin rejection without changing any other auth response. */
export async function withClearerOriginError(response: Response): Promise<Response> {
  if (response.status !== 403) return response;
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("json")) return response;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!payload || typeof payload !== "object") return response;

  const record = payload as { message?: unknown; code?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  const code = typeof record.code === "string" ? record.code : "";
  if (!isOriginRejection(message, code)) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(
    { ...record, message: ORIGIN_REJECTED_MESSAGE },
    { status: response.status, statusText: response.statusText, headers },
  );
}
