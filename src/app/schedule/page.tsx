import { Suspense } from "react";
import { ScheduleClient } from "./ScheduleClient";

export const metadata = { title: "Schedule" };

export default function SchedulePage(props: { searchParams: Promise<{ preview?: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <ScheduleContent {...props} />
    </Suspense>
  );
}

async function ScheduleContent({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  return <ScheduleClient preview={preview === "1"} />;
}
