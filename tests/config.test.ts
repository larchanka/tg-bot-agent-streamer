import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, getConfig, resetConfig } from "../src/config.js";

describe("Configuration Module (loadConfig)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it("loads valid configuration with all required and default fields", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      ALLOWED_TELEGRAM_USER_IDS: "12345678,98765432",
    };

    const config = loadConfig(env);

    expect(config.telegramBotToken).toBe("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
    expect(config.allowedTelegramUserIds).toEqual([12345678, 98765432]);
    expect(config.piWorkspaceDir).toBe("./workspace");
    expect(config.piSessionDir).toBe(".sessions");
    expect(config.streamThrottleMs).toBe(1000);
    expect(config.piBinPath).toBe("pi");
    expect(config.piModel).toBeUndefined();
  });

  it("loads custom optional configuration values", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      ALLOWED_TELEGRAM_USER_IDS: "12345678",
      PI_WORKSPACE_DIR: "/custom/workspace",
      PI_SESSION_DIR: "/custom/sessions",
      PI_MODEL: "anthropic/claude-3-7-sonnet",
      STREAM_THROTTLE_MS: "2000",
      PI_BIN_PATH: "/usr/local/bin/pi",
    };

    const config = loadConfig(env);

    expect(config.piWorkspaceDir).toBe("/custom/workspace");
    expect(config.piSessionDir).toBe("/custom/sessions");
    expect(config.piModel).toBe("anthropic/claude-3-7-sonnet");
    expect(config.streamThrottleMs).toBe(2000);
    expect(config.piBinPath).toBe("/usr/local/bin/pi");
  });

  it("handles whitespace in ALLOWED_TELEGRAM_USER_IDS correctly", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "123456:ABC",
      ALLOWED_TELEGRAM_USER_IDS: " 11111 , 22222 ,  33333 ",
    };

    const config = loadConfig(env);

    expect(config.allowedTelegramUserIds).toEqual([11111, 22222, 33333]);
  });

  it("throws descriptive error when TELEGRAM_BOT_TOKEN is missing or empty", () => {
    const env = {
      ALLOWED_TELEGRAM_USER_IDS: "12345678",
    };

    expect(() => loadConfig(env)).toThrow(/TELEGRAM_BOT_TOKEN/);

    expect(() => loadConfig({ ...env, TELEGRAM_BOT_TOKEN: "" })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("throws descriptive error when ALLOWED_TELEGRAM_USER_IDS is missing or empty", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "valid_token",
    };

    expect(() => loadConfig(env)).toThrow(/ALLOWED_TELEGRAM_USER_IDS/);

    expect(() => loadConfig({ ...env, ALLOWED_TELEGRAM_USER_IDS: "" })).toThrow(
      /ALLOWED_TELEGRAM_USER_IDS/,
    );
  });

  it("throws error when ALLOWED_TELEGRAM_USER_IDS contains non-numeric values", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "valid_token",
      ALLOWED_TELEGRAM_USER_IDS: "12345,not-a-number,67890",
    };

    expect(() => loadConfig(env)).toThrow(/numeric/i);
  });

  it("throws error when STREAM_THROTTLE_MS is invalid or non-positive", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "valid_token",
      ALLOWED_TELEGRAM_USER_IDS: "12345",
      STREAM_THROTTLE_MS: "invalid",
    };

    expect(() => loadConfig(env)).toThrow(/STREAM_THROTTLE_MS/);

    expect(() => loadConfig({ ...env, STREAM_THROTTLE_MS: "0" })).toThrow(/STREAM_THROTTLE_MS/);
    expect(() => loadConfig({ ...env, STREAM_THROTTLE_MS: "-500" })).toThrow(/STREAM_THROTTLE_MS/);
  });

  it("checks whether a user ID is allowed via isUserAllowed", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "valid_token",
      ALLOWED_TELEGRAM_USER_IDS: "100,200,300",
    };

    const config = loadConfig(env);

    expect(config.isUserAllowed(100)).toBe(true);
    expect(config.isUserAllowed(200)).toBe(true);
    expect(config.isUserAllowed(300)).toBe(true);
    expect(config.isUserAllowed(400)).toBe(false);
  });

  it("manages singleton instance via getConfig and resetConfig", () => {
    resetConfig();
    process.env.TELEGRAM_BOT_TOKEN = "token_one";
    process.env.ALLOWED_TELEGRAM_USER_IDS = "111";

    const config1 = getConfig();
    expect(config1.telegramBotToken).toBe("token_one");

    // getConfig caches instance
    process.env.TELEGRAM_BOT_TOKEN = "token_two";
    const config2 = getConfig();
    expect(config2.telegramBotToken).toBe("token_one");
    expect(config2).toBe(config1);

    // resetConfig clears cache
    resetConfig();
    const config3 = getConfig();
    expect(config3.telegramBotToken).toBe("token_two");
  });

  it("falls back to default paths when path variables are empty strings", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "valid_token",
      ALLOWED_TELEGRAM_USER_IDS: "12345",
      PI_WORKSPACE_DIR: "",
      PI_SESSION_DIR: "",
      PI_BIN_PATH: "",
    };

    const config = loadConfig(env);

    expect(config.piWorkspaceDir).toBe("./workspace");
    expect(config.piSessionDir).toBe(".sessions");
    expect(config.piBinPath).toBe("pi");
  });

  it("throws error when STREAM_THROTTLE_MS is less than 500ms", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "valid_token",
      ALLOWED_TELEGRAM_USER_IDS: "12345",
      STREAM_THROTTLE_MS: "499",
    };

    expect(() => loadConfig(env)).toThrow(/at least 500ms/);
  });
});
