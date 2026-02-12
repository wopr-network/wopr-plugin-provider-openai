# OpenAI Provider Configuration

## Authentication

The OpenAI provider supports two authentication methods:

### Option 1: OAuth Authentication (Recommended)

For ChatGPT Plus/Pro subscribers using device authentication:

```bash
# Install Codex CLI
npm install -g @openai/codex

# Authenticate with device auth
codex login --device-auth
```

Credentials are saved to `~/.codex/auth.json`.

### Option 2: API Key Authentication

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiKey` | string | **Yes** | OpenAI API key |

Set via CLI:
```bash
wopr providers add openai sk-your-api-key-here
```

Or environment variable:
```bash
export OPENAI_API_KEY=sk-your-api-key-here
```

## Provider Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `workingDirectory` | string | `process.cwd()` | Directory for agent operations |
| `sandboxMode` | string | `"workspace-write"` | Sandbox mode for file access |
| `approvalPolicy` | string | `"never"` | Tool approval policy (auto-approve) |
| `model` | string | SDK default | Model to use (optional) |
| `modelReasoningEffort` | string | - | Reasoning effort level |

## Reasoning Effort Levels

Control how much effort the model puts into reasoning:

| Level | Description | Use Case |
|-------|-------------|----------|
| `xhigh` | Most thorough reasoning | Complex multi-step problems |
| `high` | Detailed reasoning | Architecture decisions |
| `medium` | Balanced (default) | General tasks |
| `low` | Quick reasoning | Simple queries |
| `minimal` | Fastest response | Trivial tasks |

### Temperature Mapping

Temperature is automatically mapped to reasoning effort:

| Temperature | Reasoning Effort |
|-------------|------------------|
| ≤ 0.2 | `xhigh` |
| ≤ 0.4 | `high` |
| ≤ 0.6 | `medium` |
| ≤ 0.8 | `low` |
| > 0.8 | `minimal` |

## Configuration Example

```json
{
  "workingDirectory": "/path/to/workspace",
  "sandboxMode": "workspace-write",
  "approvalPolicy": "never",
  "modelReasoningEffort": "high"
}
```

## Query Options

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | string | The user's prompt |
| `systemPrompt` | string | Optional system context |
| `resume` | string | Thread ID to resume |
| `model` | string | Model override |
| `temperature` | number | Maps to reasoning effort (0-1) |
| `images` | string[] | Image URLs to include |
| `providerOptions` | object | Additional provider-specific options |

## Available Models

Models are populated dynamically from the Codex SDK via `listModels()`. The SDK chooses a default model when none is specified.

## Troubleshooting

**"Provider shows Available: none"**
- Check that `~/.codex/auth.json` exists (for OAuth)
- Or verify API key is set correctly
- Restart the daemon: `wopr daemon restart`

**"OAuth Token Expired"**
```bash
codex login --device-auth
wopr daemon restart
```

**"Incorrect API key"**
- Get key from https://platform.openai.com/api-keys
- Check for typos or extra spaces
- Verify key is not expired
