import { Bot, type BotConfig, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Config } from "./config.js";
import type { PiClient } from "./pi/client.js";
import type { ImageContentPart } from "./pi/types.js";
import { StreamThrottler, type StreamThrottlerOptions, type TelegramApiLike } from "./telegram/throttler.js";
import { getLargestPhotoFileId, downloadTelegramPhotoAsBase64 } from "./telegram/media.js";

export type BotInfo = NonNullable<BotConfig<any>["botInfo"]>;

export interface CreateBotOptions {
  botInfo?: BotInfo;
  fetchFn?: typeof fetch;
  throttlerFactory?: (
    api: TelegramApiLike,
    chatId: number | string,
    options?: StreamThrottlerOptions
  ) => StreamThrottler;
}

interface ActiveSession {
  throttler: StreamThrottler;
  cleanup: () => void;
}

export function createBot(
  config: Config,
  piClient: PiClient,
  options: CreateBotOptions = {}
): Bot {
  const bot = new Bot(config.telegramBotToken, {
    botInfo: options.botInfo,
  });

  const activeSessions = new Map<number | string, ActiveSession>();

  // Clean up any active sessions when the Pi subprocess exits or crashes
  piClient.on("exit", () => {
    for (const [, session] of activeSessions) {
      session.cleanup();
      void session.throttler.abort();
    }
    activeSessions.clear();
  });

  // 1. Install auto-retry plugin to handle transient Telegram rate limits
  bot.api.config.use(autoRetry());

  // 2. Whitelist authentication guard middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.isUserAllowed(userId)) {
      if (ctx.chat) {
        await ctx.reply("Unauthorized: Access restricted.");
      }
      return;
    }
    await next();
  });

  // 3. Commands
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Welcome to Pi Coding Agent Bot!\n\n" +
        "Send any prompt or code request to get started. You can also send images with questions.\n\n" +
        "Available commands:\n" +
        "/help - Show guide and commands\n" +
        "/status - View agent status and model\n" +
        "/stop - Abort active execution\n" +
        "/new - Start a fresh session"
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "📖 Pi Coding Agent Commands:\n\n" +
        "/start - Welcome instructions\n" +
        "/help - Show command guide\n" +
        "/status - View current agent status\n" +
        "/stop - Abort running execution\n" +
        "/abort - Alias for /stop\n" +
        "/new - Reset session context"
    );
  });

  bot.command(["stop", "abort"], async (ctx) => {
    await piClient.abort();
    const session = activeSessions.get(ctx.chat.id);
    if (session) {
      session.cleanup();
      await session.throttler.abort();
    }
    await ctx.reply("Agent execution aborted.");
  });

  bot.command("status", async (ctx) => {
    const state = piClient.isStreaming
      ? `Streaming${piClient.currentTool ? ` (active tool: ${piClient.currentTool})` : ""}`
      : piClient.isIdle
        ? "Idle"
        : "Busy";

    await ctx.reply(
      `🤖 Status: ${state}\n` +
        `📦 Model: ${config.piModel ?? "default"}\n` +
        `📂 Workspace: ${config.piWorkspaceDir}`
    );
  });

  bot.command("new", async (ctx) => {
    const session = activeSessions.get(ctx.chat.id);
    if (session) {
      session.cleanup();
      await session.throttler.abort();
    }
    if (piClient.isRunning) {
      await piClient.stop();
    }
    await piClient.start();
    await ctx.reply("Session reset. Started a new clean session.");
  });

  // Helper to attach throttler session and wire Pi events
  function attachThrottlerSession(chatId: number | string): ActiveSession {
    const existing = activeSessions.get(chatId);
    if (existing) {
      existing.cleanup();
      void existing.throttler.abort();
    }

    const throttler = options.throttlerFactory
      ? options.throttlerFactory(bot.api as unknown as TelegramApiLike, chatId, {
          throttleMs: config.streamThrottleMs,
          useRichMessages: config.enableRichMessages,
        })
      : new StreamThrottler(bot.api as unknown as TelegramApiLike, chatId, {
          throttleMs: config.streamThrottleMs,
          useRichMessages: config.enableRichMessages,
        });

    const onToken = (delta: string) => {
      throttler.feed(delta);
    };

    const onToolStart = (event: { toolName: string }) => {
      throttler.setToolStatus(event.toolName);
    };

    const onToolEnd = () => {
      throttler.setToolStatus(null);
    };

    const cleanup = () => {
      piClient.off("token", onToken);
      piClient.off("tool_start", onToolStart);
      piClient.off("tool_end", onToolEnd);
      piClient.off("settled", onSettled);
      activeSessions.delete(chatId);
    };

    const onSettled = async () => {
      cleanup();
      try {
        await throttler.finalize();
      } catch {
        // Suppress finalization network errors to avoid unhandled promise rejection
      }
    };

    piClient.on("token", onToken);
    piClient.on("tool_start", onToolStart);
    piClient.on("tool_end", onToolEnd);
    piClient.once("settled", onSettled);

    const session: ActiveSession = { throttler, cleanup };
    activeSessions.set(chatId, session);
    return session;
  }

  // Unified prompt handler for both text and photo messages
  async function handleUserPrompt(
    ctx: Context,
    promptText: string,
    promptOptions: { images?: ImageContentPart[] } = {}
  ): Promise<void> {
    if (!ctx.chat) {
      return;
    }

    const isAgentBusy = !piClient.isIdle || piClient.isStreaming;

    if (isAgentBusy) {
      try {
        await piClient.prompt(promptText, {
          ...promptOptions,
          streamingBehavior: "steer",
        });
        const steeringLabel =
          promptOptions.images && promptOptions.images.length > 0
            ? "🔄 Steering agent execution with image..."
            : "🔄 Steering agent execution...";
        await ctx.reply(steeringLabel);
      } catch (err) {
        await ctx.reply(
          `⚠️ Failed to steer agent execution: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

    const session = attachThrottlerSession(ctx.chat.id);

    try {
      if (promptOptions.images && promptOptions.images.length > 0) {
        await piClient.prompt(promptText, promptOptions);
      } else {
        await piClient.prompt(promptText);
      }
    } catch (err) {
      session.cleanup();
      await session.throttler.abort();
      await ctx.reply(
        `⚠️ Failed to start prompt: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 4. Message Handlers
  bot.on("message:text", async (ctx) => {
    await handleUserPrompt(ctx, ctx.message.text);
  });

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const largestFileId = getLargestPhotoFileId(photos);
    if (!largestFileId) {
      await ctx.reply("Failed to process photo: No valid photo found.");
      return;
    }

    let photoData;
    try {
      photoData = await downloadTelegramPhotoAsBase64(
        ctx.api,
        largestFileId,
        config.telegramBotToken,
        options.fetchFn
      );
    } catch (error) {
      await ctx.reply(
        `Failed to download photo: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }

    const promptText = ctx.message.caption || "Describe or analyze this image";
    const imagePart: ImageContentPart = {
      type: "image",
      data: photoData.data,
      mimeType: photoData.mimeType,
    };

    await handleUserPrompt(ctx, promptText, { images: [imagePart] });
  });

  return bot;
}
