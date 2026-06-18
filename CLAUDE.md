## Development Rules

### Before writing ANY code

1. **Check the registry first.** Every AI call must use `aiInvoke({ assetId })` or `invokeAsset({ assetId })`. System prompts live in `server/src/modules/novel/prompts/*.ts`. Never write inline prompt instructions in routes or services — they duplicate and rot.

2. **Check the Zod schema first.** Before mutating a Novel/Chapter, read `shared/types/novel.ts` for the exact field names, types, and constraints. If the client sends `[key: string]: unknown`, verify every key against the schema.

3. **Check the Prisma schema first.** Before reading/writing a DB field, read `server/prisma/schema.prisma` for the actual column name, type, and relations. JSON fields stored as strings MUST be parsed before access.

4. **Check existing services first.** Before adding a route handler, search for an existing service function that already does the work. The pipeline's `creationPipeline.ts`, `characterService.ts`, `loopTemplateService.ts`, `worldRuleService.ts` etc. are the canonical sources of business logic.

5. **Check the dependency chain.** Every AI generation step MUST receive the full context of all previous steps. See `creationPipeline.ts` `buildSerialContext()` for the canonical chain. When adding a new AI call, inject the upstream context into userPrompt.

### When fixing a bug

1. **Find the root cause, not the symptom.** If data displays wrong, trace back to where it's written, not just where it's read.
2. **Fix at the source, not at the consumer.** If `prohibitions` is stored as JSON array but schema says `String?`, fix the writer, don't add JSON.parse at every reader.
3. **Check if the same class of bug exists elsewhere.** If `commercialTags` had a type mismatch, audit all `mutateAsync` calls for the same pattern.

### When building a feature

1. **Reuse, don't rebuild.** Check if a component, prompt, service, or route already does 80% of what you need.
2. **Follow the existing architecture.** New prompts go in domain prompt files. New routes delegate to services. New components follow the existing domain/sub-tab pattern.
3. **Design for the dependency chain.** Every new step/concept must have a clear upstream and downstream relationship in the pipeline.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
