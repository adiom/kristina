export default function Home() {
  const endpoints = [
    { method: "POST", path: "/api/agent", label: "agent turn" },
    { method: "POST", path: "/api/mcp", label: "tool bridge" },
    { method: "GET", path: "/api/dashboard", label: "state readout" },
  ];

  const namespaces = [
    { name: "own", value: "shared", color: "bg-[#c84f31]" },
    { name: "user", value: "vault", color: "bg-[#007e91]" },
    { name: "space", value: "room", color: "bg-[#657a42]" },
    { name: "service", value: "adapter", color: "bg-[#a17313]" },
  ];

  return (
    <main className="min-h-screen bg-[#e8edf4] text-[#11141a]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <nav className="flex items-center justify-between border-b border-[#11141a]/15 pb-4">
          <a className="font-mono text-base font-bold uppercase tracking-[0.22em]" href="/">
            Kristina
          </a>
          <div className="flex items-center gap-2 text-sm">
            <a
              className="rounded-md border border-[#11141a]/20 px-3 py-2 text-[#3c4654] transition hover:border-[#11141a]/45 hover:text-[#11141a] focus:outline-none focus:ring-2 focus:ring-[#007e91]"
              href="/dashboard"
            >
              Dashboard
            </a>
            <a
              className="rounded-md bg-[#11141a] px-3 py-2 text-white transition hover:bg-[#2d3540] focus:outline-none focus:ring-2 focus:ring-[#c84f31]"
              href="/api/dashboard"
            >
              JSON
            </a>
          </div>
        </nav>

        <div className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[0.88fr_1.12fr] lg:py-10">
          <section className="max-w-2xl">
            <div className="mb-7 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-md bg-[#11141a] px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-white">
                production
              </span>
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-[#536171]">
                protocol 1.0.0 / vercel hobby
              </span>
            </div>
            <h1 className="max-w-3xl text-5xl font-black leading-[0.92] tracking-normal text-[#11141a] sm:text-7xl lg:text-8xl">
              Kristina
              <span className="mt-2 block text-[#c84f31]">is awake.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#3c4654]">
              A public runtime for agent messages, MCP tools, vault-backed
              memory, and transparent state. Thin adapters call in; Kristina
              keeps the context.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex h-12 items-center justify-center rounded-md bg-[#11141a] px-5 text-sm font-bold text-white transition hover:bg-[#2d3540] focus:outline-none focus:ring-2 focus:ring-[#007e91]"
                href="/dashboard"
              >
                Open dashboard
              </a>
              <a
                className="inline-flex h-12 items-center justify-center rounded-md border border-[#11141a]/25 px-5 text-sm font-bold text-[#11141a] transition hover:border-[#11141a]/55 focus:outline-none focus:ring-2 focus:ring-[#c84f31]"
                href="/api/mcp"
              >
                Inspect MCP
              </a>
            </div>
          </section>

          <section className="grid gap-4">
            <div className="overflow-hidden rounded-lg border border-[#11141a]/20 bg-[#11141a] text-[#f7f8f3] shadow-2xl shadow-[#11141a]/20">
              <div className="grid grid-cols-[1fr_auto] items-center border-b border-white/12 px-4 py-3">
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-[#aab5c4]">
                  memory plane
                </span>
                <span className="rounded-md bg-[#007e91]/25 px-2 py-1 font-mono text-xs text-[#7addeb]">
                  ready
                </span>
              </div>
              <div className="relative min-h-[360px] p-4 sm:p-6">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:34px_34px]" />
                <div className="relative grid min-h-[312px] grid-cols-2 gap-3 sm:grid-cols-4">
                  {namespaces.map((namespace, index) => (
                    <div
                      className="flex min-h-32 flex-col justify-between rounded-md border border-white/15 bg-[#171b22]/90 p-4"
                      key={namespace.name}
                    >
                      <div>
                        <div className={`h-2 w-12 rounded-full ${namespace.color}`} />
                        <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-[#aab5c4]">
                          namespace
                        </p>
                        <h2 className="mt-1 text-2xl font-black">{namespace.name}</h2>
                      </div>
                      <div className="flex items-end justify-between">
                        <span className="font-mono text-sm text-[#dfe6ef]">
                          {namespace.value}
                        </span>
                        <span className="font-mono text-xs text-[#6f7d8d]">
                          0{index + 1}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="relative mt-3 grid grid-cols-[1fr_auto] items-center rounded-md border border-white/12 bg-[#f7f8f3] p-3 text-[#11141a]">
                  <span className="font-mono text-xs uppercase tracking-[0.14em] text-[#536171]">
                    context isolation active
                  </span>
                  <span className="h-2 w-20 rounded-full bg-[#657a42]" />
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {endpoints.map((endpoint) => (
                <a
                  className="rounded-md border border-[#11141a]/15 bg-[#f7f8f3] p-4 transition hover:-translate-y-0.5 hover:border-[#007e91]/60 hover:shadow-lg hover:shadow-[#11141a]/10 focus:outline-none focus:ring-2 focus:ring-[#007e91]"
                  href={endpoint.path}
                  key={endpoint.path}
                >
                  <span className="font-mono text-xs font-bold text-[#c84f31]">
                    {endpoint.method}
                  </span>
                  <p className="mt-3 font-mono text-sm text-[#11141a]">{endpoint.path}</p>
                  <p className="mt-2 text-sm text-[#536171]">{endpoint.label}</p>
                </a>
              ))}
            </div>
          </section>
        </div>

        <footer className="grid gap-3 border-t border-[#11141a]/15 py-4 text-sm text-[#536171] md:grid-cols-[1fr_auto]">
          <span>HTTP and MCP transports are live on Vercel.</span>
          <span className="font-mono text-xs uppercase tracking-[0.18em]">
            kristina-black.vercel.app
          </span>
        </footer>
      </section>
    </main>
  );
}
