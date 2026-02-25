import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@openai/codex-sdk", () => ({
	Codex: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn(() => "{}") };
});

describe("retryWithBackoff", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns on first success without retrying", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await retryWithBackoff(fn, {}, { warn: vi.fn() });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on 429 and succeeds", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const error429 = Object.assign(new Error("rate limited"), { status: 429 });
		const fn = vi.fn().mockRejectedValueOnce(error429).mockResolvedValue("ok");
		const result = await retryWithBackoff(fn, { baseDelayMs: 1 }, { warn: vi.fn() });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("does NOT retry on non-retryable errors", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const error401 = Object.assign(new Error("unauthorized"), { status: 401 });
		const fn = vi.fn().mockRejectedValue(error401);
		await expect(retryWithBackoff(fn, { baseDelayMs: 1 }, { warn: vi.fn() })).rejects.toThrow(
			"unauthorized",
		);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("exhausts retries and throws", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const error429 = Object.assign(new Error("rate limited"), { status: 429 });
		const fn = vi.fn().mockRejectedValue(error429);
		await expect(
			retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1 }, { warn: vi.fn() }),
		).rejects.toThrow("rate limited");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("retries on 503 and succeeds", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const error503 = Object.assign(new Error("unavailable"), { status: 503 });
		const fn = vi.fn().mockRejectedValueOnce(error503).mockResolvedValue("ok");
		const result = await retryWithBackoff(fn, { baseDelayMs: 1 }, { warn: vi.fn() });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on network errors (ECONNRESET)", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const fn = vi.fn()
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValue("ok");
		const result = await retryWithBackoff(fn, { baseDelayMs: 1 }, { warn: vi.fn() });
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("uses exponential backoff delays", async () => {
		const { retryWithBackoff } = await import("../src/index.js");
		const error429 = Object.assign(new Error("rate limited"), { status: 429 });
		const warnFn = vi.fn();
		const fn = vi.fn()
			.mockRejectedValueOnce(error429)
			.mockRejectedValueOnce(error429)
			.mockResolvedValue("ok");
		await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 }, { warn: warnFn });
		expect(warnFn).toHaveBeenCalledTimes(2);
		expect(warnFn.mock.calls[0][0]).toContain("1ms");
		expect(warnFn.mock.calls[1][0]).toContain("2ms");
	});
});
