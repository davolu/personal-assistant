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
  const text = (message ?? "").trim();
  return text || "Something went wrong — try again.";
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
