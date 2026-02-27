import winston from "winston";

const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || "info",
	format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
	defaultMeta: { service: "wopr-plugin-provider-openai:realtime" },
	transports: [new winston.transports.Console()],
});

export interface RealtimeSessionConfig {
	voice?: string;
	model?: string;
	instructions?: string;
	inputAudioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
	outputAudioFormat?: "pcm16" | "g711_ulaw" | "g711_alaw";
	turnDetection?: {
		type: "server_vad";
		silenceDurationMs?: number;
		threshold?: number;
	} | null;
	tools?: Array<{
		type: "function";
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	}>;
	maxResponseOutputTokens?: number | "inf";
}

export interface RealtimeClientOptions {
	baseUrl?: string;
	tenantToken?: string;
}

export type RealtimeEvent =
	| { type: "session.created"; sessionId: string }
	| { type: "audio"; data: Buffer }
	| { type: "transcript"; text: string; role: "user" | "assistant" }
	| { type: "text"; text: string }
	| { type: "tool_call"; callId: string; name: string; arguments: string }
	| { type: "error"; message: string; code?: string }
	| { type: "closed"; reason: string };

type EventCallback = (event: RealtimeEvent) => void;

export class RealtimeClient {
	private ws: WebSocket | null = null;
	private listeners: EventCallback[] = [];
	private credential: string;
	private options: RealtimeClientOptions;

	constructor(credential: string, options: RealtimeClientOptions = {}) {
		this.credential = credential;
		this.options = options;
	}

	onEvent(callback: EventCallback): () => void {
		this.listeners.push(callback);
		return () => {
			this.listeners = this.listeners.filter((h) => h !== callback);
		};
	}

