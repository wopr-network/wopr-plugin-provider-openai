# wopr-plugin-provider-openai

OpenAI provider plugin for WOPR. Wraps the OpenAI API for use as a WOPR LLM provider.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run lint:fix  # biome check --fix src/
npm run format    # biome format --write src/
npm test          # vitest run
```

## Architecture

```
src/
  index.ts   # Plugin entry — OpenAI client, provider implementation
```

## Key Details

- **SDK**: `openai` npm package
- Implements `ProviderPlugin` from `@wopr-network/plugin-types`
- API key and base URL configured via plugin config schema (supports Azure OpenAI via base URL override)
- Model selection exposed through config (gpt-4o, gpt-4o-mini, o1, etc.)
- Streaming responses via OpenAI streaming API

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-provider-openai`.
