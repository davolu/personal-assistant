import { auth } from "@/lib/auth";
import { withClearerOriginError } from "@/lib/auth-error";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);

export async function GET(request: Request) {
  return withClearerOriginError(await handler.GET(request));
}

export async function POST(request: Request) {
  return withClearerOriginError(await handler.POST(request));
}
