# cf-kristina

Autonomous AI agent with persistent memory, self-reflection, and personality.

## Features

- **Persistent Memory** — Remembers all conversations and insights
- **Dual-Namespace Memory** — Agent's own knowledge vs. knowledge about people
- **Self-Reflection** — Scheduled introspection cycles
- **Interest System** — Autonomous exploration driven by evolving interests
- **Dynamic Personality** — Traits that evolve over time
- **Transparency** — All actions logged and visible on dashboard

## Tech Stack

- Next.js 14+ (App Router)
- PostgreSQL + pgvector
- Drizzle ORM
- Claude API (Anthropic)
- MCP SDK
- ATMv0 Protocol

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
│   ├── agent/           # Agent core
│   ├── memory/          # Memory system
│   ├── reflection/      # Self-reflection
│   ├── interests/       # Interest system
│   ├── personality/     # Personality system
│   ├── channels/        # MCP, ATMv0
│   ├── transparency/    # Logging & dashboard
│   └── db/              # Database schema
├── dashboard/           # Dashboard UI
├── app/                 # Next.js routes
└── docs/                # Documentation
```

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Memory System](docs/MEMORY-SYSTEM.md)
- [Reflection System](docs/REFLECTION-SYSTEM.md)
- [Interest System](docs/INTEREST-SYSTEM.md)
- [Personality System](docs/PERSONALITY-SYSTEM.md)
- [Transparency System](docs/TRANSPARENCY-SYSTEM.md)

## License

Private — Canfly
