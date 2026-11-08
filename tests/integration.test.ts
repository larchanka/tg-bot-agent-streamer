import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { ProtocolFramer } from "../src/pi/framing.js";
import { PiClient } from "../src/pi/client.js";
import { createBot, type BotInfo } from "../src/bot.js";
import type { Config } from "../src/config.js";
import type { PromptCommand, AbortCommand } from "../src/pi/types.js";

interface MockChildProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  kill: ReturnType<typeof vi.fn>;
  emitStdout: (event: Record<string, unknown>) => void;
  capturedCommands: unknown[];
}

function createMockChildProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 42424;
  proc.killed = false;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.capturedCommands = [];

  const framer = new ProtocolFramer();
  framer.on("line", (line) => {
    try {
      proc.capturedCommands.push(JSON.parse(line));
    } catch {
      proc.capturedCommands.push(line);
    }
  });
  framer.attach(proc.stdin);

  proc.emitStdout = (event: Record<string, unknown>) => {
    proc.stdout.write(JSON.stringify(event) + "\n");
  };

  proc.kill = vi.fn().mockImplementation((signal?: string | number) => {
    proc.killed = true;
    proc.exitCode = signal === "SIGKILL" ? 137 : 0;
    proc.signalCode = (signal as string) || "SIGTERM";
    proc.emit("exit", proc.exitCode, proc.signalCode);
    return true;
  });

  return proc;
}

const mockBotInfo: BotInfo = {
  id: 99999,
  is_bot: true,
  first_name: "PiCoderBot",
  username: "pi_coder_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as unknown as BotInfo;

function createTestConfig(overrides: Partial<Config> = {}): Config {
  const allowedSet = new Set([12345]);
  return {
    telegramBotToken: "test-bot-token-123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    allowedTelegramUserIds: [12345],
    piWorkspaceDir: "/workspace/test-repo",
    piSessionDir: "/workspace/.sessions",
    streamThrottleMs: 1000,
    piBinPath: "pi",
    isUserAllowed: (userId: number) => allowedSet.has(userId),
    ...overrides,
  };
}

interface MockApiCall {
  method: string;
  payload: Record<string, unknown>;
}

function attachMockTelegramApi(bot: ReturnType<typeof createBot>) {
  const calls: MockApiCall[] = [];
  let nextMessageId = 1000;

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });

    if (method === "sendMessage") {
      return {
        ok: true,
        result: {
          message_id: ++nextMessageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: (payload as any).chat_id, type: "private" },
          text: (payload as any).text,
        },
      } as any;
    }

    if (method === "editMessageText") {
      return {
        ok: true,
        result: {
          message_id: (payload as any).message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: (payload as any).chat_id, type: "private" },
          text: (payload as any).text,
        },
      } as any;
    }

    if (method === "sendChatAction") {
      return { ok: true, result: true } as any;
    }

    if (method === "getFile") {
      return {
        ok: true,
        result: {
          file_id: (payload as any).file_id,
          file_path: "photos/sample_image.jpg",
          file_size: 2048,
        },
      } as any;
    }

    return { ok: true, result: true } as any;
  });

  return { calls };
}

function makeUpdate(options: {
  update_id: number;
  message_id: number;
  chat_id?: number;
  user_id?: number;
  text?: string;
  caption?: string;
  entities?: Array<{ type: string; offset: number; length: number }>;
  photo?: Array<{
    file_id: string;
    file_unique_id?: string;
    width: number;
    height: number;
    file_size?: number;
  }>;
}) {
  const chatId = options.chat_id ?? 12345;
  const entities =
    options.entities ??
    (options.text?.startsWith("/")
      ? [{ type: "bot_command", offset: 0, length: options.text.split(" ")[0].length }]
      : undefined);

  const msg: Record<string, unknown> = {
    message_id: options.message_id,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: "private", first_name: "Developer" },
    text: options.text,
    caption: options.caption,
    entities,
    photo: options.photo?.map((p) => ({
      file_unique_id: p.file_unique_id ?? `u_${p.file_id}`,
      ...p,
    })),
  };

  if (options.user_id !== undefined) {
    msg.from = {
      id: options.user_id,
      is_bot: false,
      first_name: "Developer",
    };
  }

  return {
    update_id: options.update_id,
    message: msg,
  } as unknown as Parameters<ReturnType<typeof createBot>["handleUpdate"]>[0];
}

