import { auth } from "@/lib/auth";
import { DATABASE_AUTH_MESSAGE, withClearerOriginError, withReadableAuthFailure } from "@/lib/auth-error";
import { databaseProblem } from "@/lib/db-error";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);

async function respond(response: Promise<Response>): Promise<Response> {
  try {
    return await withReadableAuthFailure(await withClearerOriginError(await response));
  } catch (error) {
    const detail = databaseProblem(error);
    const message = error instanceof Error ? error.message : "auth error";
    console.error("[auth]", message.slice(0, 300));
    return Response.json(
      { message: detail ? DATABASE_AUTH_MESSAGE : "Something went wrong — try again.", code: detail ? "DATABASE_UNAVAILABLE" : "AUTH_FAILED" },
      { status: detail ? 503 : 500 },
    );
  }
}

export async function GET(request: Request) {
  return respond(handler.GET(request));
}

export async function POST(request: Request) {
  return respond(handler.POST(request));
}
