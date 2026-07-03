"use client";
import { useEffect, useState } from "react";

type DashboardData = {
  stats: { totalMemories: number; totalInterests: number; totalTraits: number; totalReflections: number };
  recentMemories: Array<{ id: string; content: string; createdAt: string }>;
  topInterests: Array<{ topic: string; score: number; priority: number }>;
  traits: Array<{ name: string; value: number }>;
  recentReflections: Array<{ topic: string; insightsCount: number; createdAt: string }>;
  recentActivity: Array<{ type: string; context: any; timestamp: string }>;
  extended?: {
    serviceUsage: Array<{ serviceId: string; count: number }>;
    activeSpaces: Array<{ spaceId: string; lastSeen: string }>;
    recentResults: Array<{ type: string; timestamp: string; context: any }>;
  };
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard?extended=1")
      .then((r) => r.json())
      .then((json) => setData(json))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!data) return <div className="p-8 text-center">Error loading data.</div>;

  return (
    <main className="bg-surface min-h-screen p-6 text-primary font-sans">
      {/* Header + ThoughtStream */}
      <header className="flex items-center justify-between mb-6">
        <h1 className="font-display text-4xl">cf‑kristina Dashboard</h1>
        <ThoughtStream topic={data.topInterests[0]?.topic ?? "—"} />
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="🧠" label="Memories" value={data.stats.totalMemories} />
        <StatCard icon="🔎" label="Interests" value={data.stats.totalInterests} />
        <StatCard icon="🧬" label="Traits" value={data.stats.totalTraits} />
        <StatCard icon="📓" label="Reflections" value={data.stats.totalReflections} />
      </section>

      {/* Quick actions */}
      <section className="flex gap-3 mb-8">
        <button onClick={() => location.reload()} className={btnPrimary}>
          Refresh
        </button>
        <a href="/api/dashboard" download="dashboard.json" className={btnSecondary}>
          Export JSON
        </a>
      </section>

      {/* Main grid */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Recent Memories */}
        <Card title="Recent Memories">
          <ul className="space-y-2">
            {data.recentMemories.map((m) => (
              <li key={m.id} className="text-sm border-b pb-1">
                <span className="font-mono text-muted">{m.id.slice(0, 8)}</span>{" "}
                <span className="ml-2">{m.content}</span>
                <time className="float-right text-muted">
                  {new Date(m.createdAt).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ul>
        </Card>

        {/* Top Interests */}
        <Card title="Top Interests">
          <div className="space-y-3">
            {data.topInterests.map((i) => (
              <div key={i.topic} className="flex items-center">
                <span className="w-32 text-sm truncate">{i.topic}</span>
                <div className="flex-1 bg-muted rounded h-4 overflow-hidden mx-2">
                  <div
                    className="h-4 bg-accent rounded"
                    style={{ width: `${i.score * 10}%` }}
                  />
                </div>
                <span className="ml-2 text-xs text-muted">{i.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Traits (radial) */}
        <Card title="Personality Traits">
          <div className="grid grid-cols-2 gap-4">
            {data.traits.map((t) => (
              <RadialTrait key={t.name} name={t.name} value={t.value} />
            ))}
          </div>
        </Card>

        {/* Recent Reflections */}
        <Card title="Recent Reflections">
          <ul className="space-y-2">
            {data.recentReflections.map((d) => (
              <li key={d.topic} className="text-sm">
                <strong>{d.topic}</strong> – {d.insightsCount} insights
                <time className="float-right text-muted">
                  {new Date(d.createdAt).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* Activity log carousel */}
      <section className="mt-8">
        <h2 className="font-display text-2xl mb-3">Activity Log</h2>
        <div className="flex overflow-x-auto gap-4 py-2">
          {data.recentActivity.map((a, i) => (
            <div
              key={i}
              className="min-w-[200px] bg-surface rounded border border-muted p-3 text-sm"
            >
              <div className="font-medium">{a.type}</div>
              <div className="text-muted">{new Date(a.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Service usage */}
      {data.extended && (
        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card title="Service usage (24h)">
            {data.extended.serviceUsage.length === 0 ? (
              <p className="text-muted text-sm">No service calls in the last 24h.</p>
            ) : (
              <ul className="space-y-2">
                {data.extended.serviceUsage.map((s) => (
                  <li key={s.serviceId} className="flex items-center">
                    <span className="w-40 truncate text-sm">{s.serviceId}</span>
                    <div className="flex-1 bg-muted rounded h-3 mx-2">
                      <div
                        className="h-3 bg-accent rounded"
                        style={{
                          width: `${Math.min(100, s.count * 10)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Active spaces (24h)">
            {data.extended.activeSpaces.length === 0 ? (
              <p className="text-muted text-sm">No active spaces.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.extended.activeSpaces.map((s) => (
                  <li key={s.spaceId} className="flex justify-between">
                    <span className="font-mono truncate">{s.spaceId}</span>
                    <span className="text-muted">
                      {new Date(s.lastSeen).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}
    </main>
  );
}

/* Reusable components */
function StatCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="bg-surface rounded-lg shadow-sm p-4 flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-lg font-medium">{value}</div>
        <div className="text-muted">{label}</div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg shadow-sm p-5">
      <h3 className="font-display text-xl mb-4">{title}</h3>
      {children}
    </div>
  );
}

function RadialTrait({ name, value }: { name: string; value: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - value * circumference;
  return (
    <div className="flex flex-col items-center">
      <svg width={70} height={70} className="mb-2">
        <circle cx={35} cy={35} r={radius} stroke="#e2e8f0" strokeWidth={6} fill="none" />
        <circle
          cx={35}
          cy={35}
          r={radius}
          stroke="#e67e22"
          strokeWidth={6}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span className="text-sm">{name}</span>
    </div>
  );
}

function ThoughtStream({ topic }: { topic: string }) {
  return (
    <div className="relative">
      <svg width={60} height={60}>
        <circle cx={30} cy={30} r={28} stroke="#e67e22" strokeWidth={4} fill="none" />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-primary font-mono text-xs"
        >
          {topic?.slice(0, 6) ?? "…"}
        </text>
      </svg>
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: .9; }
          50% { transform: scale(1.12); opacity: .6; }
          100% { transform: scale(1); opacity: .9; }
        }
        div[role="relative"] svg { animation: pulse 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

/* Utility button styles (Tailwind) */
const btnBase = "px-4 py-2 rounded font-medium transition";
const btnPrimary = `${btnBase} bg-primary text-white hover:bg-primary/90`;
const btnSecondary = `${btnBase} bg-muted text-primary hover:bg-muted/80`;
