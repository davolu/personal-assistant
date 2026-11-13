import { serve } from "inngest/next";
import { agenticScheduleTick, agenticTurn, inngest } from "@/agentic/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [agenticTurn, agenticScheduleTick],
});
