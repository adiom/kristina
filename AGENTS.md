# AGENTS.md — паспорт проекта cf-kristina

Этот файл — единая инструкция для любых LLM-агентов, работающих с репозиторием:
Codex, Claude Code, OpenCode и других. Не создавайте отдельные инструкции под
конкретный инструмент. Если архитектура или обязательные правила меняются,
обновляйте этот файл вместе с кодом.

## 1. Назначение проекта

**cf-kristina** — автономный AI-agent runtime с постоянной памятью,
саморефлексией, интересами, динамической личностью и журналом действий.

Внешние продукты не должны дублировать интеллект агента. Они выступают тонкими
адаптерами: обнаруживают событие, собирают `AgentContext`, вызывают Kristina и
отображают `AgentResult`. Личность, память, policy, reasoning, reflection,
interests и transparency принадлежат этому репозиторию.

Главная точка входа runtime:

```ts
processAgent(prompt, context)
```

Файл: `src/agent/core.ts`.

## 2. Источники истины

При расхождении документации и реализации доверяйте источникам в таком порядке:

1. Типы и runtime-код в `src/`.
2. Схема БД и миграции в `src/db/`.
3. Тесты.
4. `package.json` и `.env.example`.
5. Этот паспорт.
6. Остальные Markdown-файлы.

Подробная документация полезна как контекст, но часть примеров может отставать
от кода. Не копируйте из неё API, SQL или константы без проверки реализации.

Карта документации:

- `README.md` — краткий вход в проект.
- `ARCHITECTURE.md` — архитектурный обзор и потоки данных.
- `docs/opencode-integration.md` — контракт внешних адаптеров.
- `docs/*-SYSTEM.md` — устройство отдельных подсистем.
- `PROGRESS.md`, `TODO.md` — исторический статус и планы, не спецификация.
- `MEMORY.md` — исторический контекст проекта, не память LLM-сессии.

## 3. Текущий стек

- Next.js 16, App Router, React 19, TypeScript.
- PostgreSQL + pgvector, Drizzle ORM, `pg` driver.
- Vercel AI SDK (`ai`).
- LLM: LM Studio через `@ai-sdk/openai-compatible` по умолчанию; Groq
  поддерживается через `LLM_PROVIDER=groq`.
- Embeddings: Ollama OpenAI-compatible endpoint,
  `nomic-embed-text:latest`, размерность 768.
- MCP SDK присутствует для standalone stdio server.
- Zod для схем инструментов и валидации структурированного LLM-вывода.
- Jest + ts-jest для тестов.
- Tailwind CSS v4 для UI.
- Деплой MVP: Vercel; production-домен сейчас
  `https://kristina-black.vercel.app`.

Не добавляйте внешний cloud LLM как обязательную зависимость: локальный режим
должен оставаться базовым сценарием.

## 4. Архитектура и границы

```text
External service / UI
        |
        | HTTP or MCP
        v
Transport adapter (src/app/api/*)
        |
        v
processAgent (src/agent/core.ts)
        |
        +-- policy / context validation / rate limit
        +-- personality and prompt construction
        +-- memory retrieval and persistence
        +-- vault and cross-service identity
        +-- LLM generation
        +-- activity logging
        |
        v
PostgreSQL + pgvector
```

Основные каталоги:

```text
src/agent/          core runtime, types, version, fixed personality
src/memory/         four-namespace memory, embeddings, extraction, secret scan
src/vault/          user vaults, files, profiles, identity links
src/policy/         context validation, access control, rate limiting
src/reflection/     reflection cycle and diary
src/interests/      interest lifecycle
src/personality/    DB-backed dynamic traits
src/transparency/   buffered activity log
src/dashboard/      dashboard aggregation
src/db/             Drizzle schema and migrations
src/mcp/            standalone stdio MCP server
src/app/api/        HTTP transport adapters
src/app/dashboard/  operator UI
```

Транспортный код должен быть тонким. Не переносите business logic из
`processAgent` в route handlers или внешние интеграции.

## 5. Публичные интерфейсы

### HTTP agent API

