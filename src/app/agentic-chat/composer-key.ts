/** Enter sends. Shift+Enter inserts a newline. IME composition and a running turn do not send. */
export function composerKeyAction(key: string, shift: boolean, composing: boolean, busy: boolean): "send" | "ignore" {
  if (key !== "Enter" || shift || composing || busy) return "ignore";
  return "send";
}
