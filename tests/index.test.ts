import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Config } from "../src/config.js";
import { startApp, main, type AppInstance, type StartAppOptions, type Logger, type ExitFunction } from "../src/index.js";

function createTestConfig(overrides: Partial<Config> = {}): Config {
  const allowedSet = new Set([12345]);
  return {
    telegramBotToken: "test-bot-token-123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    allowedTelegramUserIds: [12345],
    piWorkspaceDir: path.join(os.tmpdir(), `test-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    piSessionDir: path.join(os.tmpdir(), `test-sess-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    streamThrottleMs: 1000,
    piBinPath: "pi",
    enableRichMessages: true,
    isUserAllowed: (userId: number) => allowedSet.has(userId),
    ...overrides,
  };
}

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

function createMockBot() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    start: vi.fn().mockImplementation((options?: { onStart?: (info: { username: string }) => void }) => {
      if (options?.onStart) {
        options.onStart({ username: "test_bot" });
      }
      return Promise.resolve();
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    api: {
      config: {
        use: vi.fn(),
      },
    },
    use: vi.fn(),
    command: vi.fn(),
    on: vi.fn(),
  });
}

describe("Application Entrypoint & Lifecycle (src/index.ts)", () => {
  let mockLogger: Logger;
  let mockExit: ReturnType<typeof vi.fn> & ExitFunction;
  let signalTarget: EventEmitter;
  let testConfig: Config;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mockExit = vi.fn() as any;
    signalTarget = new EventEmitter();
    testConfig = createTestConfig();
  });

  afterEach(() => {
    // Clean up temporary test directories if created
    try {
      if (fs.existsSync(testConfig.piWorkspaceDir)) {
        fs.rmSync(testConfig.piWorkspaceDir, { recursive: true, force: true });
      }
      if (fs.existsSync(testConfig.piSessionDir)) {
        fs.rmSync(testConfig.piSessionDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
    vi.restoreAllMocks();
  });

  describe("startApp Orchestration", () => {
    it("initializes directories, starts PiClient, and starts the bot", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      expect(fs.existsSync(testConfig.piWorkspaceDir)).toBe(false);
      expect(fs.existsSync(testConfig.piSessionDir)).toBe(false);

      const app = await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      expect(app).toBeDefined();
      expect(app.config).toBe(testConfig);
      expect(app.piClient).toBe(mockPiClient);
      expect(app.bot).toBe(mockBot);

      // Directories created
      expect(fs.existsSync(testConfig.piWorkspaceDir)).toBe(true);
      expect(fs.existsSync(testConfig.piSessionDir)).toBe(true);

      // PiClient started
      expect(mockPiClient.start).toHaveBeenCalledTimes(1);

      // Bot started
      expect(mockBot.start).toHaveBeenCalledTimes(1);
    });

    it("uses default loadConfig if config is not supplied", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      // Set temporary env vars for loadConfig
      const origToken = process.env.TELEGRAM_BOT_TOKEN;
      const origUsers = process.env.ALLOWED_TELEGRAM_USER_IDS;
      process.env.TELEGRAM_BOT_TOKEN = "test-token:123";
      process.env.ALLOWED_TELEGRAM_USER_IDS = "999";

      try {
        const app = await startApp({
          piClient: mockPiClient as any,
          bot: mockBot as any,
          signalTarget,
          exitFn: mockExit,
          logger: mockLogger,
        });

        expect(app.config.telegramBotToken).toBe("test-token:123");
        expect(app.config.allowedTelegramUserIds).toEqual([999]);
      } finally {
        process.env.TELEGRAM_BOT_TOKEN = origToken;
        process.env.ALLOWED_TELEGRAM_USER_IDS = origUsers;
      }
    });
  });

  describe("Graceful Shutdown", () => {
    it("handles SIGINT signal gracefully", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      const app = await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      // Emit SIGINT
      signalTarget.emit("SIGINT");
      // Allow async shutdown to resolve
      await new Promise((r) => setTimeout(r, 10));

      expect(mockBot.stop).toHaveBeenCalledTimes(1);
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("SIGINT"));
    });

    it("handles SIGTERM signal gracefully", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      // Emit SIGTERM
      signalTarget.emit("SIGTERM");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockBot.stop).toHaveBeenCalledTimes(1);
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("SIGTERM"));
    });

    it("app.stop() can be called manually and is idempotent", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      const app = await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      await app.stop();
      await app.stop(); // idempotent second call

      expect(mockBot.stop).toHaveBeenCalledTimes(1);
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      // Manual stop does not necessarily exit process unless signal received
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("does not exit process if exitProcessOnShutdown is false", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitProcessOnShutdown: false,
        exitFn: mockExit,
        logger: mockLogger,
      });

      signalTarget.emit("SIGINT");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockBot.stop).toHaveBeenCalledTimes(1);
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling & Emergency Teardown", () => {
    it("handles failure when piClient.start() rejects", async () => {
      const mockPiClient = createMockPiClient();
      mockPiClient.start.mockRejectedValue(new Error("Pi spawn failed: executable not found"));
      const mockBot = createMockBot();

      await expect(
        startApp({
          config: testConfig,
          piClient: mockPiClient as any,
          bot: mockBot as any,
          signalTarget,
          exitFn: mockExit,
          logger: mockLogger,
        })
      ).rejects.toThrow("Pi spawn failed: executable not found");

      expect(mockPiClient.start).toHaveBeenCalledTimes(1);
      // Bot should not have been started
      expect(mockBot.start).not.toHaveBeenCalled();
      // PiClient stop should be called during emergency teardown
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("handles synchronous error in bot.start()", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();
      mockBot.start.mockImplementation(() => {
        throw new Error("Telegram token invalid");
      });

      await expect(
        startApp({
          config: testConfig,
          piClient: mockPiClient as any,
          bot: mockBot as any,
          signalTarget,
          exitFn: mockExit,
          logger: mockLogger,
        })
      ).rejects.toThrow("Telegram token invalid");

      expect(mockPiClient.start).toHaveBeenCalledTimes(1);
      expect(mockBot.start).toHaveBeenCalledTimes(1);
      // Emergency teardown stops piClient
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("handles asynchronous rejection in bot.start() during startup", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();
      mockBot.start.mockRejectedValue(new Error("Network connection refused"));

      await expect(
        startApp({
          config: testConfig,
          piClient: mockPiClient as any,
          bot: mockBot as any,
          signalTarget,
          exitFn: mockExit,
          logger: mockLogger,
        })
      ).rejects.toThrow("Network connection refused");

      expect(mockPiClient.start).toHaveBeenCalledTimes(1);
      expect(mockBot.start).toHaveBeenCalledTimes(1);
      expect(mockPiClient.stop).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("handles runtime crash during bot long-polling", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      let rejectLongPolling!: (err: Error) => void;
      mockBot.start.mockImplementation((options?: { onStart?: (info: { username: string }) => void }) => {
        if (options?.onStart) {
          options.onStart({ username: "test_bot" });
        }
        return new Promise((_, reject) => {
          rejectLongPolling = reject;
        });
      });

      const app = await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      expect(mockBot.start).toHaveBeenCalledTimes(1);

      // Trigger runtime failure during polling
      rejectLongPolling(new Error("Polling crashed unexpectedly"));
      await new Promise((r) => setTimeout(r, 10));

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockPiClient.stop).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("handles uncaughtException by performing emergency shutdown", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      // Emit uncaughtException on signalTarget
      signalTarget.emit("uncaughtException", new Error("Fatal unhandled error"));
      await new Promise((r) => setTimeout(r, 10));

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockBot.stop).toHaveBeenCalled();
      expect(mockPiClient.stop).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("handles unhandledRejection by performing emergency shutdown", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      await startApp({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: mockExit,
        logger: mockLogger,
      });

      // Emit unhandledRejection on signalTarget
      signalTarget.emit("unhandledRejection", new Error("Unhandled promise rejection"));
      await new Promise((r) => setTimeout(r, 10));

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockBot.stop).toHaveBeenCalled();
      expect(mockPiClient.stop).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("main() runner", () => {
    it("starts application and awaits running promise", async () => {
      const mockPiClient = createMockPiClient();
      const mockBot = createMockBot();

      // Spy on startApp or test main invocation
      const origToken = process.env.TELEGRAM_BOT_TOKEN;
      const origUsers = process.env.ALLOWED_TELEGRAM_USER_IDS;
      process.env.TELEGRAM_BOT_TOKEN = "test-token:123";
      process.env.ALLOWED_TELEGRAM_USER_IDS = "999";

      try {
        const exitSpy = vi.fn();
        await main({
          config: testConfig,
          piClient: mockPiClient as any,
          bot: mockBot as any,
          signalTarget,
          exitFn: exitSpy,
          logger: mockLogger,
        });

        expect(mockPiClient.start).toHaveBeenCalled();
        expect(mockBot.start).toHaveBeenCalled();
      } finally {
        process.env.TELEGRAM_BOT_TOKEN = origToken;
        process.env.ALLOWED_TELEGRAM_USER_IDS = origUsers;
      }
    });

    it("catches fatal startup error in main and exits with code 1", async () => {
      const mockPiClient = createMockPiClient();
      mockPiClient.start.mockRejectedValue(new Error("Fatal Pi error"));
      const mockBot = createMockBot();
      const exitSpy = vi.fn();

      await main({
        config: testConfig,
        piClient: mockPiClient as any,
        bot: mockBot as any,
        signalTarget,
        exitFn: exitSpy,
        logger: mockLogger,
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
