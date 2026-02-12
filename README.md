# wopr-plugin-provider-openai

[![npm version](https://img.shields.io/npm/v/@wopr-network/wopr-plugin-provider-openai.svg)](https://www.npmjs.com/package/@wopr-network/wopr-plugin-provider-openai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![WOPR](https://img.shields.io/badge/WOPR-Plugin-blue)](https://github.com/wopr-network/wopr)

OpenAI provider plugin for [WOPR](https://github.com/wopr-network/wopr), powered by the Codex agent SDK.

> Part of the [WOPR](https://github.com/wopr-network/wopr) ecosystem - Self-sovereign AI session management over P2P.

## Features

- **Session Resumption**: Resume conversations via thread IDs
- **Reasoning Effort Control**: Configurable from minimal to extra-high
- **Streaming Events**: Real-time streaming of agent responses
- **Tool Support**: Command execution, file changes, and MCP tool calls
- **Image Support**: Pass images in prompts

## Prerequisites

- Node.js LTS (v20+)
- WOPR installed and configured
- One of the following:
  - ChatGPT Plus or Pro subscription (for OAuth authentication)
  - OpenAI API key (for API authentication)

## Installation

### From GitHub (Recommended)

```bash
wopr plugin install github:wopr-network/wopr-plugin-provider-openai
```

### From npm

```bash
wopr plugin install @wopr-network/wopr-plugin-provider-openai
```

**Note**: This plugin requires the `@openai/codex-sdk` package as a dependency.

### Verify Installation

```bash
wopr plugin list
```

You should see `wopr-plugin-provider-openai` in the list.

## Authentication

The OpenAI plugin supports two authentication methods:

### Option 1: OAuth Authentication (ChatGPT Plus/Pro)

This is the recommended method if you have a ChatGPT Plus or Pro subscription.

#### Step 1: Install the Codex CLI

```bash
npm install -g @openai/codex
```

#### Step 2: Authenticate with Device Auth

For headless/terminal environments, use device authentication:

```bash
codex login --device-auth
```

This will display:
1. A URL to visit in your browser
2. A code to enter on that page

Open the URL in your browser, enter the code, and authorize access with your ChatGPT account.

#### Step 3: Verify Credentials

Credentials are saved to `~/.codex/auth.json`. Verify the file exists:

```bash
cat ~/.codex/auth.json
```

### Option 2: API Key Authentication

If you have an OpenAI API key:

```bash
wopr providers add openai sk-your-api-key-here
```

Or set the environment variable:

```bash
export OPENAI_API_KEY=sk-your-api-key-here
```

## Verify Provider is Available

### Step 1: Restart the WOPR Daemon

```bash
wopr daemon restart
```

### Step 2: Check Provider Health

```bash
wopr providers health-check
```

You should see:
```
openai: available
```

## Usage

### Create a Session with OpenAI Provider

```bash
wopr session create my-session --provider openai
```

### Set Provider on Existing Session

```bash
wopr session set-provider my-session openai
```

### Resume a Session

Pass a thread ID to resume a previous conversation:

```javascript
const result = await client.query({
  prompt: "Continue from where we left off",
  resume: "thread_abc123"  // Thread ID from previous session
});
```

### Reasoning Effort

Control how much effort the model puts into reasoning. Can be set via:

1. **Temperature mapping** (automatic): Lower temperature = higher reasoning effort
   - `temp <= 0.2` -> `xhigh` (most thorough)
   - `temp <= 0.4` -> `high`
   - `temp <= 0.6` -> `medium` (default)
   - `temp <= 0.8` -> `low`
   - `temp > 0.8` -> `minimal` (fastest)

2. **Config schema**: Select directly in UI configuration

## Supported Models

Models are populated dynamically from the Codex SDK via `listModels()`. The SDK chooses a default model when none is specified.

## Streaming Events

The provider yields various event types during query execution:

| Event Type | Description |
|------------|-------------|
| `session_id` | Thread ID for session resumption |
| `text` | Agent message text |
| `reasoning` | Model's reasoning output |
| `tool_use` | Command execution, file changes, MCP calls |
| `usage` | Token usage statistics |
| `error` | Error messages |

## API Reference

### Provider Options

| Option | Type | Description |
|--------|------|-------------|
| `workingDirectory` | string | Directory for agent operations (default: `process.cwd()`) |
| `sandboxMode` | string | Sandbox mode for file access (default: `workspace-write`) |
| `approvalPolicy` | string | Tool approval policy (default: `never` - auto-approve) |
| `model` | string | Model to use (optional, SDK chooses default) |
| `modelReasoningEffort` | string | Reasoning effort level |

### Query Options

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | string | The user's prompt |
| `systemPrompt` | string | Optional system context |
| `resume` | string | Thread ID to resume |
| `model` | string | Model override |
| `temperature` | number | Maps to reasoning effort (0-1) |
| `images` | string[] | Image URLs to include |
| `providerOptions` | object | Additional provider-specific options |

## Troubleshooting

### Provider Shows "Available: none"

1. **Check daemon logs:**
   ```bash
   tail -f ~/wopr/daemon.log
   ```

2. **Restart the daemon:**
   ```bash
   wopr daemon restart
   ```

3. **Verify credentials exist:**
   ```bash
   ls -la ~/.codex/auth.json
   ```

### OAuth Token Expired

If you see "Your access token could not be refreshed because your refresh token was already used":

```bash
codex login --device-auth
```

Then restart the daemon:

```bash
wopr daemon restart
```

### Plugin Not Loading

1. **Check plugin is enabled:**
   ```bash
   wopr plugin list
   ```

2. **Check plugin path:**
   ```bash
   cat ~/wopr/plugins.json
   ```

3. **Verify plugin directory exists:**
   ```bash
   ls -la ~/wopr/plugins/wopr-plugin-provider-openai/
   ```

## Development

```bash
git clone https://github.com/wopr-network/wopr-plugin-provider-openai.git
cd wopr-plugin-provider-openai
npm install
npm run build
```

## License

MIT