	private emit(event: RealtimeEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				logger.error("[realtime] Event listener threw", error);
			}
		}
	}

	async connect(config: RealtimeSessionConfig): Promise<void> {
		if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
			throw new Error("Realtime connection already active. Call disconnect() before reconnecting.");
		}
		if (this.ws && this.ws.readyState >= WebSocket.CLOSING) {
			this.ws = null;
		}

		const model = config.model || "gpt-realtime";
		const baseUrl = this.options.baseUrl || "wss://api.openai.com";
		const token = this.options.tenantToken || this.credential;

		const parsedBase = new URL(baseUrl);
		const rawPath = parsedBase.pathname && parsedBase.pathname !== "/" ? parsedBase.pathname : "/v1";
		const basePath = rawPath.replace(/\/openai\/?$/, "");
		const realtimePath = `${basePath.replace(/\/$/, "")}/realtime`;
		const url = `${parsedBase.origin}${realtimePath}?model=${encodeURIComponent(model)}`;
		logger.info(`[realtime] Connecting to ${url}`);

		return new Promise<void>((resolve, reject) => {
			this.ws = new WebSocket(url, {
				// Node.js v22 native WebSocket (Undici) supports a non-standard `headers` option
				// for the HTTP Upgrade handshake. DOM/WHATWG types don't include this extension.
				// @ts-expect-error -- Undici WebSocketInit.headers not in DOM types
				headers: {
					Authorization: `Bearer ${token}`,
					"OpenAI-Beta": "realtime=v1",
				},
			});

			const timeout = setTimeout(() => {
				try {
					this.ws?.close(1000, "Connection timeout");
				} finally {
					this.ws = null;
					reject(new Error("Realtime connection timeout (30s)"));
				}
			}, 30_000);

			this.ws.onopen = () => {
				logger.info("[realtime] WebSocket connected, waiting for session.created");
			};

			this.ws.onmessage = (ev: { data: string }) => {
				try {
					const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
					this.handleServerEvent(msg, config, resolve, timeout);
				} catch (err) {
					logger.error("[realtime] Failed to parse server message", err);
				}
			};

			this.ws.onerror = (ev: Event) => {
				clearTimeout(timeout);
				const message = (ev as ErrorEvent)?.message || "WebSocket error";
				logger.error(`[realtime] WebSocket error: ${message}`);
				this.emit({ type: "error", message });
				this.ws = null;
				reject(new Error(message));
			};

			this.ws.onclose = (ev: { code: number; reason: string }) => {
				clearTimeout(timeout);
				logger.info(`[realtime] WebSocket closed: ${ev.code} ${ev.reason}`);
				this.ws = null;
				// Reject in case the connection closed before session.created was received.
				// If the promise was already resolved this is a safe no-op per Promise spec.
				reject(new Error(`WebSocket closed before session ready (code ${ev.code})`));
				this.emit({ type: "closed", reason: ev.reason || `Code ${ev.code}` });
			};
		});
	}

	private handleServerEvent(
		msg: unknown,
		config: RealtimeSessionConfig,
		resolveConnect: ((value: undefined) => void) | null,
		timeout: ReturnType<typeof setTimeout> | null,
	): void {
		if (typeof msg !== "object" || msg === null || !("type" in msg)) return;
		const event = msg as Record<string, unknown>;
		switch (event.type) {
			case "session.created": {
				if (timeout) clearTimeout(timeout);
				const session =
					typeof event.session === "object" && event.session !== null
						? (event.session as Record<string, unknown>)
						: null;
				const sessionId = typeof session?.id === "string" ? session.id : "";
				this.emit({ type: "session.created", sessionId });
				this.sendSessionUpdate(config);
				resolveConnect?.(undefined);
				break;
			}

			case "response.audio.delta": {
				if (typeof event.delta === "string") {
					const data = Buffer.from(event.delta, "base64");
					this.emit({ type: "audio", data });
				}
				break;
			}

			case "response.audio_transcript.done": {
				if (typeof event.transcript === "string") {
					this.emit({ type: "transcript", text: event.transcript, role: "assistant" });
				}
				break;
			}

			case "conversation.item.input_audio_transcription.completed": {
				if (typeof event.transcript === "string") {
					this.emit({ type: "transcript", text: event.transcript, role: "user" });
				}
				break;
			}

			case "response.text.delta": {
				if (typeof event.delta === "string") {
					this.emit({ type: "text", text: event.delta });
				}
				break;
			}

			case "response.function_call_arguments.done": {
				this.emit({
					type: "tool_call",
					callId: typeof event.call_id === "string" ? event.call_id : "",
					name: typeof event.name === "string" ? event.name : "",
					arguments: typeof event.arguments === "string" ? event.arguments : "",
				});
				break;
			}

			case "error": {
				const err =
					typeof event.error === "object" && event.error !== null ? (event.error as Record<string, unknown>) : null;
				const errMsg = typeof err?.message === "string" ? err.message : "Unknown realtime error";
				const errCode = typeof err?.code === "string" ? err.code : undefined;
				this.emit({ type: "error", message: errMsg, code: errCode });
				break;
			}

			default:
				logger.debug(`[realtime] Unhandled event: ${String(event.type)}`);
		}
	}

	private sendSessionUpdate(config: RealtimeSessionConfig): void {
		if (!this.ws || this.ws.readyState !== 1) return;

		const session: Record<string, unknown> = {};
		if (config.voice) session.voice = config.voice;
		if (config.instructions) session.instructions = config.instructions;
		if (config.maxResponseOutputTokens !== undefined) {
			session.max_response_output_tokens = config.maxResponseOutputTokens;
		}

		if (config.inputAudioFormat || config.turnDetection !== undefined) {
			const input: Record<string, unknown> = {};
			if (config.inputAudioFormat) input.format = config.inputAudioFormat;
			if (config.turnDetection !== undefined) {
				if (config.turnDetection === null) {
					input.turn_detection = null;
				} else {
					input.turn_detection = {
						type: config.turnDetection.type,
						...(config.turnDetection.silenceDurationMs !== undefined && {
							silence_duration_ms: config.turnDetection.silenceDurationMs,
						}),
						...(config.turnDetection.threshold !== undefined && {
							threshold: config.turnDetection.threshold,
						}),
					};
				}
			}
			session.audio = { ...((session.audio as object) || {}), input };
		}

		if (config.outputAudioFormat) {
			session.audio = {
				...((session.audio as object) || {}),
				output: { format: config.outputAudioFormat },
			};
		}

		if (config.tools && config.tools.length > 0) {
			session.tools = config.tools;
		}

		this.ws.send(JSON.stringify({ type: "session.update", session }));
	}

	sendAudio(pcmData: Buffer): void {
		if (!this.ws || this.ws.readyState !== 1) {
			logger.warn("[realtime] Cannot send audio: WebSocket not open");
			return;
		}
		this.ws.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: pcmData.toString("base64"),
			}),
		);
	}

	commitAudio(): void {
		if (!this.ws || this.ws.readyState !== 1) return;
		this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
	}

	sendFunctionResult(callId: string, output: string): void {
		if (!this.ws || this.ws.readyState !== 1) {
			logger.warn("[realtime] Cannot send function result: WebSocket not open");
			return;
		}
		this.ws.send(
			JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: callId,
					output,
				},
			}),
		);
		this.ws.send(JSON.stringify({ type: "response.create" }));
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close(1000, "Client disconnect");
			this.ws = null;
		}
	}
}

export function createRealtimeClient(credential: string, options?: RealtimeClientOptions): RealtimeClient {
	return new RealtimeClient(credential, options);
}
