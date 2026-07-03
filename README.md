# cf-kristina

Autonomous AI agent with persistent memory, self-reflection, and personality.

## Features

- **Persistent Memory** — Remembers all conversations and insights
- **Four-Namespace Memory** — Agent's own knowledge, user knowledge, space knowledge, service knowledge
- **Self-Reflection** — Scheduled introspection cycles with insight extraction
- **Interest System** — Autonomous exploration driven by evolving interests
- **Dynamic Personality** — Traits that evolve over time (DB-backed)
- **Transparency** — All actions logged and visible on dashboard
- **Dual Transport** — HTTP API + MCP JSON-RPC

## Tech Stack

- Next.js 16 (App Router)
- PostgreSQL + pgvector (768-dim embeddings)
- Drizzle ORM
- LM Studio (local OpenAI-compatible endpoint)
- Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Jest + ts-jest
- **Planned**: ATMv0 Protocol (economic simulations)

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# Run database migrations
pnpm db:generate
pnpm db:migrate

# Start development server
pnpm dev
```

## Project Structure

```
cf-kristina/
├── src/
│   ├── agent/           # Agent core: processAgent, types, version, personality
│   ├── memory/          # Memory system (4-namespace, pgvector, secret-scan)
│   ├── reflection/      # Self-reflection cycle
│   ├── interests/       # Interest system (decay, growth, cross-pollinate)
│   ├── personality/     # Dynamic traits (DB-backed)
│   ├── policy/          # Access control, rate limiting
│   ├── transparency/    # Activity logging (buffered writes)
│   ├── dashboard/       # Dashboard data aggregation
│   ├── mcp/             # MCP server (standalone stdio)
│   ├── db/              # Database schema + migrations
│   └── app/             # Next.js App Router
│       ├── api/agent/   # HTTP POST /api/agent
│       ├── api/mcp/     # MCP JSON-RPC POST /api/mcp
│       ├── api/dashboard/ # Dashboard data GET
│       ├── dashboard/   # Dashboard UI
│       └── chat/        # Test chat UI
├── docs/                # System documentation
└── public/              # Static assets
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent` | HTTP transport — calls processAgent |
| POST | `/api/mcp` | MCP JSON-RPC 2.0 — tools: agent_message, agent_search, agent_info |
| GET | `/api/dashboard` | Dashboard data (supports `?extended=1`) |

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Memory System](docs/MEMORY-SYSTEM.md)
- [Reflection System](docs/REFLECTION-SYSTEM.md)
- [Interest System](docs/INTEREST-SYSTEM.md)
- [Personality System](docs/PERSONALITY-SYSTEM.md)
- [Transparency System](docs/TRANSPARENCY-SYSTEM.md)
- [Integration Guide](docs/opencode-integration.md)

## Development

```bash
pnpm dev          # Start dev server on http://localhost:31337
pnpm build        # Build for production
pnpm test         # Run Jest tests
pnpm test:watch   # Watch mode
pnpm lint         # Run ESLint
pnpm db:studio    # Open Drizzle Studio
```

## Environment Variables

```env
# Database (PostgreSQL + pgvector)
DATABASE_URL=postgresql://...

# LLM + Embeddings (local OpenAI-compatible endpoint, e.g. LM Studio)
LM_STUDIO_URL=http://localhost:1234/v1
```

## License

Private — Canfly
