import ChatClient from "./ChatClient";

export const metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <ChatClient />
    </div>
  );
}
