import { prisma } from "@/lib/prisma";
import { getConnectedAccountStatus } from "@/lib/composio";
import { listActiveConnections } from "@/lib/composio-provider";
import { sameApp } from "@/lib/connect-url";

export async function connectionSnapshot(userId: string, app?: string): Promise<{ connected: boolean; active: string[] }> {
  const rows = await prisma.connection.findMany({ where: { userId } });
  for (const row of rows) {
    if (row.status === "active" || !row.composioAccountId) continue;
    try {
      const status = await getConnectedAccountStatus(row.composioAccountId);
      if (status.toUpperCase() === "ACTIVE") {
        await prisma.connection.update({ where: { id: row.id }, data: { status: "active" } });
        row.status = "active";
      }
    } catch {
      // The stored row stays as it is. A live account list can still match.
    }
  }
  const active = new Set(rows.filter((row) => row.status === "active").flatMap((row) => [row.toolkit, row.composioSlug]));
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const { Composio } = await import("@composio/core");
      const accounts = await listActiveConnections(new Composio({ apiKey: process.env.COMPOSIO_API_KEY }), userId);
      for (const account of accounts) {
        const slug = account.toolkit?.slug;
        if (slug) active.add(slug);
      }
    } catch {
      // Prisma is enough when Composio cannot be listed.
    }
  }
  const names = [...active];
  const connected = app ? names.some((name) => sameApp(name, app)) : false;
  return { connected, active: names };
}
