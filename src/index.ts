import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { Bot } from "grammy";
import { loadConfig, type Config } from "./config.js";
import { PiClient } from "./pi/client.js";
import { createBot } from "./bot.js";

export type ExitFunction = (code?: number) => void;

export interface Logger {
  info: (...args: any[]) => any;
  warn: (...args: any[]) => any;
  error: (...args: any[]) => any;
}

export interface StartAppOptions {
  config?: Config;
  piClient?: PiClient;
  bot?: Bot;
  signalTarget?: NodeJS.EventEmitter;
  exitProcessOnShutdown?: boolean;
  exitFn?: ExitFunction;
  logger?: Logger;
  pollingOptions?: Parameters<Bot["start"]>[0];
}

export interface AppInstance {
  config: Config;
  piClient: PiClient;
  bot: Bot;
  stop: () => Promise<void>;
  runningPromise?: Promise<void>;
}

function ensureDirectories(config: Config): void {
  fs.mkdirSync(config.piWorkspaceDir, { recursive: true });
  fs.mkdirSync(config.piSessionDir, { recursive: true });
}

function createDefaultPiClient(config: Config): PiClient {
  return new PiClient({
    piBin: config.piBinPath,
    workspaceDir: config.piWorkspaceDir,
    sessionDir: config.piSessionDir,
    model: config.piModel,
  });
}

interface SignalBinding {
  removeHandlers: () => void;
}

function attachLifecycleHandlers(
  target: NodeJS.EventEmitter,
  logger: Logger,
  onSignal: (signal: string) => Promise<void>,
  onError: (error: unknown, origin: string) => Promise<void>
): SignalBinding {
  const sigintListener = () => {
    void onSignal("SIGINT");
  };
  const sigtermListener = () => {
    void onSignal("SIGTERM");
  };
  const uncaughtListener = (err: unknown) => {
    void onError(err, "uncaughtException");
  };
  const unhandledListener = (reason: unknown) => {
    void onError(reason, "unhandledRejection");
  };

  target.on("SIGINT", sigintListener);
  target.on("SIGTERM", sigtermListener);
  target.on("uncaughtException", uncaughtListener);
  target.on("unhandledRejection", unhandledListener);

  return {
    removeHandlers: () => {
      target.removeListener("SIGINT", sigintListener);
      target.removeListener("SIGTERM", sigtermListener);
      target.removeListener("uncaughtException", uncaughtListener);
      target.removeListener("unhandledRejection", unhandledListener);
    },
  };
}

interface PollingResult {
  runningPromise: Promise<void>;
}

async function startBotPolling(
  bot: Bot,
  options: StartAppOptions | undefined,
  logger: Logger,
  onRuntimeError: (err: unknown) => Promise<void>
): Promise<PollingResult> {
  return new Promise<PollingResult>((resolve, reject) => {
    let settled = false;
    let fallbackTimer: NodeJS.Timeout | undefined;

    const onStartSuccess = () => {
      if (!settled) {
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        resolve({ runningPromise });
      }
    };

    const onStartupFail = (err: unknown) => {
      if (!settled) {
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        reject(err);
      }
    };

    let runningPromise: Promise<void>;

    try {
      const rawPromise = bot.start({
        ...options?.pollingOptions,
        onStart: (info) => {
          logger.info(`Bot @${info.username} started successfully`);
          onStartSuccess();
          options?.pollingOptions?.onStart?.(info);
        },
      });

      if (rawPromise && typeof rawPromise.then === "function") {
        runningPromise = rawPromise
          .then(() => {
            onStartSuccess();
          })
          .catch(async (err) => {
            if (!settled) {
              onStartupFail(err);
            } else {
              logger.error("Bot polling crashed:", err);
              await onRuntimeError(err);
            }
          });
      } else {
        runningPromise = Promise.resolve();
        onStartSuccess();
      }
    } catch (err) {
      onStartupFail(err);
      return;
    }

    fallbackTimer = setTimeout(() => {
      if (!settled) {
        onStartSuccess();
      }
    }, 0);
  });
}

export async function startApp(options?: StartAppOptions): Promise<AppInstance> {
  const logger = options?.logger ?? console;
  const exitFn = options?.exitFn ?? process.exit;
  const exitProcessOnShutdown = options?.exitProcessOnShutdown ?? true;
  const signalTarget = options?.signalTarget ?? process;

  const config = options?.config ?? loadConfig();
  ensureDirectories(config);

  const piClient = options?.piClient ?? createDefaultPiClient(config);

  let isStopping = false;
  let binding: SignalBinding | null = null;
  let botInstance: Bot | null = null;

  const stop = async (): Promise<void> => {
    if (isStopping) return;
    isStopping = true;

    binding?.removeHandlers();

    if (botInstance) {
      try {
        await botInstance.stop();
      } catch (err) {
        logger.error("Error stopping bot:", err);
      }
    }

    try {
      await piClient.stop();
    } catch (err) {
      logger.error("Error stopping Pi client:", err);
    }
  };

  const emergencyShutdown = async (err: unknown, exitCode = 1): Promise<void> => {
    logger.error("Emergency shutdown triggered:", err);
    await stop();
    if (exitProcessOnShutdown) {
      exitFn(exitCode);
    }
  };

  try {
    await piClient.start();
  } catch (err) {
    logger.error("Failed to start Pi client:", err);
    await piClient.stop().catch(() => {});
    throw err;
  }

  const bot = options?.bot ?? createBot(config, piClient);
  botInstance = bot;

  binding = attachLifecycleHandlers(
    signalTarget,
    logger,
    async (signal: string) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      await stop();
      if (exitProcessOnShutdown) {
        exitFn(0);
      }
    },
    async (err: unknown, origin: string) => {
      logger.error(`Fatal runtime error (${origin}):`, err);
      await emergencyShutdown(err);
    }
  );

  let pollingResult: PollingResult;
  try {
    pollingResult = await startBotPolling(bot, options, logger, async (err) => {
      await emergencyShutdown(err);
    });
  } catch (err) {
    logger.error("Failed to start bot long polling:", err);
    binding.removeHandlers();
    await stop();
    throw err;
  }

  return {
    config,
    piClient,
    bot,
    stop,
    runningPromise: pollingResult.runningPromise,
  };
}

export async function main(options?: StartAppOptions): Promise<void> {
  const logger = options?.logger ?? console;
  const exitFn = options?.exitFn ?? process.exit;

  try {
    const app = await startApp(options);
    if (app.runningPromise) {
      await app.runningPromise;
    }
  } catch (err) {
    logger.error("Fatal startup error in main():", err);
    exitFn(1);
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const scriptUrl = pathToFileURL(process.argv[1]).href;
    return (
      import.meta.url === scriptUrl ||
      process.argv[1].endsWith("/src/index.ts") ||
      process.argv[1].endsWith("/dist/index.js")
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void main();
}
