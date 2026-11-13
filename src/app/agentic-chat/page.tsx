import AgenticChatClient from "./AgenticChatClient";

export const metadata = { title: "Autonomous Agent" };

export default function AgenticChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <AgenticChatClient />
    </div>
  );
}
