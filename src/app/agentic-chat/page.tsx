import AgenticChatClient from "./AgenticChatClient";

export const metadata = { title: "Autonomous Agent" };

export default function AgenticChatPage() {
  return (
    <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-clip pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <AgenticChatClient />
    </div>
  );
}
