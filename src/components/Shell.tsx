"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import AppSidebar from "@/components/AppSidebar";
import MobileAppBar from "@/components/MobileAppBar";
import MobileTabs from "@/components/MobileTabs";
import { isAppPath } from "@/components/app-routes";
import { useMobileViewport } from "@/components/use-mobile-viewport";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const chat = pathname.startsWith("/agentic-chat");
  const app = isAppPath(pathname);
  useMobileViewport();
  return (
    <>
      <div data-app-shell className={chat ? "flex h-dvh max-w-[100vw] flex-col overflow-hidden md:flex-row" : "flex min-h-dvh max-w-[100vw] flex-col md:h-dvh md:flex-row md:overflow-hidden"}>
        <AppSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={app ? "hidden md:contents" : undefined}>
            <Nav />
          </div>
          {app && !chat && <MobileAppBar />}
          <main className={chat ? "page-enter flex min-h-0 flex-1 flex-col overflow-hidden" : "page-enter tab-pad min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0"}>
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
