# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

One2Novel is an AI-powered long-form Chinese web novel creation workstation (从一句灵感到一本小说). It supports a complete pipeline: idea → story core → character/volume planning → chapter writing → quality audit → revision. Built as a monorepo with pnpm workspaces: `client` (React/Vite SPA), `server` (Express + Prisma/SQLite), `shared` (Zod schemas + TS types), and `desktop` (Electron runtime).

## Common Commands

```bash
# Full dev (server + client)
pnpm dev

# Individual workspace dev
pnpm dev:server          # Express server with tsx watch
pnpm dev:client          # Vite dev server

# Build pipeline (order matters: shared → server → client)
pnpm build

# Type check all workspaces
pnpm typecheck

# Database (Prisma + SQLite)
pnpm db:push             # Push schema to dev.db (no migrations)
pnpm db:studio           # Prisma Studio GUI
pnpm --filter @one2novel/server prisma:generate   # Regenerate Prisma client

# Server tests
pnpm test                # Runs tsx --test server/tests/**/*.test.js

# Desktop (Electron)
pnpm dev:desktop         # Build all + launch Electron
pnpm build:desktop       # Build Electron app
pnpm dist:desktop        # Package Windows installer (NSIS)
```

Environment: Node ≥20, pnpm ≥10.6. Database is SQLite (`dev.db`, gitignored). LLM providers configured via `.env` (see `.env.example`): DeepSeek (default), OpenAI, Anthropic, Gemini, Qwen, Moonshot.

## Architecture

### Monorepo layout
```
├── client/               React 19 + Vite 7 + Tailwind + React Router 7
│   └── src/
│       ├── app/          Router (hash in desktop, history in web), API client (axios), TanStack Query
│       ├── pages/        Top-level routes: StartPage, NovelsPage, PlanningHubPage, NovelWorkspacePage, SettingsPage
│       ├── components/   Domain-organized: workspace/, planning/, pipeline/, characters/, style/, settings/
│       └── lib/          Runtime config (web vs desktop), constants
├── server/               Express 5 + Prisma 7 + SQLite + LangChain
│   └── src/
│       ├── app/          createApp() (http.ts), registerRoutes() (routes.ts), sub-router modules
│       ├── modules/      Domain modules: novel/, payoff/, settings/, style/, timeline/
│       └── platform/     Cross-cutting: db/, llm/, config/, errors/, events/, logging/, rag/, concurrency/
├── shared/               Shared Zod schemas + TS types (built to dist/)
│   └── types/            novel.ts (schemas, DTOs, long-form types), architectureProfile.ts
└── desktop/              Electron 35 app — wraps server + serves client build
```

### Server architecture

**Request flow**: `app.ts` → `createApp()` (http.ts: helmet/CSP, CORS, JSON parser) → `registerRoutes()` (routes.ts: sub-routers + timeline/state/RAG endpoints) → domain route handlers → services → Prisma.

All routes use `errorHandlerWrap()` for try/catch → JSON error response. Error responses follow `{ error: { code, message, details? } }` shape.

**Domain modules** (`server/src/modules/`):
- `novel/` — Core novel domain, split into sub-modules:
  - `setup/` — CRUD routes for novels, chapters, characters, volumes, reference books
  - `planning/` — Story core generation, character prep, reference book analysis, architecture engine, story macro
  - `production/` — Chapter writing pipeline, quality gates, repair, revision, post-write hooks, audit, state snapshots
  - `production/writing/` — `chapterPipeline.ts` (unified single-chapter processing: generate → quality → repair → persist → hooks), `chapterWriter.ts` (SSE streaming), `chapterGenerator.ts` (core LLM content generation)
  - `director/` — `directorService.ts` (batch auto-write with checkpoint/crash-recovery, progress tracking, loop-boundary pauses)
  - `prompts/` — Prompt registry (side-effect imports register into `promptRegistry`)
  - `world/` — World rules management
  - `export/` — Chapter export functionality
- `payoff/` — Foreshadowing/payoff ledger tracking
- `timeline/` — Timeline conflict detection, chapter reminders
- `settings/` — Preferences, API key storage, provider config
- `style/` — Style profiles and bindings

**Platform layer** (`server/src/platform/`):
- `db/client.ts` — Singleton PrismaClient with better-sqlite3 adapter, template-based schema init, connection age management (forced reconnect to prevent WAL bloat)
- `llm/` — Unified AI invocation layer:
  - `aiService.ts` — `aiInvoke()` (prompt + user prompt), `invokeAsset()` (context block selection), `promptRegistry` (centralized prompt assets), provider/model resolution
  - `structuredInvoke.ts` — Core structured LLM call with multi-phase output repair (type normalization, field-name repair, array wrapping, null→undefined, retry with repair prompt)
  - `provider.ts` — LLM provider abstraction (LangChain adapters for OpenAI-compatible, Anthropic, Google)
  - `contextSelection.ts` — Context block selection with token budget management
  - `connectivity.ts` — LLM provider health probing
- `config/providers.ts` — **Single source of truth** for all LLM provider metadata (IDs, env vars, models, base URLs, JSON support). Consumers read from `PROVIDER_REGISTRY`.
- `config/env.ts` — Environment variable loading/validation
- `errors/` — `AppError` class, `errorMiddleware`, `requestErrorHandler`
- `events/bus.ts` — `novelEventBus` (EventEmitter) for cross-module events like `chapter.completed`
- `data/repositories.ts` — Data access repository pattern (e.g., `createNovelRepo()`)
- `logging/` — Event error logging
- `rag/` — Retrieval-Augmented Generation service with degradation tracking
- `concurrency/` — Concurrency control utilities
- `rateLimit/` — Rate limiting middleware

### LLM invocation pattern (CRITICAL)

