/**
 * Tests for provider-openai extension registration (WOP-268)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Codex SDK
vi.mock("@openai/codex-sdk", () => ({
	Codex: vi.fn().mockImplementation(() => ({
		startThread: vi.fn().mockReturnValue({ id: "thread-1" }),
		resumeThread: vi.fn(),
	})),
}));

// Mock node:fs to prevent reading real credential files
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => "{}"),
	};
});

describe("provider-openai extension (WOP-268)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.OPENAI_API_KEY;
	});

	it("calls ctx.registerExtension with 'provider-openai' during init", async () => {
		const { default: plugin } = await import("../src/index.js");

		const registerExtension = vi.fn();
		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerLLMProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			registerExtension,
		};

		await plugin.init(ctx as any);

		expect(registerExtension).toHaveBeenCalledWith(
			"provider-openai",
			expect.objectContaining({ getModelInfo: expect.any(Function) }),
		);
	});

	it("does not throw when ctx.registerExtension is absent", async () => {
		const { default: plugin } = await import("../src/index.js");

		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerLLMProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			// No registerExtension
		};

		await expect(plugin.init(ctx as any)).resolves.not.toThrow();
	});

	it("extension.getModelInfo returns the known OpenAI models including gpt-realtime", async () => {
		const { default: plugin } = await import("../src/index.js");

		let capturedExtension: any;
		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerLLMProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			registerExtension: vi.fn((_name: string, ext: unknown) => {
				capturedExtension = ext;
			}),
		};

		await plugin.init(ctx as any);

		expect(capturedExtension).toBeDefined();
		const models = await capturedExtension.getModelInfo();

		expect(Array.isArray(models)).toBe(true);

		const ids = models.map((m: any) => m.id);
		expect(ids).toContain("gpt-4.1");
		expect(ids).toContain("gpt-4.1-mini");
		expect(ids).toContain("gpt-4.1-nano");
		expect(ids).toContain("codex-mini-latest");
		expect(ids).toContain("gpt-realtime");
	});

	it("model info includes contextWindow and maxOutput fields", async () => {
		const { default: plugin } = await import("../src/index.js");

		let capturedExtension: any;
		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerLLMProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			registerExtension: vi.fn((_name: string, ext: unknown) => {
				capturedExtension = ext;
			}),
		};

		await plugin.init(ctx as any);

		const models = await capturedExtension.getModelInfo();
		for (const model of models) {
			expect(model).toHaveProperty("id");
			expect(model).toHaveProperty("name");
			expect(model).toHaveProperty("contextWindow");
			expect(model).toHaveProperty("maxOutput");
			expect(model).toHaveProperty("legacy");
		}
	});
});
