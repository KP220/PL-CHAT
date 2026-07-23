const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

type Overview = {
  users: number;
  rooms: number;
  messages: number;
  openReports: number;
  redis: string;
};

async function loadOverview(): Promise<Overview | null> {
  try {
    const response = await fetch(`${apiUrl}/api/admin/overview`, {
      headers: process.env.ADMIN_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.ADMIN_ACCESS_TOKEN}` } : {},
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export default async function AdminHome() {
  const overview = await loadOverview();
  const metrics = [
    ['Users', overview?.users ?? 'Auth required'],
    ['Rooms', overview?.rooms ?? 'Auth required'],
    ['Messages', overview?.messages ?? 'Auth required'],
    ['Open reports', overview?.openReports ?? 'Auth required'],
    ['Redis', overview?.redis ?? 'Unknown']
  ];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-col gap-2 border-b border-line pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-bold text-primary">PL CHAT OPERATIONS</p>
          <h1 className="text-3xl font-black tracking-normal">Admin Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Monitor users, rooms, reports, realtime health, and production readiness from one minimal operations console.
          </p>
        </div>
        <a className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-bold text-white" href={`${apiUrl}/ready`}>
          API readiness
        </a>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        {metrics.map(([label, value]) => (
          <article key={label} className="rounded-lg border border-line bg-white p-4">
            <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
            <strong className="mt-2 block text-2xl text-ink">{value}</strong>
          </article>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <article className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-black">Moderation</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Review reports, lock abusive accounts, audit admin actions, and keep public rooms safe.
          </p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-black">Realtime</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Socket.IO uses JWT handshake auth, Redis fanout, heartbeat, idempotent message writes, and per-user flood limits.
          </p>
        </article>
        <article className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-black">Scale</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            PostgreSQL indexes, Redis cache, Kubernetes HPA, Cloudflare edge protection, and Prometheus metrics are ready to wire.
          </p>
        </article>
      </section>
    </main>
  );
}
