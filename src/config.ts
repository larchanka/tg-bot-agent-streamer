import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env file
dotenv.config();

const rawEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({
      error: "TELEGRAM_BOT_TOKEN is required",
    })
    .trim()
    .min(1, "TELEGRAM_BOT_TOKEN must not be empty"),
  ALLOWED_TELEGRAM_USER_IDS: z
    .string({
      error: "ALLOWED_TELEGRAM_USER_IDS is required",
    })
    .trim()
    .min(1, "ALLOWED_TELEGRAM_USER_IDS must not be empty")
    .transform((val, ctx) => {
      const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ALLOWED_TELEGRAM_USER_IDS must contain at least one numeric user ID",
        });
        return z.NEVER;
      }
      const ids: number[] = [];
      for (const part of parts) {
        const num = Number(part);
        if (!Number.isSafeInteger(num) || num <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid numeric Telegram user ID: "${part}"`,
          });
          return z.NEVER;
        }
        ids.push(num);
      }
      return ids;
    }),
  PI_WORKSPACE_DIR: z
    .string()
    .trim()
    .transform((val) => val || "./workspace")
    .default("./workspace"),
  PI_SESSION_DIR: z
    .string()
    .trim()
    .transform((val) => val || ".sessions")
    .default(".sessions"),
  PI_MODEL: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  STREAM_THROTTLE_MS: z
    .string()
    .trim()
    .default("1000")
    .transform((val, ctx) => {
      const num = Number(val);
      if (!Number.isSafeInteger(num) || num <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "STREAM_THROTTLE_MS must be a positive integer",
        });
        return z.NEVER;
      }
      if (num < 500) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "STREAM_THROTTLE_MS should be at least 500ms to avoid Telegram rate limits",
        });
        return z.NEVER;
      }
      return num;
    }),
  PI_BIN_PATH: z
    .string()
    .trim()
    .transform((val) => val || "pi")
    .default("pi"),
});

export interface Config {
  telegramBotToken: string;
  allowedTelegramUserIds: number[];
  piWorkspaceDir: string;
  piSessionDir: string;
  piModel?: string;
  streamThrottleMs: number;
  piBinPath: string;
  isUserAllowed(userId: number): boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = rawEnvSchema.safeParse(env);

  if (!result.success) {
    const errorMessages = result.error.issues
      .map((issue) => `[${issue.path.join(".") || "config"}]: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuration validation error: ${errorMessages}`);
  }

  const data = result.data;
  const allowedSet = new Set(data.ALLOWED_TELEGRAM_USER_IDS);

  return {
    telegramBotToken: data.TELEGRAM_BOT_TOKEN,
    allowedTelegramUserIds: data.ALLOWED_TELEGRAM_USER_IDS,
    piWorkspaceDir: data.PI_WORKSPACE_DIR,
    piSessionDir: data.PI_SESSION_DIR,
    piModel: data.PI_MODEL,
    streamThrottleMs: data.STREAM_THROTTLE_MS,
    piBinPath: data.PI_BIN_PATH,
    isUserAllowed(userId: number): boolean {
      return allowedSet.has(userId);
    },
  };
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
