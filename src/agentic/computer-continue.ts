import type { ComputerCheckpoint } from "./types";

/** Hidden local turn that resumes a desktop slice. Not shown in the transcript. */
export const COMPUTER_CONTINUE_TEXT = "\u2060";

/**
 * A slice checkpoint belongs to one sandbox. Resume it only while that machine
 * is still the desktop. A replaced or different sandbox starts the task over,
 * so a dead machine does not replay old clicks forever.
 */
export function resumeComputerCheckpoint(
  checkpoint: ComputerCheckpoint | undefined,
  desktop: { sandboxId: string; replaced?: boolean }
): ComputerCheckpoint | undefined {
  if (!checkpoint) return undefined;
  if (desktop.replaced) return undefined;
  if (checkpoint.sandboxId && checkpoint.sandboxId !== desktop.sandboxId) return undefined;
  return checkpoint;
}

export function nextComputerContinue(token: string | null, followed: string | null, busy: boolean): string | null {
  if (busy || !token || token === followed) return null;
  return token;
}

export function isComputerContinueText(text: string): boolean {
  return text === COMPUTER_CONTINUE_TEXT;
}
