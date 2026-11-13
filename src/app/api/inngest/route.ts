import { serve } from "inngest/next";
import { agenticTurn, inngest } from "@/agentic/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [agenticTurn],
});
