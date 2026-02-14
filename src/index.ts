/**
 * WOPR Plugin: OpenAI Provider
 *
 * Provides OpenAI API access via the official @openai/codex-sdk.
 * Supports A2A tools, session resumption via thread IDs, and reasoning effort control.
 * Install: wopr plugin install @wopr-network/wopr-plugin-provider-openai
 */

import winston from "winston";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type {
  A2AServerConfig,
  ConfigSchema,
  PluginManifest,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// Provider-specific types (not part of the shared plugin-types package)
interface ModelQueryOptions {
  prompt: string;
  systemPrompt?: string;
  resume?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  images?: string[];
  tools?: string[];
  a2aServers?: Record<string, A2AServerConfig>;
  allowedTools?: string[];
  providerOptions?: Record<string, unknown>;
}

interface ModelClient {
  query(options: ModelQueryOptions): AsyncGenerator<unknown>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
}

interface ModelProvider {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
  validateCredentials(credentials: string): Promise<boolean>;
  createClient(credential: string, options?: Record<string, unknown>): Promise<ModelClient>;
  getCredentialType(): "api-key" | "oauth" | "custom";
}

// Setup winston logger - use LOG_LEVEL env var or default to info
const logLevel = process.env.LOG_LEVEL || "info";
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "wopr-plugin-provider-openai" },
  transports: [
    new winston.transports.Console()
  ],
});

let CodexSDK: any;

// =============================================================================
// Auth Detection - mirrors Anthropic plugin pattern
// =============================================================================

const CODEX_AUTH_FILE = join(homedir(), ".codex", "auth.json");

export interface AuthMethodInfo {
  id: string;
  name: string;
  description: string;
  available: boolean;
  requiresInput: boolean;
  inputType?: "password" | "text";
  inputLabel?: string;
  inputPlaceholder?: string;
  setupInstructions?: string[];
  docsUrl?: string;
}

interface CodexAuthState {
  type: "oauth" | "api_key";
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  planType?: string;
  apiKey?: string;
}

