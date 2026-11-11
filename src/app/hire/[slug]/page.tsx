import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getBot } from "@/lib/agents";
import { getSession } from "@/lib/session";
import { hireTemplate } from "@/lib/billing";
import { guardQuery } from "@/lib/db-error";
import DataUnavailable from "@/components/DataUnavailable";

// Hiring is instant and free on every plan — runs are the only metered thing.
// This page creates the agent then sends the user straight to account connection.
export default function HirePage(props: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <HireAction {...props} />
    </Suspense>
  );
}

async function HireAction({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = getBot(slug);
  if (!bot) notFound();

  const session = await getSession();
  if (!session) redirect(`/signup?next=${encodeURIComponent(`/hire/${slug}`)}`);

  const hired = await guardQuery(() => hireTemplate(session.user.id, bot));
  if (!hired.ok) return <DataUnavailable title="Could not add this agent" detail={hired.detail} />;
  redirect(`/connect/${slug}?hired=1`);
  return null;
}
