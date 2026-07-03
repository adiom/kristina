# CLAUDE.md — cf-kristina Agent Project

## Project Overview
**cf-kristina** — автономный AI-агент‑runtime с постоянной памятью, саморефлексией, личностью и интересами. Подключается к внешним сервисам (Sfera, чат‑боты, news‑сайты, симуляции) через два транспорта:
- **HTTP** `POST /api/agent`
- **MCP (JSON‑RPC 2.0)** `POST /api/mcp` с tool‑ами `agent_message`, `agent_search`, `agent_info`

Вся агентная логика (личность, память, рефлексия, интересы, рассуждения, логирование, политика доступа) живёт **внутри** cf‑kristina. Внешние сервисы — лишь тонкие adapter‑ы: обнаруживают упоминание, формируют `AgentContext`, вызывают endpoint, рендерят `AgentResult`. Контракт описан в `docs/opencode-integration.md`.

Единая точка входа для транспортов — `processAgent(prompt, context)` в `src/agent/core.ts`. Версия протокола — `1.0.0` (см. `src/agent/version.ts`).

### Key Characteristics
- **Persistent memory** — помнит все разговоры и инсайты
- **Dual-namespace memory** — общая память агента (`userId=NULL`) + память о конкретных людях (`userId=<id>`)
- **Context isolation** — каждый диалог изолирован, нет утечек данных между пользователями
- **Self-reflection** — фоновый процесс рефлексии, извлекающий инсайты из памяти
- **Interest-driven exploration** — интересы формируются из памяти, эволюционируют через decay/growth
- **Dynamic personality** — черты личности хранятся в БД с историей изменений
- **Transparency** — все действия агента логируются и видны на дашборде

## Tech Stack
- **Runtime**: Next.js 14+ (App Router)
- **Database**: PostgreSQL + pgvector (Supabase или Neon)
- **ORM**: Drizzle
- **LLM**: Claude (Anthropic) через Vercel AI SDK
- **Embeddings**: nomic-embed-text (local) или OpenAI
- **MCP Server**: @modelcontextprotocol/sdk
- **ATMv0 Client**: ws (WebSocket)
- **UI**: React + Tailwind + Radix UI
- **Deployment**: Vercel (MVP)
- **Local dev**: localhost:3000

## Project Structure
```
cf-kristina/
├── src/
│   ├── agent/           # Ядро агента
│   ├── memory/          # Система памяти
│   ├── reflection/      # Саморефлексия
│   ├── interests/       # Система интересов
│   ├── personality/     # Личность
│   ├── channels/        # Каналы (MCP, ATMv0)
│   ├── transparency/    # Прозрачность
│   └── db/              # Схема БД
├── dashboard/           # UI дашборда
├── app/                 # Next.js App Router
└── docs/                # Документация
```

## Common Commands
```bash
# Dev
pnpm dev              # Start Next.js dev server
pnpm build            # Build for production
pnpm lint             # Run linter

# Database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Apply migrations
pnpm db:studio        # Open Drizzle Studio

# Testing
pnpm test             # Run tests
pnpm test:watch       # Watch mode
```

## Environment Variables
```env
# Database
DATABASE_URL=postgresql://...

# LLM
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...  # For embeddings

# MCP
MCP_SERVER_PORT=3001

# ATMv0
ATM_SERVER_URL=ws://localhost:8080
```

## Important Patterns
1. **Dual-namespace memory**: `userId=NULL` for agent's own knowledge, `userId=<id>` for user-specific
2. **Context isolation**: each conversation gets its own `IsolatedContext`
3. **Reflection cycle**: scheduled triggers → select topic → explore → extract insights → update interests
4. **Interest evolution**: decay (7d), growth (3d), cross-pollination, archive (below threshold 2 for 30d)
5. **Transparency**: all actions logged to `activity_log` table with real-time WebSocket stream

## File Naming Conventions
- Components: `kebab-case.tsx`
- Utilities: `camelCase.ts`
- Database schema: `schema.ts`
- API routes: `route.ts` (Next.js App Router)

## Security Notes
- Never commit `.env.local`
- All memory entries scanned for secrets before storage
- Rate limiting on public endpoints
- Context isolation prevents cross-user data leakage