- `POST /api/agent`
- Вход: `{ prompt, context, attachments? }`.
- Выход: `AgentResult`.
- Версия контракта агента: `1.0.0` в `src/agent/version.ts`.

### Web MCP endpoint

- `POST /api/mcp`
- Tools: `agent_message`, `agent_search`, `agent_info`.
- Реализация использует официальный `WebStandardStreamableHTTPServerTransport`
  SDK в stateless-режиме, подходящем для Vercel serverless functions.
- Не путайте версию контракта агента `1.0.0` с версией MCP protocol: MCP
  protocol version согласовывается SDK отдельно.

### Standalone MCP

- `src/mcp/server.ts` запускает stdio MCP server через официальный SDK.
- Настройки: `MCP_SERVER_HOST`, `MCP_SERVER_PORT` могут присутствовать в env,
  но проверяйте фактическое использование перед изменением.

### Dashboard and vault

- `GET /api/dashboard`, опционально `?extended=1`.
- `GET /api/vault`.
- `GET|POST /api/vault/items`.
- `/dashboard` — UI оператора.

Точные формы данных всегда сверяйте с route handlers и `src/agent/types.ts`.

## 6. Критические инварианты

### Изоляция памяти

Память разделена на четыре namespace:

- `own` — собственная память агента, `userId = NULL`.
- `user` — память о человеке.
- `space` — память пространства/разговора.
- `service` — память внешнего сервиса.

Каждый доступ обязан учитывать `context.memoryAccess`. Запрещено:

- читать namespace при выключенном флаге;
- смешивать данные пользователей, пространств или сервисов;
- обходить `canAccessMemory` ради удобства;
- сохранять память при `memoryAccess.write = false`.

### Identity и vault

- Локальная личность определяется парой `serviceId + userId`.
- `globalUserId` связывает одного человека между сервисами.
- `vault_identity_links` хранит cross-service связи.
- Не объединяйте личности эвристически. Связь должна быть явно передана или
  найдена в таблице identity links.

### Безопасность данных

- Не коммитьте `.env.local`, ключи, пароли, токены и приватные данные.
- Любая сохраняемая память проходит secret scan.
- `AgentResult.text` считается недоверенным при HTML-рендеринге.
- Публичные вызовы проходят policy validation и per-service rate limit.
- Ошибки API не должны раскрывать secrets, SQL или содержимое чужой памяти.

### Векторные embeddings

- Текущая размерность pgvector: 768.
- Модель embeddings по умолчанию: `nomic-embed-text:latest` через Ollama.
- Смена модели допустима только при сохранении размерности либо с миграцией БД
  и переиндексацией существующих embeddings.

### Версионирование

- `PROTOCOL_VERSION` сейчас означает версию контракта `AgentContext` /
  `AgentResult`, а не версию MCP specification.
- Breaking change публичного контракта требует обновить версию, типы, оба
  транспорта, документацию интеграции и тесты.

## 7. Ключевое поведение подсистем

- Reflection: выбор темы -> поиск памяти -> LLM reflection -> извлечение строк
  `ИНСАЙТ:` -> сохранение -> diary -> обновление interests.
- Interests: рост `+0.5`, cross-pollination `+0.2`, линейный decay по неделям,
  архивирование слабых неактивных интересов. Проверяйте актуальные константы в
  `src/interests/index.ts`.
- Personality: фиксированный core prompt в `src/agent/personality.ts` плюс
  DB-backed traits с историей в `src/personality/index.ts`.
- Transparency: buffered writes в `activity_log`; события нельзя терять при
  ошибке flush.
- Memory extraction: explicit и automatic memory flows разделены; сохраняйте
  это различие при изменениях.

## 8. База данных

Ключевые таблицы из `src/db/schema.ts`:

- `cf_kristina_memory`.
- `cf_kristina_vaults`.
- `cf_kristina_vault_items`.
- `cf_kristina_vault_events`.
- `cf_kristina_vault_identity_links`.
- `cf_kristina_interests`.
- `cf_kristina_traits`.
- `cf_kristina_activity_log`.
- `cf_kristina_diary`.

При изменении схемы:

1. Измените `src/db/schema.ts`.
2. Создайте новую Drizzle migration; не переписывайте уже применённую миграцию.
3. Проверьте все readers/writers и API serialization.
4. Добавьте тест на новое поведение.
5. Обновите этот паспорт, если изменился архитектурный контракт.

## 9. Переменные окружения

Основные:

```env
DATABASE_URL=postgresql://...

LLM_PROVIDER=lmstudio
LM_STUDIO_URL=http://localhost:1234/v1

# Только для LLM_PROVIDER=groq
GROQ_API_KEY=...

OLLAMA_URL=http://localhost:11434/v1
OLLAMA_EMBED_MODEL=nomic-embed-text:latest
```

Дополнительные/planned значения перечислены в `.env.example`. Не считайте
наличие переменной доказательством реализованной функциональности: найдите её
использование в `src/`.

## 10. Рабочий процесс для LLM-агента

Перед изменением:

1. Прочитайте этот файл полностью.
2. Проверьте `git status`; не перезаписывайте чужие незавершённые изменения.
3. Найдите связанные типы, call sites, tests и миграции.
4. Отделите фактическое текущее поведение от planned-документации.

Во время изменения:

- Делайте минимальное изменение, сохраняющее архитектурные границы.
- Используйте строгие TypeScript-типы; не расширяйте `any` без необходимости.
- Валидируйте данные на transport boundary.
- Не обращайтесь к БД из UI, если уже существует server/domain слой.
- Не дублируйте memory access, policy или identity logic в route handlers.
- Для файлов: components — `kebab-case.tsx`, utilities — `camelCase.ts`,
  App Router handlers — `route.ts`, DB schema — `schema.ts`.
- Комментарии добавляйте только там, где причина решения неочевидна из кода.

После изменения:

1. Запустите узкие тесты для изменённой области.
2. Запустите полный `pnpm test` для изменений core/policy/memory/DB contracts.
3. Запустите `pnpm lint` и `pnpm build`, если изменение затрагивает runtime,
   routes, types, dependencies или UI.
4. Проверьте `git diff --check` и итоговый diff.
5. Укажите, какие проверки не удалось выполнить и почему.

## 11. Команды

```bash
pnpm dev              # Next.js dev server: http://localhost:31337
pnpm build            # production build
pnpm start            # production server
pnpm lint             # ESLint

pnpm test             # Jest
pnpm test:watch       # Jest watch mode

pnpm db:generate      # generate Drizzle migration
pnpm db:migrate       # apply migrations
pnpm db:push          # push schema directly (development only)
pnpm db:studio        # Drizzle Studio
```

Не запускайте `db:push` против production и не применяйте миграции без явно
указанного окружения.

## 12. Минимальная проверка по типу изменения

| Изменение | Обязательная проверка |
|---|---|
| Agent core / types | unit tests, lint, build, оба transport call site |
| Memory / policy | isolation tests, write-forbidden path, secret scan |
| DB schema | migration, affected queries, clean build |
| MCP | initialize, tools/list, tools/call, error path, реальный MCP client |
| HTTP route | valid request, invalid context, rate limit, internal error |
| UI | lint, build, ручная проверка основных состояний |
| Documentation only | ссылки, команды, соответствие текущему коду |

## 13. Definition of Done

Задача завершена, когда:

- реализовано запрошенное поведение без нарушения isolation и policy;
- публичные типы и транспорты согласованы;
- добавлены или обновлены релевантные тесты;
- миграция присутствует, если менялась схема;
- документация не выдаёт planned-функции за реализованные;
- lint/tests/build прошли в объёме, соответствующем риску;
- в diff нет secrets, случайных generated-файлов и посторонних изменений.

## 14. Ближайшие архитектурные риски

- Web `/api/mcp` использует stateless MCP Streamable HTTP; при дальнейшем
  развитии нужно сохранять раздельное версионирование MCP и agent contract.
- Несколько подробных Markdown-файлов содержат исторические примеры, способные
  расходиться с актуальной схемой и кодом.
- Planned-функции (ATMv0, WebSocket updates, scheduled reflection) нельзя
  считать реализованными без подтверждения в `src/` и тестах.