describe("End-to-End Integration Tests", () => {
  let mockProc: MockChildProcess;
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let config: Config;

  beforeEach(() => {
    vi.useFakeTimers();
    mockProc = createMockChildProcess();
    mockSpawn = vi.fn().mockReturnValue(mockProc as unknown as ChildProcess);

    // Mock fetch for downloading telegram photo binary
    const sampleBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (header: string) => (header.toLowerCase() === "content-type" ? "image/jpeg" : null),
      },
      arrayBuffer: async () => sampleBytes.buffer,
    });

    config = createTestConfig();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("completes full cycle: bot startup, user prompt, live streaming with tool badge, settlement", async () => {
    // 1. Initialize PiClient with mock subprocess spawn
    const piClient = new PiClient({
      workspaceDir: config.piWorkspaceDir,
      sessionDir: config.piSessionDir,
      piBin: config.piBinPath,
      spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
    });

    // 2. Start Pi client
    await piClient.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      "pi",
      ["--mode", "rpc", "--session-dir", "/workspace/.sessions"],
      expect.objectContaining({ cwd: "/workspace/test-repo" })
    );
    expect(piClient.isRunning).toBe(true);
    expect(piClient.isIdle).toBe(true);

    // 3. Create Bot and attach Telegram API interceptor
    const bot = createBot(config, piClient, {
      botInfo: mockBotInfo,
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const { calls } = attachMockTelegramApi(bot);

    // 4. User sends prompt
    await bot.handleUpdate(
      makeUpdate({
        update_id: 1,
        message_id: 101,
        chat_id: 12345,
        user_id: 12345,
        text: "Write a fibonacci function in TypeScript",
      })
    );

    // Verify prompt command was formatted and dispatched to Pi stdin
    expect(mockProc.capturedCommands.length).toBe(1);
    const promptCmd = mockProc.capturedCommands[0] as PromptCommand;
    expect(promptCmd.type).toBe("prompt");
    expect(promptCmd.message).toBe("Write a fibonacci function in TypeScript");
    expect(piClient.isIdle).toBe(false);

    // 5. Pi subprocess simulates event stream
    mockProc.emitStdout({ type: "agent_start" });
    mockProc.emitStdout({ type: "turn_start", id: promptCmd.id });

    // Pi invokes bash tool
    mockProc.emitStdout({ type: "toolcall_start", toolName: "bash" });
    expect(piClient.currentTool).toBe("bash");

    // Advance throttle timer so throttler attempts first message flush with tool status badge
    await vi.advanceTimersByTimeAsync(1000);

    const initialSend = calls.find((c) => c.method === "sendMessage");
    expect(initialSend).toBeDefined();
    expect(initialSend?.payload.chat_id).toBe(12345);
    expect(String(initialSend?.payload.text)).toContain("Running");

    // Tool finishes
    mockProc.emitStdout({ type: "toolcall_end" });
    expect(piClient.currentTool).toBeNull();

    // Pi streams text tokens with markdown formatting
    mockProc.emitStdout({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Here is the code:\n\n```ts\nfunction fib(n: number): number {\n",
      },
    });

    // Advance timer to trigger intermediate edit
    await vi.advanceTimersByTimeAsync(1000);
    const firstEdit = calls.find((c) => c.method === "editMessageText");
    expect(firstEdit).toBeDefined();

    // Stream remaining tokens
    mockProc.emitStdout({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "  return n <= 1 ? n : fib(n - 1) + fib(n - 2);\n}\n```\nDone!",
      },
    });

    // End turn and settle agent
    mockProc.emitStdout({ type: "turn_end" });
    mockProc.emitStdout({ type: "agent_settled" });

    // Allow promise microtasks for onSettled to resolve
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);

    expect(piClient.isIdle).toBe(true);
    expect(piClient.isStreaming).toBe(false);

    // Verify final Telegram message contains balanced markdown code block and "Done!"
    const edits = calls.filter((c) => c.method === "editMessageText");
    expect(edits.length).toBeGreaterThanOrEqual(1);
    const lastEdit = edits[edits.length - 1];
    expect(String(lastEdit.payload.text)).toContain("fib(n - 1)");
    expect(String(lastEdit.payload.text)).toMatch(/Done/);
    // Tool badge should no longer be present in final message
    expect(String(lastEdit.payload.text)).not.toContain("Running");
  });

  it("steers active agent execution when user sends prompt while streaming", async () => {
    const piClient = new PiClient({
      workspaceDir: config.piWorkspaceDir,
      spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
    });
    await piClient.start();

    const bot = createBot(config, piClient, { botInfo: mockBotInfo });
    const { calls } = attachMockTelegramApi(bot);

    // 1. Initial prompt
    await bot.handleUpdate(
      makeUpdate({
        update_id: 10,
        message_id: 201,
        chat_id: 12345,
        user_id: 12345,
        text: "Create an HTTP server",
      })
    );

    // Pi starts streaming
    mockProc.emitStdout({ type: "agent_start" });
    mockProc.emitStdout({ type: "turn_start", id: "turn-http" });
    mockProc.emitStdout({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Starting server creation...",
      },
    });
    expect(piClient.isStreaming).toBe(true);

    // 2. User sends another message while Pi is actively streaming
    await bot.handleUpdate(
      makeUpdate({
        update_id: 11,
        message_id: 202,
        chat_id: 12345,
        user_id: 12345,
        text: "Make sure to use Fastify instead of Express",
      })
    );

    // Pi should have received a prompt with streamingBehavior: "steer"
    expect(mockProc.capturedCommands.length).toBe(2);
    const steerCmd = mockProc.capturedCommands[1] as PromptCommand;
    expect(steerCmd.type).toBe("prompt");
    expect(steerCmd.message).toBe("Make sure to use Fastify instead of Express");
    expect(steerCmd.streamingBehavior).toBe("steer");

    // Bot should have acknowledged steering to Telegram chat
    const steeringNotice = calls.find(
      (c) => c.method === "sendMessage" && String(c.payload.text).includes("Steering agent execution")
    );
    expect(steeringNotice).toBeDefined();
    expect(steeringNotice?.payload.chat_id).toBe(12345);

    // Pi settles
    mockProc.emitStdout({ type: "turn_end" });
    mockProc.emitStdout({ type: "agent_settled" });
    await Promise.resolve();
    expect(piClient.isIdle).toBe(true);
  });

  it("aborts active execution cleanly when user sends /stop", async () => {
    const piClient = new PiClient({
      workspaceDir: config.piWorkspaceDir,
      spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
    });
    await piClient.start();

    const bot = createBot(config, piClient, { botInfo: mockBotInfo });
    const { calls } = attachMockTelegramApi(bot);

    // 1. Start execution
    await bot.handleUpdate(
      makeUpdate({
        update_id: 20,
        message_id: 301,
        chat_id: 12345,
        user_id: 12345,
        text: "Perform full codebase search",
      })
    );
    mockProc.emitStdout({ type: "agent_start" });
    mockProc.emitStdout({ type: "turn_start", id: "turn-search" });

    // 2. User aborts via /stop
    await bot.handleUpdate(
      makeUpdate({
        update_id: 21,
        message_id: 302,
        chat_id: 12345,
        user_id: 12345,
        text: "/stop",
      })
    );

    // Verify abort command was dispatched to Pi stdin
    const abortCmd = mockProc.capturedCommands.find((c: any) => c.type === "abort") as AbortCommand | undefined;
    expect(abortCmd).toBeDefined();
    expect(abortCmd?.type).toBe("abort");

    // Verify bot confirmed abortion
    const abortNotice = calls.find(
      (c) => c.method === "sendMessage" && String(c.payload.text).includes("Agent execution aborted")
    );
    expect(abortNotice).toBeDefined();
  });

  it("handles multimodal photo input: downloads photo, submits base64 image part, streams response", async () => {
    const piClient = new PiClient({
      workspaceDir: config.piWorkspaceDir,
      spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
    });
    await piClient.start();

    const bot = createBot(config, piClient, {
      botInfo: mockBotInfo,
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    const { calls } = attachMockTelegramApi(bot);

    // User sends photo with caption
    await bot.handleUpdate(
      makeUpdate({
        update_id: 30,
        message_id: 401,
        chat_id: 12345,
        user_id: 12345,
        caption: "Analyze this architecture diagram",
        photo: [
          { file_id: "thumb_123", width: 100, height: 100 },
          { file_id: "high_res_456", width: 1200, height: 800 },
        ],
      })
    );

    // Verify getFile was called for the highest-resolution photo
    const getFileCall = calls.find((c) => c.method === "getFile");
    expect(getFileCall).toBeDefined();
    expect(getFileCall?.payload.file_id).toBe("high_res_456");

    // Verify fetch was called with the file URL
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("photos/sample_image.jpg")
    );

    // Verify prompt command contained image attachment
    const promptCmd = mockProc.capturedCommands[0] as PromptCommand;
    expect(promptCmd).toBeDefined();
    expect(promptCmd.type).toBe("prompt");
    expect(promptCmd.message).toBe("Analyze this architecture diagram");
    expect(promptCmd.images).toHaveLength(1);
    expect(promptCmd.images?.[0]).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
    });
    // Base64 data should match the mocked jpeg buffer
    const expectedBase64 = Buffer.from(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04])).toString("base64");
    expect(promptCmd.images?.[0].data).toBe(expectedBase64);

    // Pi responds with streaming analysis
    mockProc.emitStdout({ type: "agent_start" });
    mockProc.emitStdout({ type: "turn_start", id: promptCmd.id });
    mockProc.emitStdout({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "The diagram shows a microservices architecture with a Gateway.",
      },
    });

    await vi.advanceTimersByTimeAsync(1000);

    mockProc.emitStdout({ type: "turn_end" });
    mockProc.emitStdout({ type: "agent_settled" });
    await Promise.resolve();

    // Verify telegram message contains the analysis
    const edits = calls.filter((c) => c.method === "editMessageText" || c.method === "sendMessage");
    const foundAnalysis = edits.some((c) =>
      String(c.payload.text).includes("microservices architecture")
    );
    expect(foundAnalysis).toBe(true);
  });

  it("strictly restricts unauthorized users from triggering prompts or commands", async () => {
    const piClient = new PiClient({
      workspaceDir: config.piWorkspaceDir,
      spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
    });
    await piClient.start();

    const bot = createBot(config, piClient, { botInfo: mockBotInfo });
    const { calls } = attachMockTelegramApi(bot);

    // Unauthorized user 99999 attempts to send a prompt
    await bot.handleUpdate(
      makeUpdate({
        update_id: 40,
        message_id: 501,
        chat_id: 99999,
        user_id: 99999,
        text: "rm -rf /",
      })
    );

    // Assert unauthorized message sent
    const sendCalls = calls.filter((c) => c.method === "sendMessage");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].payload.chat_id).toBe(99999);
    expect(String(sendCalls[0].payload.text)).toMatch(/unauthorized/i);

    // Pi process must NOT have received any command
    expect(mockProc.capturedCommands).toHaveLength(0);
    expect(piClient.isIdle).toBe(true);
  });
});