function loadCodexCredentials(): CodexAuthState | null {
  logger.info(`[codex] loadCodexCredentials() checking ${CODEX_AUTH_FILE}`);
  if (!existsSync(CODEX_AUTH_FILE)) {
    logger.info(`[codex] loadCodexCredentials() file not found`);
    return null;
  }
  try {
    logger.info(`[codex] loadCodexCredentials() file exists, parsing...`);
    const data = JSON.parse(readFileSync(CODEX_AUTH_FILE, "utf-8"));

    // Check for OAuth tokens first
    if (data.tokens?.access_token) {
      // Parse email from id_token JWT payload
      let email = "";
      let planType = "";
      try {
        const payload = JSON.parse(Buffer.from(data.tokens.id_token.split('.')[1], 'base64').toString());
        email = payload.email || "";
        planType = payload["https://api.openai.com/auth"]?.chatgpt_plan_type || "";
      } catch {}

      return {
        type: "oauth",
        accessToken: data.tokens.access_token,
        refreshToken: data.tokens.refresh_token,
        email,
        planType,
      };
    }

    // Check for API key
    if (data.OPENAI_API_KEY) {
      return {
        type: "api_key",
        apiKey: data.OPENAI_API_KEY,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function getApiKeyFromEnv(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

function getAuth(): CodexAuthState | null {
  logger.info(`[codex] getAuth() called, checking ${CODEX_AUTH_FILE}`);
  // Check Codex CLI credentials first (like Anthropic checks Claude Code)
  const codexAuth = loadCodexCredentials();
  if (codexAuth) {
    logger.info(`[codex] getAuth() found auth type: ${codexAuth.type}`);
    return codexAuth;
  }

  // Fall back to environment variable
  const envKey = getApiKeyFromEnv();
  if (envKey && envKey.startsWith("sk-")) {
    logger.info(`[codex] getAuth() found env API key`);
    return { type: "api_key", apiKey: envKey };
  }

  logger.info(`[codex] getAuth() no credentials found`);
  return null;
}

function hasCredentials(): boolean {
  return getAuth() !== null;
}

function getAuthMethods(): AuthMethodInfo[] {
  const codexAuth = loadCodexCredentials();
  const envKey = getApiKeyFromEnv();
  const hasEnvKey = !!envKey && envKey.startsWith("sk-");

  return [
    {
      id: "oauth",
      name: "ChatGPT Plus/Pro (OAuth)",
      description: "Use your ChatGPT subscription - no per-token costs",
      available: codexAuth?.type === "oauth",
      requiresInput: false,
      setupInstructions: codexAuth?.type === "oauth"
        ? [`Logged in as: ${codexAuth.email || "ChatGPT user"} (${codexAuth.planType || "plus"})`]
        : ["Run: codex login", "Then restart WOPR"],
      docsUrl: "https://chatgpt.com/",
    },
    {
      id: "env",
      name: "Environment Variable",
      description: "Use OPENAI_API_KEY from environment",
      available: hasEnvKey,
      requiresInput: false,
      setupInstructions: hasEnvKey
        ? [`Using key from OPENAI_API_KEY (${envKey!.slice(0, 10)}...)`]
        : ["Set OPENAI_API_KEY environment variable"],
      docsUrl: "https://platform.openai.com/api-keys",
    },
    {
      id: "api-key",
      name: "API Key (manual)",
      description: "Enter API key directly - billed per token",
      available: true,
      requiresInput: true,
      inputType: "password",
      inputLabel: "OpenAI API Key",
      inputPlaceholder: "sk-...",
      docsUrl: "https://platform.openai.com/api-keys",
    },
  ];
}

function getActiveAuthMethod(): string {
  const auth = getAuth();
  if (auth?.type === "oauth") return "oauth";
  if (auth?.type === "api_key") return "api-key";
  return "none";
}

/**
 * Lazy load Codex SDK
 */
async function loadCodexSDK() {
  if (!CodexSDK) {
    try {
      const codex = await import("@openai/codex-sdk");
      CodexSDK = codex;
    } catch (error) {
      throw new Error(
        "OpenAI Codex SDK not installed. Run: npm install @openai/codex-sdk"
      );
    }
  }
  return CodexSDK;
}

/**
 * Map temperature (0-1) to Codex reasoning effort
 * Lower temp = more deterministic = higher effort
 */
function temperatureToEffort(temp?: number): "minimal" | "low" | "medium" | "high" | "xhigh" {
  if (temp === undefined) return "medium";
  if (temp <= 0.2) return "xhigh";
  if (temp <= 0.4) return "high";
  if (temp <= 0.6) return "medium";
  if (temp <= 0.8) return "low";
  return "minimal";
}

/**
 * Codex provider implementation
 */
const codexProvider: ModelProvider & {
  getAuthMethods: () => AuthMethodInfo[];
  getActiveAuthMethod: () => string;
  hasCredentials: () => boolean;
} = {
  id: "openai",
  name: "OpenAI",
  description: "OpenAI provider (Codex agent SDK) with OAuth, API key, session resumption",
  defaultModel: "", // SDK chooses default
  supportedModels: [], // Populated dynamically via listModels()

  // Onboarding helpers (like Anthropic)
  getAuthMethods,
  getActiveAuthMethod,
  hasCredentials,

  async validateCredentials(credential: string): Promise<boolean> {
    logger.info(`[codex] validateCredentials() called with credential: ${credential ? credential.substring(0, 10) + '...' : 'empty'}`);
    // Empty credential is valid if we have OAuth or env-based auth
    if (!credential || credential === "") {
      const hasCreds = hasCredentials();
      logger.info(`[codex] validateCredentials() empty credential, hasCredentials: ${hasCreds}`);
      return hasCreds;
    }

    // API key format: sk-... (OpenAI format)
    if (!credential.startsWith("sk-")) {
      logger.info(`[codex] validateCredentials() credential doesn't start with sk-, returning false`);
      return false;
    }

    try {
      logger.info(`[codex] validateCredentials() testing API key...`);
      const { Codex } = await loadCodexSDK();
      const codex = new Codex({ apiKey: credential });
      // Thread creation succeeds if credentials are valid
      const thread = codex.startThread();
      logger.info(`[codex] validateCredentials() API key valid: ${!!thread}`);
      return !!thread;
    } catch (error) {
      logger.error("[codex] Credential validation failed:", error);
      return false;
    }
  },

  async createClient(
    credential: string,
    options?: Record<string, unknown>
  ): Promise<ModelClient> {
    return new CodexClient(credential, options);
  },

  getCredentialType(): "api-key" | "oauth" | "custom" {
    const active = getActiveAuthMethod();
    if (active === "oauth") return "oauth";
    return "api-key";
  },
};

/**
 * Codex client implementation with session resumption
 */
class CodexClient implements ModelClient {
  private codex: any;
  private authType: string;

  constructor(
    private credential: string,
    private options?: Record<string, unknown>
  ) {
    // Determine auth type (like Anthropic client)
    if (credential && credential.startsWith("sk-")) {
      this.authType = "api_key";
    } else {
      const auth = getAuth();
      if (auth?.type === "oauth") {
        this.authType = "oauth";
      } else if (auth?.type === "api_key") {
        this.authType = "api_key";
        this.credential = auth.apiKey || "";
      } else {
        this.authType = "none";
      }
    }
    logger.info(`[codex] Using auth: ${this.authType}`);
  }

  private async getCodex() {
    logger.info(`[codex] getCodex() called, this.codex exists: ${!!this.codex}`);
    if (!this.codex) {
      logger.info(`[codex] getCodex() loading SDK...`);
      const { Codex } = await loadCodexSDK();
      logger.info(`[codex] getCodex() SDK loaded, getting auth...`);
      const auth = getAuth();
      logger.info(`[codex] getCodex() auth result: ${auth ? auth.type : 'null'}, authType: ${this.authType}`);

      // Hosted mode: if baseUrl is set in options, route through gateway
      // using tenantToken as the API key for metering/billing.
      const hostedBaseUrl = this.options?.baseUrl as string | undefined;
      const tenantToken = this.options?.tenantToken as string | undefined;

      if (hostedBaseUrl) {
        const key = tenantToken || this.credential || auth?.apiKey;
        logger.info(`[codex] getCodex() creating Codex in hosted mode (baseUrl=${hostedBaseUrl})...`);
        this.codex = new Codex({ apiKey: key, baseUrl: hostedBaseUrl });
        logger.info(`[codex] Initialized in hosted mode`);
      } else if (this.authType === "oauth") {
        logger.info(`[codex] getCodex() creating Codex (OAuth via CLI auth)...`);
        // SDK reads OAuth tokens from ~/.codex/auth.json automatically
        this.codex = new Codex({ ...this.options });
        logger.info(`[codex] Initialized with OAuth (${auth?.email || "user"})`);
      } else if (this.credential || auth?.apiKey) {
        const apiKey = this.credential || auth?.apiKey;
        logger.info(`[codex] getCodex() creating Codex with API key...`);
        this.codex = new Codex({ apiKey, ...this.options });
        logger.info(`[codex] Initialized with API key`);
      } else {
        logger.error(`[codex] getCodex() NO VALID CREDENTIALS - authType=${this.authType}, hasAuth=${!!auth}, hasCredential=${!!this.credential}`);
        throw new Error("No valid credentials available. Run: codex login");
      }
    }
    return this.codex;
  }

  async *query(opts: ModelQueryOptions): AsyncGenerator<unknown> {
    logger.info(`[codex] query() starting with prompt: ${opts.prompt.substring(0, 100)}...`);
    const codex = await this.getCodex();
    logger.info(`[codex] query() got codex instance`);

    try {
      let thread: any;
      let sessionId: string = "";
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // Session resumption via thread ID
      if (opts.resume) {
        logger.info(`[codex] Resuming thread: ${opts.resume}`);
        thread = codex.resumeThread(opts.resume);
        sessionId = opts.resume;
      } else {
        // Start new thread with options
        const threadOptions: any = {
          workingDirectory: process.cwd(),
          sandboxMode: "workspace-write",
          approvalPolicy: "never", // YOLO mode - auto-approve
        };

        // Model selection
        if (opts.model) {
          threadOptions.model = opts.model;
        }

        // Map temperature to reasoning effort
        threadOptions.modelReasoningEffort = temperatureToEffort(opts.temperature);
        logger.info(`[codex] Reasoning effort: ${threadOptions.modelReasoningEffort}`);

        // Merge provider options
        if (opts.providerOptions) {
          Object.assign(threadOptions, opts.providerOptions);
        }

        thread = codex.startThread(threadOptions);
      }

      // Prepare prompt with images if provided
      let prompt = opts.prompt;
      if (opts.images && opts.images.length > 0) {
        const imageList = opts.images.map((url, i) => `[Image ${i + 1}]: ${url}`).join('\n');
        prompt = `[User has shared ${opts.images.length} image(s)]\n${imageList}\n\n${opts.prompt}`;
      }

      // Add system prompt context if provided
      if (opts.systemPrompt) {
        prompt = `[System: ${opts.systemPrompt}]\n\n${prompt}`;
      }

      // Use streaming to get real-time events
      logger.info(`[codex] query() calling runStreamed...`);
      const { events } = await thread.runStreamed(prompt);
      logger.info(`[codex] query() got events iterator, starting iteration...`);

      for await (const event of events) {
        logger.info(`[codex] query() event: ${event.type}`);

        switch (event.type) {
          case "thread.started":
            sessionId = event.thread_id || thread.id || "";
            // Match Anthropic format: { type: 'system', subtype: 'init', session_id: '...' }
            yield { type: 'system', subtype: 'init', session_id: sessionId };
            logger.info(`[codex] Session ID: ${sessionId}`);
            break;

          case "turn.started":
            yield { type: 'system', subtype: 'turn_start' };
            break;

          case "item.completed":
            // Handle different item types - wrap in Anthropic 'assistant' format
            if (event.item.type === "agent_message") {
              // Match Anthropic format: { type: 'assistant', message: { content: [{ type: 'text', text: '...' }] }}
              yield {
                type: 'assistant',
                message: {
                  content: [{ type: 'text', text: event.item.text }]
                }
              };
            } else if (event.item.type === "reasoning") {
              // Reasoning can be passed through as system message
              yield { type: 'system', subtype: 'reasoning', content: event.item.text };
            } else if (event.item.type === "command_execution") {
              // Tool use format matching Anthropic
              yield {
                type: 'assistant',
                message: {
                  content: [{
                    type: 'tool_use',
                    name: 'bash',
                    input: { command: event.item.command },
                  }]
                }
              };
              // Tool result
              yield {
                type: 'system',
                subtype: 'tool_result',
                content: event.item.aggregated_output,
                exit_code: event.item.exit_code,
              };
            } else if (event.item.type === "file_change") {
              yield {
                type: 'assistant',
                message: {
                  content: [{
                    type: 'tool_use',
                    name: 'file_change',
                  }]
                }
              };
            } else if (event.item.type === "mcp_tool_call") {
              yield {
                type: 'assistant',
                message: {
                  content: [{
                    type: 'tool_use',
                    name: `mcp__${event.item.server}__${event.item.tool}`,
                  }]
                }
              };
            }
            break;

          case "turn.completed":
            // Track usage for final result
            totalInputTokens += event.usage?.input_tokens || 0;
            totalOutputTokens += event.usage?.output_tokens || 0;
            break;

          case "turn.failed":
            // Match Anthropic error format
            yield {
              type: 'result',
              subtype: 'error',
              errors: [{ message: event.error?.message || 'Unknown error' }]
            };
            break;
        }
      }

      // Emit final result (cost/billing is a platform-only concern)
      yield {
        type: 'result',
        subtype: 'success',
      };

    } catch (error) {
      logger.error("[codex] Query failed:", error);
      throw new Error(
        `OpenAI query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async listModels(): Promise<string[]> {
    // SDK 0.101 does not expose a listModels() method.
    // Return known Codex-compatible models as a static list.
    // TODO: Keep this list in sync with OpenAI SDK docs; verify names on each SDK bump.
    return [
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "codex-mini-latest",
    ];
  }

  async healthCheck(): Promise<boolean> {
    logger.info(`[codex] Health check starting, authType: ${this.authType}`);
    try {
      const codex = await this.getCodex();
      logger.info(`[codex] Got Codex instance, starting thread...`);
      const thread = codex.startThread();
      logger.info(`[codex] Thread started: ${!!thread}`);
      return !!thread;
    } catch (error) {
      logger.error(`[codex] Health check failed: ${error}`);
      if (error instanceof Error) {
        logger.error(`[codex] Health check error message: ${error.message}`);
        logger.error(`[codex] Health check error stack: ${error.stack}`);
      }
      return false;
    }
  }
}

/**
 * Shared config field definitions used by both the static manifest and
 * the runtime config schema registered in init().  Kept in one place so
 * the two schemas cannot drift apart.
 */
const BASE_CONFIG_FIELDS: ConfigSchema["fields"] = [
  {
    name: "authMethod",
    type: "select",
    label: "Authentication Method",
    options: [
      { value: "oauth", label: "ChatGPT Plus/Pro (OAuth)" },
      { value: "env", label: "Environment Variable" },
      { value: "api-key", label: "API Key (manual)" },
    ],
    description: "Choose how to authenticate with OpenAI",
    setupFlow: "paste",
  },
  {
    name: "apiKey",
    type: "password",
    label: "API Key",
    placeholder: "sk-...",
    required: false,
    description: "Only needed for API Key auth method",
    secret: true,
    setupFlow: "paste",
  },
  {
    name: "baseUrl",
    type: "text",
    label: "Gateway Base URL",
    placeholder: "https://api.wopr.bot/v1/openai",
    required: false,
    description: "If set, routes traffic through the WOPR gateway for metering and billing",
  },
  {
    name: "tenantToken",
    type: "password",
    label: "Tenant Token",
    placeholder: "wopr_...",
    required: false,
    description: "Gateway auth token (used instead of API key when baseUrl is set)",
    secret: true,
  },
  {
    name: "defaultModel",
    type: "text",
    label: "Default Model",
    placeholder: "(uses SDK default)",
    required: false,
    description: "Default model (leave empty for SDK default)",
  },
  {
    name: "reasoningEffort",
    type: "select",
    label: "Reasoning Effort",
    required: false,
    description: "How much effort the model puts into reasoning",
    options: [
      { value: "minimal", label: "Minimal (fastest)" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium (default)" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra High (most thorough)" },
    ],
    default: "medium",
  },
];

/**
 * Plugin manifest — full metadata for WaaS discovery and orchestration.
 */
const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-provider-openai",
  version: "2.2.0",
  description: "OpenAI provider plugin with OAuth and API key support",
  author: "wopr-network",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-provider-openai",
  capabilities: ["provider"],
  category: "ai-provider",
  tags: ["openai", "codex", "provider", "agent-sdk", "oauth"],
  requires: {
    env: [],
    network: { outbound: true, hosts: ["api.openai.com"] },
  },
  configSchema: {
    title: "OpenAI",
    description: "Configure OpenAI authentication",
    fields: BASE_CONFIG_FIELDS,
  },
};

/**
 * Plugin export
 */
const plugin: WOPRPlugin = {
  name: "provider-openai",
  version: "2.2.0",
  description: "OpenAI provider plugin with OAuth and API key support",
  manifest,

  async init(ctx: WOPRPluginContext) {
    ctx.log.info("Registering OpenAI provider...");

    // Show auth status (like Anthropic)
    const activeAuth = getActiveAuthMethod();
    const authMethods = getAuthMethods();
    const activeMethod = authMethods.find(m => m.id === activeAuth);

    if (activeMethod?.available) {
      ctx.log.info(`  Auth: ${activeMethod.name}`);
      if (activeMethod.setupInstructions?.[0]) {
        ctx.log.info(`  ${activeMethod.setupInstructions[0]}`);
      }
    } else {
      ctx.log.info("  Auth: None configured");
      ctx.log.info("  Run: codex login (OAuth) or set OPENAI_API_KEY");
    }

    ctx.registerProvider(codexProvider);
    ctx.log.info("OpenAI provider registered");

    // Register config schema for UI (like Anthropic)
    // Start from shared fields, then override authMethod with runtime availability.
    const methods = getAuthMethods();
    const runtimeFields = BASE_CONFIG_FIELDS.map(field => {
      if (field.name === "authMethod") {
        return {
          ...field,
          options: methods.map(m => ({
            value: m.id,
            label: `${m.name}${m.available ? " \u2713" : ""}`,
          })),
          default: getActiveAuthMethod(),
        };
      }
      return field;
    });
    ctx.registerConfigSchema("provider-openai", {
      title: "OpenAI",
      description: "Configure OpenAI authentication",
      fields: runtimeFields,
    });
  },

  async shutdown() {
    logger.info("[provider-openai] Shutting down");
  },
};

export default plugin;
