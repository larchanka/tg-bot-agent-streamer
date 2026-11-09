import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Config } from "../src/config.js";
import { createBot } from "../src/bot.js";

// Helper to create a test configuration
function createTestConfig(overrides: Partial<Config> = {}): Config {
  const allowedSet = new Set([12345]);
  return {
    telegramBotToken: "test-bot-token-123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    allowedTelegramUserIds: [12345],
    piWorkspaceDir: "./workspace",
    piSessionDir: ".sessions",
    streamThrottleMs: 1000,
    piBinPath: "pi",
    enableRichMessages: false,
    isUserAllowed: (userId: number) => allowedSet.has(userId),
    ...overrides,
  };
}

// Helper to create a mock PiClient
function createMockPiClient() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isIdle: true,
    isStreaming: false,
    currentTool: null as string | null,
    isRunning: true,
    status: "idle",
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    prompt: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue({ status: "ok" }),
  });
}

const mockBotInfo = {
  id: 99999,
  is_bot: true as const,
  first_name: "TestBot",
  username: "test_coder_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as unknown as import("../src/bot.js").BotInfo;

interface MockApiCall {
  method: string;
  payload: Record<string, unknown>;
}

function attachMockApi(bot: ReturnType<typeof createBot>) {
  const calls: MockApiCall[] = [];
  let nextMessageId = 100;

  bot.api.config.use(async (prev, method, payload) => {
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
    if (method === "sendRichMessageDraft") {
      return { ok: true, result: true } as any;
    }
    if (method === "sendRichMessage") {
      return {
        ok: true,
        result: {
          message_id: ++nextMessageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: (payload as any).chat_id, type: "private" },
        },
      } as any;
    }
    if (method === "getFile") {
      return {
        ok: true,
        result: {
          file_id: (payload as any).file_id,
          file_path: "photos/sample.jpg",
          file_size: 1024,
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
  first_name?: string;
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
  const msg: Record<string, unknown> = {
    message_id: options.message_id,
    date: 123456789,
    chat: { id: chatId, type: "private", first_name: options.first_name ?? "User" },
    text: options.text,
    caption: options.caption,
    entities: options.entities,
    photo: options.photo?.map((p) => ({
      file_unique_id: p.file_unique_id ?? `u_${p.file_id}`,
      ...p,
    })),
  };
  if (options.user_id !== undefined) {
    msg.from = {
      id: options.user_id,
      is_bot: false,
      first_name: options.first_name ?? "User",
    };
  }
  return {
    update_id: options.update_id,
    message: msg,
  } as unknown as Parameters<ReturnType<typeof createBot>["handleUpdate"]>[0];
}

describe("grammY Bot Setup & Handlers", () => {
  describe("Slice 1: Whitelist Authentication Middleware", () => {
    it("rejects unauthorized user ID with 403 message and stops handler chain", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      // Send update from user 99999 (not in [12345])
      await bot.handleUpdate(
        makeUpdate({
          update_id: 1,
          message_id: 1,
          chat_id: 99999,
          user_id: 99999,
          first_name: "Intruder",
          text: "Hello there",
        })
      );

      // Assert unauthorized reply was sent
      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(sendCalls[0].payload.chat_id).toBe(99999);
      expect(String(sendCalls[0].payload.text)).toMatch(/unauthorized|access restricted/i);

      // PiClient should NOT be called
      expect(piClient.prompt).not.toHaveBeenCalled();
    });

    it("rejects updates with missing user from information", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 2,
          message_id: 2,
          chat_id: 88888,
          text: "Group message without from",
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/unauthorized|access restricted/i);
      expect(piClient.prompt).not.toHaveBeenCalled();
    });

    it("safely handles unauthorized updates where chat is absent without throwing", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await expect(
        bot.handleUpdate({
          update_id: 99,
          inline_query: {
            id: "iq_1",
            from: { id: 88888, is_bot: false, first_name: "Intruder" },
            query: "test",
            offset: "",
          },
        } as any)
      ).resolves.not.toThrow();

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(0);
      expect(piClient.prompt).not.toHaveBeenCalled();
    });

    it("allows authorized user to proceed to handlers", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 3,
          message_id: 3,
          chat_id: 12345,
          user_id: 12345,
          first_name: "AuthorizedUser",
          text: "/help",
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(sendCalls[0].payload.chat_id).toBe(12345);
      expect(String(sendCalls[0].payload.text)).not.toMatch(/unauthorized/i);
    });
  });

  describe("Slice 2: Bot Commands", () => {
    it("/start sends welcome message and instructions", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 10,
          message_id: 10,
          user_id: 12345,
          text: "/start",
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/welcome/i);
      expect(String(sendCalls[0].payload.text)).toMatch(/\/help/);
    });

    it("/help sends guide for commands and features", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 11,
          message_id: 11,
          user_id: 12345,
          text: "/help",
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      const text = String(sendCalls[0].payload.text);
      expect(text).toMatch(/\/start/);
      expect(text).toMatch(/\/help/);
      expect(text).toMatch(/\/stop/);
      expect(text).toMatch(/\/status/);
      expect(text).toMatch(/\/new/);
    });

    it("/stop calls piClient.abort() and sends confirmation", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 12,
          message_id: 12,
          user_id: 12345,
          text: "/stop",
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        })
      );

      expect(piClient.abort).toHaveBeenCalledTimes(1);
      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/abort|stop/i);
    });

    it("/abort also calls piClient.abort()", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 13,
          message_id: 13,
          user_id: 12345,
          text: "/abort",
          entities: [{ type: "bot_command", offset: 0, length: 6 }],
        })
      );

      expect(piClient.abort).toHaveBeenCalledTimes(1);
      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/abort|stop/i);
    });

    it("/status queries piClient and replies with current state", async () => {
      const config = createTestConfig({ piModel: "gemini-2.5-pro", piWorkspaceDir: "/home/user/project" });
      const piClient = createMockPiClient();
      piClient.isIdle = false;
      piClient.isStreaming = true;
      piClient.currentTool = "bash";

      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 14,
          message_id: 14,
          user_id: 12345,
          text: "/status",
          entities: [{ type: "bot_command", offset: 0, length: 7 }],
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      const text = String(sendCalls[0].payload.text);
      expect(text).toMatch(/streaming/i);
      expect(text).toMatch(/bash/i);
      expect(text).toMatch(/gemini-2.5-pro/);
      expect(text).toMatch(/\/home\/user\/project/);
    });

    it("/new stops running process, restarts it, and confirms session reset", async () => {
      const config = createTestConfig();
      const piClient = createMockPiClient();
      piClient.isRunning = true;

      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 15,
          message_id: 15,
          user_id: 12345,
          text: "/new",
          entities: [{ type: "bot_command", offset: 0, length: 4 }],
        })
      );

      expect(piClient.stop).toHaveBeenCalledTimes(1);
      expect(piClient.start).toHaveBeenCalledTimes(1);
      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/reset|new session/i);
    });
  });

  describe("Slice 3: Text Message Streaming & Lifecycle", () => {
    it("routes text message to piClient.prompt and streams tokens via StreamThrottler to Telegram", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      // User sends a text message
      await bot.handleUpdate(
        makeUpdate({
          update_id: 20,
          message_id: 20,
          user_id: 12345,
          text: "Write a fibonacci function in TS",
        })
      );

      // Verify prompt was sent to PiClient
      expect(piClient.prompt).toHaveBeenCalledWith("Write a fibonacci function in TS");

      // Simulate Pi emitting tokens
      piClient.emit("token", "function fib(");
      piClient.emit("token", "n: number) {}");

      // Simulate settled event
      piClient.emit("settled", { type: "agent_settled" });

      // Wait a short tick for any async finalize
      await new Promise((r) => setTimeout(r, 20));

      // Check Telegram API calls: throttler should have sent/edited message
      const sendOrEditCalls = calls.filter(
        (c) => c.method === "sendMessage" || c.method === "editMessageText"
      );
      expect(sendOrEditCalls.length).toBeGreaterThanOrEqual(1);

      const allSentText = sendOrEditCalls.map((c) => String(c.payload.text)).join(" ");
      expect(allSentText).toContain("fib");
    });

    it("attaches tool_start and tool_end listeners to update throttler status", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 21,
          message_id: 21,
          user_id: 12345,
          text: "Run tests",
        })
      );

      // Tool begins
      piClient.emit("tool_start", { type: "toolcall_start", toolName: "bash", id: "t1" });

      // Tool finishes
      piClient.emit("tool_end", { type: "toolcall_end", id: "t1" });

      // Token and settle
      piClient.emit("token", "Tests all passed!");
      piClient.emit("settled", { type: "agent_settled" });

      await new Promise((r) => setTimeout(r, 20));

      const sendOrEditCalls = calls.filter(
        (c) => c.method === "sendMessage" || c.method === "editMessageText"
      );
      expect(sendOrEditCalls.length).toBeGreaterThanOrEqual(1);
      const allSentText = sendOrEditCalls.map((c) => String(c.payload.text)).join(" ");
      expect(allSentText).toContain("Tests all passed");
    });

    it("safely handles throttler.finalize() rejection on settled without throwing unhandled error", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      const mockThrottler = {
        feed: vi.fn(),
        setToolStatus: vi.fn(),
        finalize: vi.fn().mockRejectedValue(new Error("Telegram network offline")),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        throttlerFactory: () => mockThrottler as any,
      });
      attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 22,
          message_id: 22,
          user_id: 12345,
          text: "Test network error",
        })
      );

      // Settle should finalize without throwing an unhandled rejection
      piClient.emit("settled", { type: "agent_settled" });
      await new Promise((r) => setTimeout(r, 20));

      expect(mockThrottler.finalize).toHaveBeenCalledTimes(1);
    });
  });

  describe("Slice 4: Photo Message Handling & Multimodal Input", () => {
    it("downloads highest-resolution photo, encodes as base64, and prompts PiClient with image content", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();

      const binaryContent = Buffer.from("fake-image-bytes");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          binaryContent.buffer.slice(
            binaryContent.byteOffset,
            binaryContent.byteOffset + binaryContent.byteLength
          ),
      });

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const { calls } = attachMockApi(bot);

      // Send photo message with 2 sizes (small and large)
      await bot.handleUpdate(
        makeUpdate({
          update_id: 30,
          message_id: 30,
          user_id: 12345,
          caption: "Inspect this architecture diagram",
          photo: [
            { file_id: "small_id", width: 100, height: 100, file_size: 1000 },
            { file_id: "large_id", width: 800, height: 600, file_size: 50000 },
          ],
        })
      );

      // Assert getFile was called for large_id
      const getFileCalls = calls.filter((c) => c.method === "getFile");
      expect(getFileCalls.length).toBe(1);
      expect(getFileCalls[0].payload.file_id).toBe("large_id");

      // Assert piClient.prompt was called with caption and image attachment
      expect(piClient.prompt).toHaveBeenCalledTimes(1);
      expect(piClient.prompt).toHaveBeenCalledWith(
        "Inspect this architecture diagram",
        expect.objectContaining({
          images: [
            expect.objectContaining({
              type: "image",
              data: Buffer.from("fake-image-bytes").toString("base64"),
              mimeType: "image/jpeg",
            }),
          ],
        })
      );
    });

    it("uses default prompt text when photo message has no caption", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();

      const binaryContent = Buffer.from("sample-img");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          binaryContent.buffer.slice(
            binaryContent.byteOffset,
            binaryContent.byteOffset + binaryContent.byteLength
          ),
      });

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 31,
          message_id: 31,
          user_id: 12345,
          photo: [{ file_id: "photo_1", width: 200, height: 200 }],
        })
      );

      expect(piClient.prompt).toHaveBeenCalledTimes(1);
      expect(piClient.prompt).toHaveBeenCalledWith(
        expect.stringMatching(/describe|analyze|image/i),
        expect.objectContaining({
          images: expect.any(Array),
        })
      );
    });

    it("handles photo download failures gracefully by sending an error message", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 32,
          message_id: 32,
          user_id: 12345,
          photo: [{ file_id: "broken_photo", width: 200, height: 200 }],
        })
      );

      expect(piClient.prompt).not.toHaveBeenCalled();
      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/failed to download photo/i);
    });
  });

  describe("Slice 5: In-Flight Concurrency & Steering", () => {
    it("steers active execution when text prompt is sent while Pi is streaming", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      piClient.isStreaming = true; // Pi is actively streaming
      piClient.isIdle = false;

      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 40,
          message_id: 40,
          user_id: 12345,
          text: "Actually, cancel that and make it a class instead",
        })
      );

      // Assert piClient.prompt was called with streamingBehavior: 'steer'
      expect(piClient.prompt).toHaveBeenCalledTimes(1);
      expect(piClient.prompt).toHaveBeenCalledWith(
        "Actually, cancel that and make it a class instead",
        expect.objectContaining({ streamingBehavior: "steer" })
      );

      // Verify user received steering notification
      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/steering/i);
    });

    it("steers active execution when photo prompt is sent while Pi is streaming", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      piClient.isStreaming = true;
      piClient.isIdle = false;

      const binaryContent = Buffer.from("steer-img-data");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          binaryContent.buffer.slice(
            binaryContent.byteOffset,
            binaryContent.byteOffset + binaryContent.byteLength
          ),
      });

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 41,
          message_id: 41,
          user_id: 12345,
          caption: "Look at this instead",
          photo: [{ file_id: "steer_photo", width: 500, height: 500 }],
        })
      );

      expect(piClient.prompt).toHaveBeenCalledTimes(1);
      expect(piClient.prompt).toHaveBeenCalledWith(
        "Look at this instead",
        expect.objectContaining({
          streamingBehavior: "steer",
          images: expect.any(Array),
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/steering/i);
    });

    it("steers active execution when prompt is sent during tool execution (isIdle === false, isStreaming === false)", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      piClient.isStreaming = false; // Turn ended, but tool or agent is still busy
      piClient.isIdle = false;
      piClient.currentTool = "bash";

      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 42,
          message_id: 42,
          user_id: 12345,
          text: "Steer while tool is executing",
        })
      );

      // Verify prompt was steered
      expect(piClient.prompt).toHaveBeenCalledTimes(1);
      expect(piClient.prompt).toHaveBeenCalledWith(
        "Steer while tool is executing",
        expect.objectContaining({ streamingBehavior: "steer" })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/steering/i);
    });

    it("notifies user when piClient.prompt fails during steering", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      piClient.isStreaming = true;
      piClient.prompt.mockRejectedValueOnce(new Error("Steer queue full"));

      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 43,
          message_id: 43,
          user_id: 12345,
          text: "Steer prompt that fails",
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/failed to steer agent execution.*steer queue full/i);
    });
  });

  describe("Slice 6: Error Resilience & Teardown", () => {
    it("cleans up listeners and aborts active throttler on process exit event", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      const mockThrottler = {
        feed: vi.fn(),
        setToolStatus: vi.fn(),
        finalize: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        throttlerFactory: () => mockThrottler as any,
      });
      attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 48,
          message_id: 48,
          user_id: 12345,
          text: "Start streaming session",
        })
      );

      expect(piClient.listenerCount("token")).toBe(1);

      // Simulate unexpected process exit
      piClient.emit("exit", 1, "SIGTERM");

      expect(mockThrottler.abort).toHaveBeenCalledTimes(1);
      expect(piClient.listenerCount("token")).toBe(0);
    });

    it("aborts previous throttler and detaches listeners if a new prompt starts before previous completes", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      const mockThrottlers: any[] = [];

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        throttlerFactory: () => {
          const t = {
            feed: vi.fn(),
            setToolStatus: vi.fn(),
            finalize: vi.fn(),
            abort: vi.fn().mockResolvedValue(undefined),
          };
          mockThrottlers.push(t);
          return t as any;
        },
      });
      attachMockApi(bot);

      // Session 1 starts
      await bot.handleUpdate(
        makeUpdate({
          update_id: 49,
          message_id: 49,
          user_id: 12345,
          text: "Prompt 1",
        })
      );
      expect(mockThrottlers.length).toBe(1);
      expect(piClient.listenerCount("token")).toBe(1);

      // Reset client to idle
      piClient.isIdle = true;
      piClient.isStreaming = false;

      // Session 2 starts for same chat without Session 1 settling
      await bot.handleUpdate(
        makeUpdate({
          update_id: 50,
          message_id: 50,
          user_id: 12345,
          text: "Prompt 2",
        })
      );

      expect(mockThrottlers[0].abort).toHaveBeenCalledTimes(1);
      expect(mockThrottlers.length).toBe(2);
      expect(piClient.listenerCount("token")).toBe(1); // Old removed, new added
    });

    it("notifies user and aborts throttler when piClient.prompt fails on text message", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      piClient.prompt.mockRejectedValueOnce(new Error("Process crashed"));

      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 50,
          message_id: 50,
          user_id: 12345,
          text: "Trigger error",
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/failed to start prompt.*Process crashed/i);
    });

    it("notifies user and aborts throttler when piClient.prompt fails on photo message", async () => {
      const config = createTestConfig({ streamThrottleMs: 100 });
      const piClient = createMockPiClient();
      piClient.prompt.mockRejectedValueOnce(new Error("RPC timeout"));

      const binaryContent = Buffer.from("test-err-img");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          binaryContent.buffer.slice(
            binaryContent.byteOffset,
            binaryContent.byteOffset + binaryContent.byteLength
          ),
      });

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 51,
          message_id: 51,
          user_id: 12345,
          photo: [{ file_id: "err_photo", width: 300, height: 300 }],
        })
      );

      const sendCalls = calls.filter((c) => c.method === "sendMessage");
      expect(sendCalls.length).toBe(1);
      expect(String(sendCalls[0].payload.text)).toMatch(/failed to start prompt.*RPC timeout/i);
    });
  });

  describe("Rich Messages Wiring & Configuration", () => {
    it("passes enableRichMessages: true to throttler options when configured", async () => {
      const config = createTestConfig({
        streamThrottleMs: 1500,
        enableRichMessages: true,
      });
      const piClient = createMockPiClient();
      let capturedOptions: any = null;

      const mockThrottler = {
        feed: vi.fn(),
        setToolStatus: vi.fn(),
        finalize: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        throttlerFactory: (_api, _chatId, opts) => {
          capturedOptions = opts;
          return mockThrottler as any;
        },
      });
      attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 60,
          message_id: 60,
          user_id: 12345,
          text: "Hello with rich messages",
        })
      );

      expect(capturedOptions).toEqual({
        throttleMs: 1500,
        useRichMessages: true,
      });
    });

    it("passes enableRichMessages: false to throttler options when disabled in config", async () => {
      const config = createTestConfig({
        streamThrottleMs: 1200,
        enableRichMessages: false,
      });
      const piClient = createMockPiClient();
      let capturedOptions: any = null;

      const mockThrottler = {
        feed: vi.fn(),
        setToolStatus: vi.fn(),
        finalize: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      const bot = createBot(config, piClient as any, {
        botInfo: mockBotInfo,
        throttlerFactory: (_api, _chatId, opts) => {
          capturedOptions = opts;
          return mockThrottler as any;
        },
      });
      attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 61,
          message_id: 61,
          user_id: 12345,
          text: "Hello without rich messages",
        })
      );

      expect(capturedOptions).toEqual({
        throttleMs: 1200,
        useRichMessages: false,
      });
    });

    it("streams rich message draft and finalizes with sendRichMessage when enableRichMessages is true", async () => {
      const config = createTestConfig({
        streamThrottleMs: 100,
        enableRichMessages: true,
      });
      const piClient = createMockPiClient();
      const bot = createBot(config, piClient as any, { botInfo: mockBotInfo });
      const { calls } = attachMockApi(bot);

      await bot.handleUpdate(
        makeUpdate({
          update_id: 62,
          message_id: 62,
          user_id: 12345,
          text: "Write rich code",
        })
      );

      piClient.emit("tool_start", { type: "toolcall_start", toolName: "read_file", id: "t2" });
      piClient.emit("token", "# Hello Rich World\n\nSome text");
      piClient.emit("settled", { type: "agent_settled" });

      await new Promise((r) => setTimeout(r, 20));

      const richFinalCalls = calls.filter((c) => c.method === "sendRichMessage");
      expect(richFinalCalls.length).toBe(1);
      expect((richFinalCalls[0].payload as any).rich_message).toBeDefined();
    });
  });
});
