import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PiClient } from "../src/pi/client.js";

interface MockChildProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  kill: ReturnType<typeof vi.fn>;
}

function createMockChildProcess(): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 99999;
  proc.killed = false;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = vi.fn().mockImplementation((signal?: string | number) => {
    proc.killed = true;
    proc.exitCode = signal === "SIGKILL" ? 137 : 0;
    proc.signalCode = (signal as string) || "SIGTERM";
    proc.emit("exit", proc.exitCode, proc.signalCode);
    return true;
  });
  return proc;
}

describe("PiClient", () => {
  let mockProc: MockChildProcess;
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockProc = createMockChildProcess();
    mockSpawn = vi.fn().mockReturnValue(mockProc as unknown as ChildProcess);
  });

  describe("Lifecycle and Spawning", () => {
    it("spawns pi with correct arguments and working directory", async () => {
      const client = new PiClient({
        workspaceDir: "/workspace/project",
        sessionDir: "/workspace/.sessions",
        model: "claude-3-7-sonnet",
        piBin: "my-pi",
        spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
      });

      expect(client.isIdle).toBe(true);
      expect(client.isStreaming).toBe(false);
      expect(client.isRunning).toBe(false);

      await client.start();

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockSpawn).toHaveBeenCalledWith(
        "my-pi",
        ["--mode", "rpc", "--session-dir", "/workspace/.sessions", "--model", "claude-3-7-sonnet"],
        expect.objectContaining({
          cwd: "/workspace/project",
          stdio: ["pipe", "pipe", "pipe"],
        })
      );
      expect(client.isRunning).toBe(true);
      expect(client.status).toBe("idle");
    });

    it("defaults binary to 'pi' and omits optional sessionDir and model if not specified", async () => {
      const client = new PiClient({
        workspaceDir: "/workspace/project",
        spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
      });

      await client.start();

      expect(mockSpawn).toHaveBeenCalledWith(
        "pi",
        ["--mode", "rpc"],
        expect.objectContaining({
          cwd: "/workspace/project",
        })
      );
    });

    it("throws if start() is called when already running", async () => {
      const client = new PiClient({
        workspaceDir: "/workspace/project",
        spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
      });

      await client.start();
      await expect(client.start()).rejects.toThrow("PiClient is already running");
    });
  });

  describe("Inbound RPC Event Parsing & State Transitions", () => {
    let client: PiClient;

    beforeEach(async () => {
      client = new PiClient({
        workspaceDir: "/workspace/project",
        spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
      });
      await client.start();
    });

    it("handles agent_start and transitions isIdle to false", () => {
      const onAgentStart = vi.fn();
      const onEvent = vi.fn();
      client.on("agent_start", onAgentStart);
      client.on("event", onEvent);

      mockProc.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");

      expect(client.isIdle).toBe(false);
      expect(onAgentStart).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith({ type: "agent_start" });
    });

    it("handles turn_start and transitions isStreaming to true and isIdle to false", () => {
      const onTurnStart = vi.fn();
      client.on("turn_start", onTurnStart);

      expect(client.isIdle).toBe(true);

      mockProc.stdout.write(JSON.stringify({ type: "turn_start" }) + "\n");

      expect(client.isStreaming).toBe(true);
      expect(client.isIdle).toBe(false);
      expect(client.status).toBe("streaming");
      expect(onTurnStart).toHaveBeenCalledTimes(1);
    });

    it("handles message_update with text_delta and emits token event", () => {
      const onToken = vi.fn();
      const onMessageUpdate = vi.fn();
      client.on("token", onToken);
      client.on("message_update", onMessageUpdate);

      const event = {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "Hello, world!",
        },
      };
      mockProc.stdout.write(JSON.stringify(event) + "\n");

      expect(onToken).toHaveBeenCalledWith("Hello, world!");
      expect(onMessageUpdate).toHaveBeenCalledWith(event);
    });

    it("handles message_update with non-text delta without emitting token", () => {
      const onToken = vi.fn();
      client.on("token", onToken);

      const event = {
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: "Thinking...",
        },
      };
      mockProc.stdout.write(JSON.stringify(event) + "\n");

      expect(onToken).not.toHaveBeenCalled();
    });

    it("tracks tool execution via toolcall_start and toolcall_end", () => {
      const onToolStart = vi.fn();
      const onToolEnd = vi.fn();
      client.on("tool_start", onToolStart);
      client.on("tool_end", onToolEnd);

      const startEvent = {
        type: "toolcall_start",
        toolName: "bash",
        id: "call-1",
        args: { command: "git status" },
      };
      mockProc.stdout.write(JSON.stringify(startEvent) + "\n");

      expect(client.currentTool).toBe("bash");
      expect(onToolStart).toHaveBeenCalledWith(startEvent);

      const endEvent = {
        type: "toolcall_end",
        id: "call-1",
        output: "clean",
      };
      mockProc.stdout.write(JSON.stringify(endEvent) + "\n");

      expect(client.currentTool).toBeNull();
      expect(onToolEnd).toHaveBeenCalledWith(endEvent);
    });

    it("handles turn_end by resetting isStreaming", () => {
      mockProc.stdout.write(JSON.stringify({ type: "turn_start" }) + "\n");
      expect(client.isStreaming).toBe(true);

      mockProc.stdout.write(JSON.stringify({ type: "turn_end" }) + "\n");
      expect(client.isStreaming).toBe(false);
    });

    it("handles agent_settled by restoring idle state and clearing active tool", () => {
      const onSettled = vi.fn();
      client.on("settled", onSettled);

      mockProc.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      mockProc.stdout.write(JSON.stringify({ type: "turn_start" }) + "\n");
      mockProc.stdout.write(JSON.stringify({ type: "toolcall_start", toolName: "read" }) + "\n");

      expect(client.isIdle).toBe(false);
      expect(client.isStreaming).toBe(true);
      expect(client.currentTool).toBe("read");

      const settledEvent = { type: "agent_settled", aborted: false };
      mockProc.stdout.write(JSON.stringify(settledEvent) + "\n");

      expect(client.isIdle).toBe(true);
      expect(client.isStreaming).toBe(false);
      expect(client.currentTool).toBeNull();
      expect(client.status).toBe("idle");
      expect(onSettled).toHaveBeenCalledWith(settledEvent);
    });

    it("emits error event when error event arrives from stdout", () => {
      const onError = vi.fn();
      client.on("error", onError);

      const errorEvent = { type: "error", message: "RPC error occurred", code: 500 };
      mockProc.stdout.write(JSON.stringify(errorEvent) + "\n");

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(errorEvent);
    });

    it("emits warning event on malformed JSON stdout lines without crashing", () => {
      const onWarning = vi.fn();
      client.on("warning", onWarning);

      mockProc.stdout.write("INVALID JSON NONCE\n");

      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          message: expect.stringContaining("Failed to parse stdout JSON line"),
        })
      );
    });

    it("captures and forwards child process stderr output", () => {
      const onStderr = vi.fn();
      client.on("stderr", onStderr);

      mockProc.stderr.write("Diagnostic debug line\n");

      expect(onStderr).toHaveBeenCalledWith("Diagnostic debug line\n");
    });

    it("ignores valid JSON lines that are not recognized RPC events", () => {
      const onEvent = vi.fn();
      client.on("event", onEvent);

      mockProc.stdout.write(JSON.stringify({ type: "unknown_custom_event", value: 123 }) + "\n");

      expect(onEvent).not.toHaveBeenCalled();
    });

    it("updates activeTurnId when turn_start includes an id", () => {
      mockProc.stdout.write(JSON.stringify({ type: "turn_start", id: "turn-abc-123" }) + "\n");
      expect(client.activeTurnId).toBe("turn-abc-123");
    });
  });

  describe("Outbound Commands", () => {
    let client: PiClient;

    beforeEach(async () => {
      client = new PiClient({
        workspaceDir: "/workspace/project",
        spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
      });
      await client.start();
    });

    it("throws if prompt() is called before start()", async () => {
      const unstartedClient = new PiClient({ workspaceDir: "/workspace/project" });
      await expect(unstartedClient.prompt("Hello")).rejects.toThrow("process is not running");
    });

    it("serializes standard prompt command to stdin and marks isIdle false", async () => {
      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      await client.prompt("Hello Pi!");

      expect(client.isIdle).toBe(false);
      expect(writtenData.endsWith("\n")).toBe(true);

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed).toEqual(
        expect.objectContaining({
          type: "prompt",
          message: "Hello Pi!",
        })
      );
      expect(typeof parsed.id).toBe("string");
      expect(parsed.streamingBehavior).toBeUndefined();
    });

    it("automatically sets streamingBehavior to 'steer' when prompting while isStreaming is true", async () => {
      // Simulate streaming start
      mockProc.stdout.write(JSON.stringify({ type: "turn_start" }) + "\n");
      expect(client.isStreaming).toBe(true);

      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      await client.prompt("Stop that and do this instead");

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed).toEqual(
        expect.objectContaining({
          type: "prompt",
          message: "Stop that and do this instead",
          streamingBehavior: "steer",
        })
      );
    });

    it("automatically sets streamingBehavior to 'steer' when isIdle is false even if isStreaming is false", async () => {
      // Agent has started or turn has ended, but agent not yet settled (isIdle === false, isStreaming === false)
      mockProc.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
      expect(client.isIdle).toBe(false);
      expect(client.isStreaming).toBe(false);

      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      await client.prompt("Steer active run before turn begins");

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed.streamingBehavior).toBe("steer");
    });

    it("does not mutate isIdle or activeTurnId if sendCommand fails during prompt()", async () => {
      expect(client.isIdle).toBe(true);
      expect(client.activeTurnId).toBeNull();

      mockProc.stdin.destroy();

      await expect(client.prompt("This will fail to send")).rejects.toThrow("child process stdin is not writable");

      expect(client.isIdle).toBe(true);
      expect(client.activeTurnId).toBeNull();
    });

    it("respects explicit streamingBehavior option even when streaming", async () => {
      mockProc.stdout.write(JSON.stringify({ type: "turn_start" }) + "\n");
      expect(client.isStreaming).toBe(true);

      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      await client.prompt("Queued message", { streamingBehavior: "followUp" });

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed.streamingBehavior).toBe("followUp");
    });

    it("supports prompt with image attachments and multimodal ContentPart array", async () => {
      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      const images = [{ type: "image" as const, data: "base64data", mimeType: "image/png" }];
      await client.prompt("Inspect this image", { images });

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed.images).toEqual(images);
    });

    it("supports prompt with ContentPart array message and sets activeTurnId", async () => {
      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      const parts = [{ type: "text" as const, text: "Describe this" }];
      await client.prompt(parts);

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed.message).toEqual(parts);
      expect(client.activeTurnId).toBe(parsed.id);

      // Simulate settlement clearing activeTurnId
      mockProc.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\n");
      expect(client.activeTurnId).toBeNull();
    });

    it("throws if child process stdin is destroyed when sending a command", async () => {
      mockProc.stdin.destroy();
      await expect(client.prompt("Hello")).rejects.toThrow("child process stdin is not writable");
    });

    it("sends abort command to stdin", async () => {
      let writtenData = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        writtenData += chunk.toString();
      });

      await client.abort();

      const parsed = JSON.parse(writtenData.trim());
      expect(parsed).toEqual(
        expect.objectContaining({
          type: "abort",
        })
      );
      expect(typeof parsed.id).toBe("string");
    });

    it("throws if abort() is called when client is not running", async () => {
      const unstartedClient = new PiClient({ workspaceDir: "/workspace/project" });
      await expect(unstartedClient.abort()).rejects.toThrow("process is not running");
    });

    it("getState() sends get_state command and resolves on matching response event", async () => {
      let sentId = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        const parsed = JSON.parse(chunk.toString().trim());
        sentId = parsed.id;
      });

      const statePromise = client.getState(1000);

      expect(sentId).toBeTruthy();

      // Emit matching response from stdout
      const responseEvent = {
        type: "response",
        id: sentId,
        success: true,
        data: { model: "claude-3-7-sonnet", sessionId: "sess-123" },
      };
      mockProc.stdout.write(JSON.stringify(responseEvent) + "\n");

      const state = await statePromise;
      expect(state).toEqual({ model: "claude-3-7-sonnet", sessionId: "sess-123" });
    });

    it("getState() rejects when response contains an error", async () => {
      let sentId = "";
      mockProc.stdin.on("data", (chunk: Buffer) => {
        const parsed = JSON.parse(chunk.toString().trim());
        sentId = parsed.id;
      });

      const statePromise = client.getState(1000);

      const responseEvent = {
        type: "response",
        id: sentId,
        success: false,
        error: "Failed to inspect state",
      };
      mockProc.stdout.write(JSON.stringify(responseEvent) + "\n");

      await expect(statePromise).rejects.toThrow("Failed to inspect state");
    });

    it("getState() rejects if timeout occurs", async () => {
      await expect(client.getState(50)).rejects.toThrow("Timeout waiting for get_state response");
    });

    it("getState() cleans up timer and pending map if sendCommand fails", async () => {
      mockProc.stdin.destroy();
      await expect(client.getState(1000)).rejects.toThrow("child process stdin is not writable");
    });
  });

  describe("Process Teardown & Crash Handling", () => {
    let client: PiClient;

    beforeEach(async () => {
      client = new PiClient({
        workspaceDir: "/workspace/project",
        spawn: mockSpawn as unknown as typeof import("node:child_process").spawn,
      });
      await client.start();
    });

    it("stop() sends SIGTERM to child process and cleans up", async () => {
      expect(client.isRunning).toBe(true);

      await client.stop(500);

      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(client.isRunning).toBe(false);
      expect(client.status).toBe("closed");
    });

    it("stop() does nothing if process is not running", async () => {
      await client.stop();
      // Second stop call should resolve safely
      await expect(client.stop()).resolves.toBeUndefined();
    });

    it("stop() returns immediately without delay if process already exited", async () => {
      mockProc.exitCode = 0;
      expect(client.isRunning).toBe(false);

      const start = Date.now();
      await client.stop(2000);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(mockProc.kill).not.toHaveBeenCalled();
    });

    it("isRunning returns false when exitCode or signalCode is present", () => {
      expect(client.isRunning).toBe(true);

      mockProc.exitCode = 1;
      expect(client.isRunning).toBe(false);

      mockProc.exitCode = null;
      mockProc.signalCode = "SIGTERM";
      expect(client.isRunning).toBe(false);
    });

    it("stop() forces SIGKILL if process does not exit within grace period", async () => {
      // Override kill to NOT emit exit immediately on SIGTERM
      mockProc.kill = vi.fn().mockImplementation((signal?: string | number) => {
        if (signal === "SIGKILL") {
          mockProc.killed = true;
          mockProc.emit("exit", 137, "SIGKILL");
        }
        return true;
      });

      await client.stop(50);

      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
      expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(client.isRunning).toBe(false);
    });

    it("rejects pending requests and resets states when process crashes / exits unexpectedly", async () => {
      const onExit = vi.fn();
      client.on("exit", onExit);

      // Start pending getState
      const statePromise = client.getState(1000);

      // Simulate turn active
      mockProc.stdout.write(JSON.stringify({ type: "turn_start" }) + "\n");
      mockProc.stdout.write(JSON.stringify({ type: "toolcall_start", toolName: "bash" }) + "\n");
      expect(client.isStreaming).toBe(true);
      expect(client.currentTool).toBe("bash");

      // Simulate unexpected crash
      mockProc.emit("exit", 1, null);

      expect(onExit).toHaveBeenCalledWith(1, null);
      expect(client.isIdle).toBe(true);
      expect(client.isStreaming).toBe(false);
      expect(client.currentTool).toBeNull();

      await expect(statePromise).rejects.toThrow("Pi process exited unexpectedly");
    });

    it("emits error event when child process emits error", () => {
      const onError = vi.fn();
      client.on("error", onError);

      const procError = new Error("Failed to spawn");
      mockProc.emit("error", procError);

      expect(onError).toHaveBeenCalledWith(procError);
    });
  });
});
