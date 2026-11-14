/** Hidden local turn that resumes a desktop slice. Not shown in the transcript. */
export const COMPUTER_CONTINUE_TEXT = "\u2060";

export function nextComputerContinue(token: string | null, followed: string | null, busy: boolean): string | null {
  if (busy || !token || token === followed) return null;
  return token;
}

export function isComputerContinueText(text: string): boolean {
  return text === COMPUTER_CONTINUE_TEXT;
}
