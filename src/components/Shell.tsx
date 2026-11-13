"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import AppSidebar from "@/components/AppSidebar";
import MobileTabs from "@/components/MobileTabs";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const chat = pathname.startsWith("/agentic-chat");
  return (
    <>
      <div className={chat ? "flex h-dvh max-w-[100vw] flex-col overflow-hidden md:flex-row" : "flex min-h-dvh max-w-[100vw] flex-col md:h-dvh md:flex-row md:overflow-hidden"}>
        <AppSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Nav />
          <main className={chat ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0"}>
            {children}
            {!chat && (
              <Suspense>
                <Footer />
              </Suspense>
            )}
          </main>
        </div>
      </div>
      <MobileTabs />
    </>
  );
}
