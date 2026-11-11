export default function DataUnavailable({ title = "This page needs the database", detail }: { title?: string; detail: string }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-muted">Setup</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 leading-relaxed text-muted">{detail}</p>
      <p className="mt-4 font-mono text-xs text-muted">
        From a machine that can reach production Postgres: npx prisma db push
      </p>
    </div>
  );
}
