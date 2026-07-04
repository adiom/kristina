# AGENTS.md — cf-kristina Agent Project

## Project Overview
**cf-kristina** — автономный AI-агент‑runtime с постоянной памятью, саморефлексией, личностью и интересами. Подключается к внешним сервисам (Sfera, чат‑боты, news‑сайты, симуляции) через два транспорта:
- **HTTP** `POST /api/agent`
- **MCP (JSON‑RPC 2.0)** `POST /api/mcp` с tool‑ами `agent_message`, `agent_search`, `agent_info`

Вся агентная логика (личность, память, рефлексия, интересы, рассуждения, логирование, политика доступа) живёт **внутри** cf‑kristina. Внешние сервисы — лишь тонкие adapter‑ы: обнаруживают упоминание, формируют `AgentContext`, вызывают endpoint, рендерят `AgentResult`. Контракт описан в `docs/opencode-integration.md`.

Единая точка входа для транспортов — `processAgent(prompt, context)` в `src/agent/core.ts`. Версия протокола — `1.0.0` (см. `src/agent/version.ts`).

### Key Characteristics
- **Persistent memory** — помнит все разговоры и инсайты
- **Four-namespace memory** — общая память агента (`own`, `userId=NULL`) + память о людях (`user`, `userId=<id>`) + память пространства (`space`, `spaceId=<id>`) + память сервиса (`service`)
- **Context isolation** — каждый вызов изолирован через `memoryAccess`‑флаги; нет утечек данных между пользователями/пространствами/сервисами
- **Policy layer** — валидация контекста, проверка доступа к namespace, запрет записи, per‑service rate limiting (token bucket)
- **Self-reflection** — фоновый процесс рефлексии, извлекающий инсайты из памяти
- **Interest-driven exploration** — интересы формируются из памяти, эволюционируют через decay/growth
- **Dynamic personality** — черты личности хранятся в БД с историей изменений
- **Transparency** — все действия агента логируются в `activity_log` и видны на дашборде

## Tech Stack
- **Runtime**: Next.js 16 (App Router), React 19
- **Database**: PostgreSQL + pgvector (768‑dim embeddings)
- **ORM**: Drizzle (`drizzle-orm` + `drizzle-kit`, `pg` driver)
- **LLM**: локальный OpenAI‑compatible endpoint через LM Studio (`@ai-sdk/openai-compatible` + Vercel AI SDK `ai`). Модель по умолчанию — `qwen/qwen3-1.7b`
- **Embeddings**: локальная модель через Ollama OpenAI-compatible endpoint, `nomic-embed-text:latest` (768‑dim)
- **MCP Server**: `@modelcontextprotocol/sdk` (JSON‑RPC 2.0) — web transport via `src/app/api/mcp/route.ts`, standalone stdio via `src/mcp/server.ts`
- **Validation**: `zod`
- **UI**: React + Tailwind CSS v4
- **Testing**: Jest + ts-jest
- **Deployment**: Vercel (MVP)
- **Local dev**: `localhost:31337`

## Project Structure
```
cf-kristina/
├── src/
│   ├── agent/           # Ядро агента: processAgent, types, version, personality
│   │   └── __tests__/   # Тесты processAgent
│   ├── memory/          # Система памяти (4 namespace, pgvector, secret‑scan)
│   ├── reflection/      # Саморефлексия
│   ├── interests/       # Система интересов
│   ├── personality/     # Личность
│   ├── policy/          # Политика доступа: валидация, access‑флаги, rate limit
│   │   └── __tests__/   # Тесты policy
│   ├── mcp/             # MCP server helper
│   ├── transparency/    # Прозрачность (activity_log)
│   ├── dashboard/       # Агрегация данных для дашборда
│   ├── db/              # Схема БД + миграции Drizzle
│   └── app/             # Next.js App Router
│       ├── api/agent/   # HTTP‑транспорт  POST /api/agent
│       ├── api/mcp/     # MCP‑транспорт   POST /api/mcp
│       ├── api/dashboard/ # Данные дашборда
│       ├── dashboard/   # UI дашборда
│       └── chat/        # Тестовый чат‑UI
└── docs/                # Документация систем + opencode-integration.md
```

## Common Commands
```bash
# Dev
pnpm dev              # Start Next.js dev server on http://localhost:31337
pnpm build            # Build for production
pnpm start            # Start production server
pnpm lint             # Run ESLint

# Database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Apply migrations
pnpm db:push          # Push schema directly (dev)
pnpm db:studio        # Open Drizzle Studio

# Testing
pnpm test             # Run Jest tests
pnpm test:watch       # Watch mode
```

## Environment Variables
```env
# Database (PostgreSQL + pgvector)
DATABASE_URL=postgresql://...

# LLM (local OpenAI-compatible endpoint, e.g. LM Studio)
LM_STUDIO_URL=http://localhost:1234/v1

# Embeddings (Ollama OpenAI-compatible endpoint)
OLLAMA_URL=http://localhost:11434/v1
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
```

> Значения по умолчанию: LLM `qwen/qwen3-1.7b` через LM Studio, embeddings
> `nomic-embed-text:latest` через Ollama. Внешние облачные ключи
> (Anthropic/OpenAI) в текущем MVP не требуются.

## Important Patterns
1. **Four-namespace memory**: `own` (userId=NULL), `user` (userId=<id>), `space` (spaceId=<id>), `service` (service=<id>)
2. **Context isolation**: each call uses `AgentContext` with `memoryAccess` flags — no cross-user/space/service data leakage
3. **Reflection cycle**: select topic → search memory → LLM reasoning → extract insights (`ИНСАЙТ:` regex) → store → update interests
4. **Interest evolution**: linear decay (`DECAY_RATE * floor(days/7)`), growth (+0.5), cross-pollination (+0.2), archive (below threshold 2 for 30d)
5. **Transparency**: buffered writes (max 50 events or 5s flush) to `activity_log` table; dashboard via `/api/dashboard`
6. **Reflection diary**: `cf_kristina_diary` table stores topic, reflection text, and insights count per cycle

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
