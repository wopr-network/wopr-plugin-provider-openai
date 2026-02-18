/**
 * Mock WOPRPluginContext for testing wopr-plugin-provider-openai.
 */
import { vi } from "vitest";
import type {
  WOPRPluginContext,
  WOPREventBus,
  WOPRHookManager,
  ConfigSchema,
} from "@wopr-network/plugin-types";

export function createMockEventBus(): WOPREventBus {
  const handlers = new Map<string, Function[]>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    emitCustom: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  } as unknown as WOPREventBus;
}

export function createMockContext(
  overrides: Partial<WOPRPluginContext> = {}
): WOPRPluginContext {
  const registeredProviders: unknown[] = [];
  const registeredSchemas = new Map<string, ConfigSchema>();

  return {
    inject: vi.fn().mockResolvedValue("Mock response"),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn().mockResolvedValue({ name: "TestAgent" }),
    getUserProfile: vi.fn().mockResolvedValue({ name: "Test User" }),
    getSessions: vi.fn().mockReturnValue([]),
    cancelInject: vi.fn().mockReturnValue(false),
    events: createMockEventBus(),
    hooks: {} as WOPRHookManager,
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn(),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn(),
    getChannels: vi.fn().mockReturnValue([]),
    getChannelsForSession: vi.fn().mockReturnValue([]),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn().mockReturnValue([]),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({}),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getMainConfig: vi.fn().mockReturnValue({}),
    registerLLMProvider: vi.fn((provider: unknown) => {
      registeredProviders.push(provider);
    }),
    unregisterLLMProvider: vi.fn(),
    getProvider: vi.fn(),
    registerConfigSchema: vi.fn(
      (pluginId: string, schema: ConfigSchema) => {
        registeredSchemas.set(pluginId, schema);
      }
    ),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn(),
    listExtensions: vi.fn().mockReturnValue([]),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn(),
    getTTS: vi.fn(),
    hasVoice: vi.fn().mockReturnValue({ stt: false, tts: false }),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getChannelProvider: vi.fn(),
    getChannelProviders: vi.fn().mockReturnValue([]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getPluginDir: vi.fn().mockReturnValue("/tmp/wopr-test/plugins/provider-codex"),
    _registeredProviders: registeredProviders,
    _registeredSchemas: registeredSchemas,
    ...overrides,
  } as unknown as WOPRPluginContext & {
    _registeredProviders: unknown[];
    _registeredSchemas: Map<string, ConfigSchema>;
  };
}