**Every AI call MUST go through the prompt registry.** Never write inline system prompts in routes or services.

1. Prompts are registered in `server/src/modules/novel/prompts/*.ts` with `promptRegistry.register({ id, taskType, version, systemPrompt, contextRequirements?, contextPolicy? })`
2. Services call `aiInvoke({ assetId, userPrompt, schema, ... })` or `invokeAsset({ assetId, blocks, schema, ... })`
3. `aiService.ts` resolves system prompt from registry, injects skill rules, generates format hints from Zod schema, and delegates to `invokeStructuredLlm()`
4. Task-specific defaults (temperature, maxTokens) are set per `TaskType`: writer (0.85/8192), reviewer (0.3/2048), planner (0.8/8192), extractor (0.5/4096), compiler (0.3/2048), repairer (0.5/8192)
5. Default provider resolved from preferences (falls back to "deepseek")

### Chapter writing pipeline

The core writing flow (manual or auto) follows:

1. **Context assembly** — `assembleChapterContext()` gathers novel info, characters, previous chapters, world rules, payoffs, timeline
2. **Semantic memory injection** — `buildMemoryPack()` loads categorized MemoryItem records, filters by time window (50 chapters), applies budget limits, compiles into `semantic_memory` context block (priority 92)
3. **Content generation** — `generateChapterContentCore()` calls LLM with context blocks (selectively chosen by token budget)
3. **Quality gate** — `runQualityGate()` scores on 10 dimensions + returns `issues[]` (with category/evidence/blocking/location) + `dimensionResults[]` (5-dimension pass/fail aligned with wNW reviewer schema)
4. **Conditional repair** — If score < threshold: `patchRepair()` (light) or `heavyRepair()` (deep) with targeted fix prompt, then re-score
5. **Persistence** — Update chapter content, status, quality scores in DB
6. **Post-write hooks** — Fire-and-forget: timeline extraction, incremental summary compression, character state updates, payoff tracking, **memory沉淀** (`memoryWriter.ts` extracts character states, key events, world rules, and open loops from existing hook results — zero extra LLM calls)
7. **Finalization** — Consistency check against chapter plan, workspace diagnosis

### Data model (key Prisma entities)

See `server/prisma/schema.prisma` for the full schema. Key entities:
- **Novel** — Book framing, creative parameters, long-form architecture (loop skeleton, golden finger, power system), pipeline state
- **Chapter** — Content, status enum (7 states), quality scores (10 dimensions), scene plan, open conflicts, timeline, diagnosis
- **NovelCharacter** — Identity, appearance, voice, prohibitions, loop function tag, state journals, lifecycle
- **Volume / VolumeChapterPlan** — Structure blueprint with loop phase tracking, cool point types, content beats
- **PayoffLedgerItem** — Foreshadowing/payoff tracking with status lifecycle
- **WorldRule** — Executable world rules with priority and conflict detection
- **AuditReport / AuditIssue** — Quality audit results
- **StyleProfile / StyleBinding** — Prose style system
- **EntityStateJournal / EntityLifecycle** — Character state change tracking and lifecycle (alive/dead/absent...)
- **ChaseDebt / OverrideContract** — Long-form debt system (hooks, coolpoints accrue interest if unpaid)
- **MemoryItem** — Semantic memory store for write-before injection / write-after沉淀. Categories: world_rule, character_state, relationship, story_fact, open_loop, reader_promise, timeline. Deduplicated by (category, subject, field). See `server/src/modules/novel/production/post/memoryWriter.ts` and `memoryOrchestrator.ts`.

### Client architecture

- **Router**: `createHashRouter` in desktop mode, `createBrowserRouter` in web mode
- **State**: TanStack Query with custom query client; REST API via axios interceptor
- **Pages**: StartPage (landing) → NovelsPage (list) → NovelWorkspacePage (writing) / PlanningHubPage (planning) / SettingsPage
- **NovelWorkspacePage**: Tabbed workspace with ChapterWritePanel (SSE streaming), ReviewPanel, RevisionWorkbench, DirectorPanel (auto-write), TimelinePanel, PayoffPanel, CharacterPanel, StylePanel, WritingDashboard
- **PlanningHubPage**: Domain tabs for Foundation, StoryCore, Characters, Architecture, Blueprint, World

### Shared types

`shared/` exports Zod validation schemas and TypeScript types consumed by both client and server. Always check `shared/types/novel.ts` before mutating Novel/Chapter data. All JSON fields in Prisma are stored as serialized strings and must be parsed at the repository/service layer.

## Development Rules

### Before writing ANY code

1. **Check the prompt registry first.** Every AI call must use `aiInvoke({ assetId })` or `invokeAsset({ assetId })`. System prompts live in `server/src/modules/novel/prompts/*.ts`. Never write inline prompt instructions in routes or services.

2. **Check the Zod schema first.** Before mutating a Novel/Chapter, read `shared/types/novel.ts` for the exact field names, types, and constraints.

3. **Check the Prisma schema first.** Before reading/writing a DB field, read `server/prisma/schema.prisma` for the actual column name, type, and relations. JSON fields stored as strings MUST be parsed before access.

4. **Check existing services first.** Before adding a route handler, search for an existing service function that already does the work.

5. **Check the dependency chain.** Every AI generation step MUST receive the full context of all previous steps.

### When fixing a bug

1. Find the root cause, not the symptom. Trace back to where data is written.
2. Fix at the source, not at the consumer.
3. Audit for the same class of bug elsewhere.

### When building a feature

1. Reuse existing components, prompts, services, and routes.
2. Follow existing architecture — new prompts go in domain prompt files, new routes delegate to services.
3. Design for the dependency chain — every new step must have clear upstream/downstream relationships.
