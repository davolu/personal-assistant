/** User-facing approval text. Tool slugs stay on the approval record, not in the sentence. */

export function approvalTitle(tool: string): string {
  if (tool === "builtin.web.search") return "Web search";
  if (tool === "builtin.routines.create") return "Recurring routine";
  if (tool === "builtin.routines.delete") return "Remove a routine";
  if (tool === "builtin.routines.list") return "Your routines";
  if (tool === "builtin.apps.connect") return "Connect an app";
  if (/SEND/i.test(tool) && /EMAIL|MAIL/i.test(tool)) return "Send email";
  if (/DRAFT/i.test(tool) && /EMAIL|MAIL/i.test(tool)) return "Email draft";
  const slug = tool.split("_")[0]?.toLowerCase();
  if (slug && tool.includes("_") && !tool.startsWith("builtin.")) return slug.replace(/_/g, " ");
  return "This action";
}

export function describeApproval(
  tool: string,
  args: Record<string, unknown>,
  ctx: { text: string; ownerEmail?: string }
): string {
  if (tool === "builtin.routines.create") {
    const cadence = String(args.cadence ?? "daily");
    const when = cadence === "hourly" ? "every hour" : cadence === "weekly" ? "every week" : "every day";
    const label = cadence === "hourly" ? "hourly" : cadence === "weekly" ? "weekly" : "daily";
    const source = (ctx.text || String(args.prompt ?? "")).replace(/\s+/g, " ").trim();
    return `${routineSentence(source, when, ctx.ownerEmail)} Approve to set up this ${label} routine.`;
  }
  if (/SEND/i.test(tool) && /EMAIL|MAIL/i.test(tool)) {
    const to = textArg(args.recipient_email) || textArg(args.to) || ctx.ownerEmail || "";
    return `I'll send this email${to ? ` to ${to}` : ""}. Approve to send it.`;
  }
  if (/DELETE|TRASH|REMOVE/i.test(tool)) {
    return "I'll delete that. Approve to continue. This is waiting for your approval.";
  }
  return "I'll do that. Approve to continue. This is waiting for your approval.";
}

function textArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function routineSentence(source: string, when: string, email?: string): string {
  let body = source.replace(/[.?!]+$/g, "").replace(/^(please\s+)/i, "");
  body = body.replace(/\b(once a day|every day|each morning|daily|every hour|hourly|every week|weekly)\b/gi, " ");
  body = body.replace(/\s+/g, " ").trim();
  const emailPhrase = email ? `email them to you at ${email}` : "email them to you";
  body = body.replace(/\bsend (it |them |this )?(to my email|to me|to my gmail)\b/i, emailPhrase);
  const firstBreak = body.indexOf(" ");
  const first = (firstBreak === -1 ? body : body.slice(0, firstBreak)).toLowerCase();
  const rest = firstBreak === -1 ? "" : body.slice(firstBreak);
  const clause = `${first}${rest}`.replace(/\s+/g, " ").trim();
  const emailSplit = clause.split(/ and email /i);
  let sentence =
    emailSplit.length === 2
      ? `I'll ${emailSplit[0]} ${when} and email ${emailSplit[1]}`
      : `I'll ${clause} ${when}`;
  sentence = sentence.replace(/\s+/g, " ").trim();
  if (email && !sentence.includes(email) && /\b(email|mail|send)\b/i.test(source)) {
    sentence = `${sentence.replace(/\.$/, "")} ${sentence.toLowerCase().includes("email") ? `at ${email}` : `and email them to you at ${email}`}`;
  }
  if (!/[.!?]$/.test(sentence)) sentence += ".";
  return sentence;
}
