import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConfigSchema } from "@wopr-network/plugin-types";
import { createMockContext } from "./mocks/wopr-context.js";

// ---------------------------------------------------------------------------
// Mock @openai/codex-sdk before importing the plugin
// ---------------------------------------------------------------------------

const mockStartThread = vi.fn().mockReturnValue({ id: "thread-123" });
const mockResumeThread = vi.fn().mockReturnValue({ id: "thread-456" });

// Track Codex constructor calls to verify baseUrl / apiKey
let lastCodexConstructorArgs: any = null;

function createMockCodexInstance() {
  return {
    startThread: mockStartThread,
    resumeThread: mockResumeThread,
  };
}

vi.mock("@openai/codex-sdk", () => {
  // Must be a proper constructor function (not arrow) so `new Codex(...)` works
  function Codex(opts: any) {
    lastCodexConstructorArgs = opts;
    return createMockCodexInstance();
  }
  return { Codex };
});

// Import after mock is registered
const { default: plugin } = await import("../src/index.js");

// ---------------------------------------------------------------------------
// 1. Plugin Registration Smoke Test
// ---------------------------------------------------------------------------

describe("plugin registration", () => {
  it("exports a valid WOPRPlugin with name and version", () => {
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("provider-openai");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(plugin.description).toBeDefined();
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });

  it("includes a PluginManifest with provider capability", () => {
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest!.name).toBe("@wopr-network/wopr-plugin-provider-openai");
    expect(plugin.manifest!.version).toBe(plugin.version);
    expect(plugin.manifest!.capabilities).toContain("provider");
    expect(plugin.manifest!.category).toBe("ai-provider");
    expect(plugin.manifest!.requires?.network?.outbound).toBe(true);
    expect(plugin.manifest!.configSchema).toBeDefined();
    expect(plugin.manifest!.configSchema!.fields.length).toBeGreaterThanOrEqual(3);
  });

  it("init() registers a provider", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx);

    expect(ctx.registerProvider).toHaveBeenCalledTimes(1);
    const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(provider.id).toBe("openai");
    expect(provider.name).toBe("OpenAI");
    expect(typeof provider.validateCredentials).toBe("function");
    expect(typeof provider.createClient).toBe("function");
    expect(typeof provider.getCredentialType).toBe("function");
  });

  it("init() registers a config schema", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx);

    expect(ctx.registerConfigSchema).toHaveBeenCalledTimes(1);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith(
      "provider-openai",
      expect.objectContaining({ title: "OpenAI" })
    );
  });

  it("init() logs registration info", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx);

    expect(ctx.log.info).toHaveBeenCalledWith(
      "Registering OpenAI provider..."
    );
    expect(ctx.log.info).toHaveBeenCalledWith("OpenAI provider registered");
  });

  it("shutdown() completes without error", async () => {
    await expect(plugin.shutdown!()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Config Validation Test
// ---------------------------------------------------------------------------

describe("config schema", () => {
  let schema: ConfigSchema;

  beforeEach(async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx);
    schema = (ctx.registerConfigSchema as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
  });

  it("has title and description", () => {
    expect(schema.title).toBe("OpenAI");
    expect(schema.description).toBe("Configure OpenAI authentication");
  });

  it("defines authMethod field with select options", () => {
    const field = schema.fields.find((f) => f.name === "authMethod");
    expect(field).toBeDefined();
    expect(field!.type).toBe("select");
    expect(field!.label).toBe("Authentication Method");
    expect(field!.options).toBeDefined();
    expect(field!.options!.length).toBeGreaterThanOrEqual(3);

    const optionIds = field!.options!.map((o) => o.value);
    expect(optionIds).toContain("oauth");
    expect(optionIds).toContain("env");
    expect(optionIds).toContain("api-key");
  });

  it("defines apiKey field as password type", () => {
    const field = schema.fields.find((f) => f.name === "apiKey");
    expect(field).toBeDefined();
    expect(field!.type).toBe("password");
    expect(field!.placeholder).toBe("sk-...");
    expect(field!.required).toBe(false);
  });

  it("defines defaultModel field as text type", () => {
    const field = schema.fields.find((f) => f.name === "defaultModel");
    expect(field).toBeDefined();
    expect(field!.type).toBe("text");
    expect(field!.required).toBe(false);
  });

  it("defines reasoningEffort field with 5 levels", () => {
    const field = schema.fields.find((f) => f.name === "reasoningEffort");
    expect(field).toBeDefined();
    expect(field!.type).toBe("select");
    expect(field!.options).toHaveLength(5);

    const values = field!.options!.map((o) => o.value);
    expect(values).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    expect(field!.default).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// 3. Message Translation Test (WOPR <-> Codex SDK format)
// ---------------------------------------------------------------------------

describe("message translation", () => {
  let provider: any;

  beforeEach(async () => {
    mockStartThread.mockReset();
    mockResumeThread.mockReset();
    mockStartThread.mockReturnValue({ id: "thread-123" });
    mockResumeThread.mockReturnValue({ id: "thread-456" });

    const ctx = createMockContext();
    await plugin.init!(ctx);
    provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
  });

  describe("provider metadata", () => {
    it("has correct id", () => {
      expect(provider.id).toBe("openai");
    });

    it("returns a valid credential type (api-key or oauth)", () => {
      const credType = provider.getCredentialType();
      expect(["api-key", "oauth"]).toContain(credType);
    });

    it("exposes auth helper methods", () => {
      expect(typeof provider.getAuthMethods).toBe("function");
      expect(typeof provider.getActiveAuthMethod).toBe("function");
      expect(typeof provider.hasCredentials).toBe("function");
    });

    it("getAuthMethods returns oauth, env, and api-key options", () => {
      const methods = provider.getAuthMethods();
      expect(methods).toHaveLength(3);
      expect(methods.map((m: any) => m.id)).toEqual([
        "oauth",
        "env",
        "api-key",
      ]);
      // api-key is always available (manual entry)
      const apiKeyMethod = methods.find((m: any) => m.id === "api-key");
      expect(apiKeyMethod.available).toBe(true);
      expect(apiKeyMethod.requiresInput).toBe(true);
    });
  });

  describe("credential validation", () => {
    it("rejects credentials not starting with sk-", async () => {
      const result = await provider.validateCredentials("invalid-key");
      expect(result).toBe(false);
    });

    it("validates empty credential based on available auth sources", async () => {
      // Empty credential delegates to hasCredentials() which checks
      // OAuth file and env vars. Result depends on machine state.
      const result = await provider.validateCredentials("");
      expect(typeof result).toBe("boolean");
      // Should match what hasCredentials reports
      expect(result).toBe(provider.hasCredentials());
    });
  });

  describe("client creation and query", () => {
    it("createClient returns a ModelClient with query, listModels, healthCheck", async () => {
      const client = await provider.createClient("sk-test-key-123");
      expect(typeof client.query).toBe("function");
      expect(typeof client.listModels).toBe("function");
      expect(typeof client.healthCheck).toBe("function");
    });

    it("listModels returns known Codex-compatible models", async () => {
      const client = await provider.createClient("sk-test-key-123");
      const models = await client.listModels();
      expect(models).toContain("gpt-4.1");
      expect(models).toContain("gpt-4.1-mini");
      expect(models).toContain("gpt-4.1-nano");
      expect(models).toContain("codex-mini-latest");
    });

    it("query yields events in WOPR-normalized format", async () => {
      async function* mockEvents() {
        yield { type: "thread.started", thread_id: "thread-abc" };
        yield { type: "turn.started" };
        yield {
          type: "item.completed",
          item: { type: "agent_message", text: "Hello from Codex" },
        };
        yield {
          type: "item.completed",
          item: {
            type: "command_execution",
            command: "echo hello",
            aggregated_output: "hello\n",
            exit_code: 0,
          },
        };
        yield {
          type: "turn.completed",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }

      mockStartThread.mockReturnValueOnce({
        id: "thread-abc",
        runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
      });

      const client = await provider.createClient("sk-test-key-123");
      const events: any[] = [];
      for await (const event of client.query({ prompt: "Say hello" })) {
        events.push(event);
      }

      // Verify thread.started -> system init event
      expect(events[0]).toEqual({
        type: "system",
        subtype: "init",
        session_id: "thread-abc",
      });

      // Verify turn.started -> system turn_start
      expect(events[1]).toEqual({
        type: "system",
        subtype: "turn_start",
      });

      // Verify agent_message -> assistant format
      expect(events[2]).toEqual({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello from Codex" }],
        },
      });

      // Verify command_execution -> tool_use + tool_result
      expect(events[3]).toEqual({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "bash", input: { command: "echo hello" } },
          ],
        },
      });
      expect(events[4]).toEqual({
        type: "system",
        subtype: "tool_result",
        content: "hello\n",
        exit_code: 0,
      });

      // Verify final result event (cost/billing is platform-only)
      const resultEvent = events[events.length - 1];
      expect(resultEvent.type).toBe("result");
      expect(resultEvent.subtype).toBe("success");
      expect(resultEvent.total_cost_usd).toBeUndefined();
    });

    it("query yields error event on turn.failed", async () => {
      async function* mockEvents() {
        yield { type: "thread.started", thread_id: "thread-err" };
        yield {
          type: "turn.failed",
          error: { message: "Rate limit exceeded" },
        };
      }

      mockStartThread.mockReturnValueOnce({
        id: "thread-err",
        runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
      });

      const client = await provider.createClient("sk-test-key-123");
      const events: any[] = [];
      for await (const event of client.query({ prompt: "fail" })) {
        events.push(event);
      }

      const errorEvent = events.find(
        (e) => e.type === "result" && e.subtype === "error"
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent.errors[0].message).toBe("Rate limit exceeded");
    });

    it("query translates reasoning and file_change events", async () => {
      async function* mockEvents() {
        yield { type: "thread.started", thread_id: "thread-r" };
        yield {
          type: "item.completed",
          item: { type: "reasoning", text: "Thinking about the problem..." },
        };
        yield {
          type: "item.completed",
          item: { type: "file_change" },
        };
        yield {
          type: "item.completed",
          item: {
            type: "mcp_tool_call",
            server: "myserver",
            tool: "mytool",
          },
        };
        yield {
          type: "turn.completed",
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }

      mockStartThread.mockReturnValueOnce({
        id: "thread-r",
        runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
      });

      const client = await provider.createClient("sk-test-key-123");
      const events: any[] = [];
      for await (const event of client.query({ prompt: "reason" })) {
        events.push(event);
      }

      // Reasoning event
      const reasoning = events.find(
        (e) => e.type === "system" && e.subtype === "reasoning"
      );
      expect(reasoning).toBeDefined();
      expect(reasoning.content).toBe("Thinking about the problem...");

      // File change event
      const fileChange = events.find(
        (e) =>
          e.type === "assistant" &&
          e.message?.content?.[0]?.name === "file_change"
      );
      expect(fileChange).toBeDefined();

      // MCP tool call event
      const mcpCall = events.find(
        (e) =>
          e.type === "assistant" &&
          e.message?.content?.[0]?.name === "mcp__myserver__mytool"
      );
      expect(mcpCall).toBeDefined();
    });

    it("query prepends system prompt and images to the prompt", async () => {
      let capturedPrompt = "";
      async function* mockEvents() {
        yield { type: "thread.started", thread_id: "thread-img" };
        yield {
          type: "turn.completed",
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }

      mockStartThread.mockReturnValueOnce({
        id: "thread-img",
        runStreamed: vi.fn().mockImplementation((prompt: string) => {
          capturedPrompt = prompt;
          return Promise.resolve({ events: mockEvents() });
        }),
      });

      const client = await provider.createClient("sk-test-key-123");
      const events: any[] = [];
      for await (const event of client.query({
        prompt: "Describe this image",
        systemPrompt: "You are a helpful assistant",
        images: ["https://example.com/img.png"],
      })) {
        events.push(event);
      }

      // The prompt passed to runStreamed should contain system prompt and image references
      expect(capturedPrompt).toContain("You are a helpful assistant");
      expect(capturedPrompt).toContain("https://example.com/img.png");
      expect(capturedPrompt).toContain("Describe this image");
    });

    it("query resumes existing thread when resume option is provided", async () => {
      async function* mockEvents() {
        yield { type: "thread.started", thread_id: "thread-456" };
        yield {
          type: "turn.completed",
          usage: { input_tokens: 5, output_tokens: 5 },
        };
      }

      mockResumeThread.mockReturnValueOnce({
        id: "thread-456",
        runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
      });

      const client = await provider.createClient("sk-test-key-123");
      const events: any[] = [];
      for await (const event of client.query({
        prompt: "Continue",
        resume: "thread-456",
      })) {
        events.push(event);
      }

      expect(mockResumeThread).toHaveBeenCalledWith("thread-456");
    });
  });

  describe("temperature to reasoning effort mapping", () => {
    it("maps temperature ranges to correct effort levels", async () => {
      const testCases = [
        { temp: 0.0, expected: "xhigh" },
        { temp: 0.2, expected: "xhigh" },
        { temp: 0.3, expected: "high" },
        { temp: 0.4, expected: "high" },
        { temp: 0.5, expected: "medium" },
        { temp: 0.6, expected: "medium" },
        { temp: 0.7, expected: "low" },
        { temp: 0.8, expected: "low" },
        { temp: 0.9, expected: "minimal" },
        { temp: 1.0, expected: "minimal" },
      ];

      for (const { temp, expected } of testCases) {
        let threadOptions: any = null;

        async function* mockEvents() {
          yield { type: "thread.started", thread_id: `thread-t${temp}` };
          yield {
            type: "turn.completed",
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }

        // Only use mockImplementationOnce -- captures opts AND returns thread
        mockStartThread.mockImplementationOnce((opts: any) => {
          threadOptions = opts;
          return {
            id: `thread-t${temp}`,
            runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
          };
        });

        const client = await provider.createClient("sk-test-key-123");
        for await (const _ of client.query({
          prompt: "test",
          temperature: temp,
        })) {
          // consume
        }

        expect(threadOptions?.modelReasoningEffort).toBe(expected);
      }
    });

    it("defaults to medium effort when temperature is undefined", async () => {
      let threadOptions: any = null;

      async function* mockEvents() {
        yield { type: "thread.started", thread_id: "thread-def" };
        yield {
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }

      mockStartThread.mockImplementationOnce((opts: any) => {
        threadOptions = opts;
        return {
          id: "thread-def",
          runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
        };
      });

      const client = await provider.createClient("sk-test-key-123");
      for await (const _ of client.query({ prompt: "test" })) {
        // consume
      }

      expect(threadOptions?.modelReasoningEffort).toBe("medium");
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Hosted Mode (baseUrl / tenantToken) Tests
// ---------------------------------------------------------------------------

describe("hosted mode", () => {
  let provider: any;

  beforeEach(async () => {
    mockStartThread.mockReset();
    mockResumeThread.mockReset();
    lastCodexConstructorArgs = null;
    mockStartThread.mockReturnValue({ id: "thread-123" });
    mockResumeThread.mockReturnValue({ id: "thread-456" });

    const ctx = createMockContext();
    await plugin.init!(ctx);
    provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
  });

  it("passes baseUrl and tenantToken to Codex SDK in hosted mode", async () => {
    async function* mockEvents() {
      yield { type: "thread.started", thread_id: "thread-hosted" };
      yield {
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }

    mockStartThread.mockReturnValueOnce({
      id: "thread-hosted",
      runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
    });

    const client = await provider.createClient("sk-test-key-123", {
      baseUrl: "https://api.wopr.bot/v1/openai",
      tenantToken: "wopr_tenant_abc",
    });

    for await (const _ of client.query({ prompt: "test hosted" })) {
      // consume
    }

    // Codex SDK should receive baseUrl and tenantToken as apiKey
    expect(lastCodexConstructorArgs).toBeDefined();
    expect(lastCodexConstructorArgs.baseUrl).toBe(
      "https://api.wopr.bot/v1/openai"
    );
    expect(lastCodexConstructorArgs.apiKey).toBe("wopr_tenant_abc");
  });

  it("uses regular API key in BYOK mode (no baseUrl)", async () => {
    async function* mockEvents() {
      yield { type: "thread.started", thread_id: "thread-byok" };
      yield {
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }

    mockStartThread.mockReturnValueOnce({
      id: "thread-byok",
      runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
    });

    const client = await provider.createClient("sk-test-key-123");

    for await (const _ of client.query({ prompt: "test byok" })) {
      // consume
    }

    // No baseUrl should be set; API key should be the user's own key
    expect(lastCodexConstructorArgs).toBeDefined();
    expect(lastCodexConstructorArgs.baseUrl).toBeUndefined();
    expect(lastCodexConstructorArgs.apiKey).toBe("sk-test-key-123");
  });

  it("falls back to credential as apiKey when tenantToken is not set in hosted mode", async () => {
    async function* mockEvents() {
      yield { type: "thread.started", thread_id: "thread-fallback" };
      yield {
        type: "turn.completed",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }

    mockStartThread.mockReturnValueOnce({
      id: "thread-fallback",
      runStreamed: vi.fn().mockResolvedValue({ events: mockEvents() }),
    });

    // baseUrl set but no tenantToken — should fall back to credential
    const client = await provider.createClient("sk-test-key-123", {
      baseUrl: "https://api.wopr.bot/v1/openai",
    });

    for await (const _ of client.query({ prompt: "test fallback" })) {
      // consume
    }

    expect(lastCodexConstructorArgs).toBeDefined();
    expect(lastCodexConstructorArgs.baseUrl).toBe(
      "https://api.wopr.bot/v1/openai"
    );
    expect(lastCodexConstructorArgs.apiKey).toBe("sk-test-key-123");
  });

  it("config schema includes baseUrl and tenantToken fields", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx);

    const schema = (ctx.registerConfigSchema as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as ConfigSchema;

    const baseUrlField = schema.fields.find((f) => f.name === "baseUrl");
    expect(baseUrlField).toBeDefined();
    expect(baseUrlField!.type).toBe("text");
    expect(baseUrlField!.required).toBe(false);

    const tenantTokenField = schema.fields.find(
      (f) => f.name === "tenantToken"
    );
    expect(tenantTokenField).toBeDefined();
    expect(tenantTokenField!.type).toBe("password");
    expect(tenantTokenField!.required).toBe(false);
  });
});
