import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RealtimeEvent } from "../src/realtime.js";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: { message?: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  sentMessages: string[] = [];
  headers: Record<string, string>;

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    this.url = url;
    this.headers = options?.headers || {};
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code: code || 1000, reason: reason || "" });
  }

  // Test helper: simulate server message
  _receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  // Test helper: simulate open
  _open() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

// Import after mock
const { createRealtimeClient } = await import("../src/realtime.js");

describe("RealtimeClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it("connects to the correct WebSocket URL with auth header", async () => {
    const client = createRealtimeClient("sk-test-123");
    const connectPromise = client.connect({ voice: "cedar" });

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime");
    expect(ws.headers["Authorization"]).toBe("Bearer sk-test-123");

    // Simulate server open + session.created
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-1" } });

    await connectPromise;
  });

  it("sends session.update after connection", async () => {
    const client = createRealtimeClient("sk-test-123");
    const connectPromise = client.connect({
      voice: "marin",
      instructions: "You are helpful",
      turnDetection: { type: "server_vad", silenceDurationMs: 500 },
    });

    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-2" } });
    await connectPromise;

    const updateMsg = ws.sentMessages.find((m) => {
      const parsed = JSON.parse(m);
      return parsed.type === "session.update";
    });
    expect(updateMsg).toBeDefined();
    const parsed = JSON.parse(updateMsg!);
    expect(parsed.session.voice).toBe("marin");
    expect(parsed.session.instructions).toBe("You are helpful");
  });

  it("translates response.audio.delta into audio events", async () => {
    const client = createRealtimeClient("sk-test-123");
    const events: RealtimeEvent[] = [];
    client.onEvent((ev) => events.push(ev));

    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-3" } });
    await connectPromise;

    const audioBase64 = Buffer.from("fake-pcm-data").toString("base64");
    ws._receive({
      type: "response.audio.delta",
      delta: audioBase64,
    });

    const audioEvent = events.find((e) => e.type === "audio");
    expect(audioEvent).toBeDefined();
    expect(audioEvent!.type).toBe("audio");
    expect((audioEvent as any).data).toBeInstanceOf(Buffer);
  });

  it("translates response.audio_transcript.done into transcript events", async () => {
    const client = createRealtimeClient("sk-test-123");
    const events: RealtimeEvent[] = [];
    client.onEvent((ev) => events.push(ev));

    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-4" } });
    await connectPromise;

    ws._receive({
      type: "response.audio_transcript.done",
      transcript: "Hello there",
    });

    const transcriptEvent = events.find((e) => e.type === "transcript");
    expect(transcriptEvent).toBeDefined();
    expect((transcriptEvent as any).text).toBe("Hello there");
    expect((transcriptEvent as any).role).toBe("assistant");
  });

  it("sends input_audio_buffer.append with base64 audio", async () => {
    const client = createRealtimeClient("sk-test-123");
    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-5" } });
    await connectPromise;

    const pcmData = Buffer.from("test-audio-pcm");
    client.sendAudio(pcmData);

    const appendMsg = ws.sentMessages.find((m) => {
      const parsed = JSON.parse(m);
      return parsed.type === "input_audio_buffer.append";
    });
    expect(appendMsg).toBeDefined();
    const parsed = JSON.parse(appendMsg!);
    expect(parsed.audio).toBe(pcmData.toString("base64"));
  });

  it("handles function call events", async () => {
    const client = createRealtimeClient("sk-test-123");
    const events: RealtimeEvent[] = [];
    client.onEvent((ev) => events.push(ev));

    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-6" } });
    await connectPromise;

    ws._receive({
      type: "response.function_call_arguments.done",
      call_id: "call-1",
      name: "get_weather",
      arguments: '{"city":"NYC"}',
    });

    const toolEvent = events.find((e) => e.type === "tool_call");
    expect(toolEvent).toBeDefined();
    expect((toolEvent as any).callId).toBe("call-1");
    expect((toolEvent as any).name).toBe("get_weather");
    expect((toolEvent as any).arguments).toBe('{"city":"NYC"}');
  });

  it("emits error event on server error", async () => {
    const client = createRealtimeClient("sk-test-123");
    const events: RealtimeEvent[] = [];
    client.onEvent((ev) => events.push(ev));

    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-7" } });
    await connectPromise;

    ws._receive({
      type: "error",
      error: { message: "Rate limit exceeded", code: "rate_limit" },
    });

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any).message).toBe("Rate limit exceeded");
  });

  it("disconnect closes the WebSocket", async () => {
    const client = createRealtimeClient("sk-test-123");
    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-8" } });
    await connectPromise;

    client.disconnect();
    expect(ws.readyState).toBe(3); // CLOSED
  });

  it("uses custom baseUrl for hosted mode", async () => {
    const client = createRealtimeClient("sk-test-123", {
      baseUrl: "wss://api.wopr.bot/v1/openai",
      tenantToken: "wopr_abc",
    });
    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];

    expect(ws.url).toBe(
      "wss://api.wopr.bot/v1/realtime?model=gpt-realtime"
    );
    expect(ws.headers["Authorization"]).toBe("Bearer wopr_abc");

    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-9" } });
    await connectPromise;
  });

  it("allows sending function call results back", async () => {
    const client = createRealtimeClient("sk-test-123");
    const connectPromise = client.connect({});
    const ws = MockWebSocket.instances[0];
    ws._open();
    ws._receive({ type: "session.created", session: { id: "sess-10" } });
    await connectPromise;

    client.sendFunctionResult("call-1", '{"temp": 72}');

    const resultMsg = ws.sentMessages.find((m) => {
      const parsed = JSON.parse(m);
      return parsed.type === "conversation.item.create" && parsed.item?.type === "function_call_output";
    });
    expect(resultMsg).toBeDefined();
    const parsed = JSON.parse(resultMsg!);
    expect(parsed.item.call_id).toBe("call-1");
    expect(parsed.item.output).toBe('{"temp": 72}');
  });
});
