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
  index.ts      # Plugin entry — OpenAI client, provider implementation
  realtime.ts   # RealtimeClient WebSocket wrapper for gpt-realtime speech-to-speech
```

## Key Details

- **SDK**: `@openai/codex-sdk` npm package
- Implements `WOPRPlugin` from `@wopr-network/plugin-types`
- API key and base URL configured via plugin config schema; when `baseUrl` is set, traffic routes through the WOPR hosted gateway for metering and billing
- Model selection exposed through config (gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, codex-mini-latest)
- Streaming responses via `thread.runStreamed()` from `@openai/codex-sdk`

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-provider-openai`.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.