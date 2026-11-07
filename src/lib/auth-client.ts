"use client";

import { createAuthClient } from "better-auth/react";

// Auth is always served from the same origin as the page — never pin to an
// env var here, or a stale NEXT_PUBLIC_APP_URL silently breaks prod sign-in.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
