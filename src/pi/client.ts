import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ProtocolFramer, serializeCommand } from "./framing.js";
import {
  isRpcEvent,
  extractTextDelta,
  type ContentPart,
  type ImageContentPart,
  type PiRpcEvent,
  type PromptCommand,
  type AbortCommand,
  type GetStateCommand,
  type PiResponseEvent,
  type ToolCallStartEvent,
  type ToolCallEndEvent,
  type AgentSettledEvent,
  type PiErrorEvent,
  type PiClientStatus,
} from "./types.js";

export interface PiClientOptions {
  /**
   * Path to the pi CLI executable. Defaults to 'pi'.
   */
  piBin?: string;
  /**
   * Target workspace directory for tool executions (cwd).
   */
  workspaceDir: string;
  /**
   * Directory where session files and history are stored.
   */
  sessionDir?: string;
  /**
   * Optional model override passed via --model.
   */
  model?: string;
  /**
   * Custom spawn function for testing / dependency injection.
   */
  spawn?: typeof spawn;
}

export interface PromptOptions {
  streamingBehavior?: "steer" | "followUp";
  images?: ImageContentPart[];
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer?: NodeJS.Timeout;
}

/**
 * PiClient manages a long-running subprocess of `pi --mode rpc`.
 *
 * It communicates with Pi using strict LF-delimited JSONL over stdin/stdout,
 * maintains execution and streaming states, formats outbound commands,
 * and emits typed events for tokens, tools, and settlement.
 */
export class PiClient extends EventEmitter {
  private readonly options: PiClientOptions;
  private readonly spawnFn: typeof spawn;
  private childProcess: ChildProcess | null = null;
  private framer: ProtocolFramer | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  private _isIdle: boolean = true;
  private _isStreaming: boolean = false;
  private _currentTool: string | null = null;
  private _activeTurnId: string | null = null;

  constructor(options: PiClientOptions) {
    super();
    this.options = options;
    this.spawnFn = options.spawn ?? spawn;
  }

  public get isIdle(): boolean {
    return this._isIdle;
  }

  public get isStreaming(): boolean {
    return this._isStreaming;
  }

  public get currentTool(): string | null {
    return this._currentTool;
  }

  public get activeTurnId(): string | null {
    return this._activeTurnId;
  }

  public get isRunning(): boolean {
    return (
      this.childProcess !== null &&
      !this.childProcess.killed &&
      this.childProcess.exitCode === null &&
      this.childProcess.signalCode === null
    );
  }

  public get status(): PiClientStatus {
    if (!this.isRunning) {
      return "closed";
    }
    return this._isStreaming ? "streaming" : "idle";
  }

  /**
   * Starts the pi subprocess and attaches protocol framing.
   */
  public async start(): Promise<void> {
    if (this.childProcess) {
      throw new Error("PiClient is already running");
    }

    const args = this.buildSpawnArgs();
    const proc = this.spawnFn(this.options.piBin ?? "pi", args, {
      cwd: this.options.workspaceDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.childProcess = proc;
    this.setupProcessHandlers(proc);
    this.setupStdoutFramer(proc);
    this.setupStderrLogging(proc);
  }

  /**
   * Submits a user prompt to the pi agent.
   * If already streaming and no streamingBehavior is specified, automatically defaults to 'steer'.
   */
  public async prompt(message: string | ContentPart[], options: PromptOptions = {}): Promise<void> {
    this.assertProcessRunning();

    const id = randomUUID();
    const isBusy = this._isStreaming || !this._isIdle;
    const streamingBehavior = options.streamingBehavior ?? (isBusy ? "steer" : undefined);

    const command: PromptCommand = {
      id,
      type: "prompt",
      message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
      ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
    };

    this.sendCommand(command);
    this._isIdle = false;
    this._activeTurnId = id;
  }

  /**
   * Sends an abort command to immediately halt active LLM/tool execution.
   */
  public async abort(): Promise<void> {
    this.assertProcessRunning();

    const id = randomUUID();
    const command: AbortCommand = {
      id,
      type: "abort",
    };

    this.sendCommand(command);
  }

  /**
   * Requests the current agent state from Pi and waits for the response event.
   */
  public async getState(timeoutMs = 5000): Promise<unknown> {
    this.assertProcessRunning();

    const id = randomUUID();
    const command: GetStateCommand = {
      id,
      type: "get_state",
    };

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for get_state response (id: ${id})`));
        }, timeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timer });
        this.sendCommand(command);
      } catch (err) {
        if (timer) clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Gracefully terminates the pi subprocess.
   */
  public async stop(gracePeriodMs = 2000): Promise<void> {
    const proc = this.childProcess;
    if (!proc || proc.killed || proc.exitCode !== null || proc.signalCode !== null) {
      this.cleanupProcess();
      return;
    }

    return new Promise<void>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (!resolved) {
          resolved = true;
          this.cleanupProcess();
          resolve();
        }
      };

      const forceKillTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process might have already terminated
        }
        finish();
      }, gracePeriodMs);

      proc.once("exit", () => {
        clearTimeout(forceKillTimer);
        finish();
      });

      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(forceKillTimer);
        finish();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private buildSpawnArgs(): string[] {
    const args = ["--mode", "rpc"];
    if (this.options.sessionDir) {
      args.push("--session-dir", this.options.sessionDir);
    }
    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    return args;
  }

  private sendCommand(command: unknown): void {
    if (!this.childProcess?.stdin || this.childProcess.stdin.destroyed) {
      throw new Error("Cannot send command: child process stdin is not writable");
    }
    const serialized = serializeCommand(command);
    this.childProcess.stdin.write(serialized);
  }

  private assertProcessRunning(): void {
    if (!this.isRunning) {
      throw new Error("PiClient process is not running. Call start() first.");
    }
  }

  private setupProcessHandlers(proc: ChildProcess): void {
    proc.on("error", (err: Error) => {
      this.emit("error", err);
    });

    proc.stdin?.on("error", (err: Error) => {
      this.emit("error", err);
    });

    proc.on("exit", (code: number | null, signal: string | null) => {
      this.rejectAllPending(new Error(`Pi process exited unexpectedly with code ${code}, signal ${signal}`));
      this.cleanupProcess();
      this.emit("exit", code, signal);
    });
  }

  private setupStdoutFramer(proc: ChildProcess): void {
    if (!proc.stdout) return;
    this.framer = new ProtocolFramer();
    this.framer.on("line", (line: string) => this.handleRawLine(line));
    this.framer.attach(proc.stdout);
  }

  private setupStderrLogging(proc: ChildProcess): void {
    if (!proc.stderr) return;
    proc.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      this.emit("stderr", text);
    });
  }

  private handleRawLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      this.emit("warning", {
        type: "warning",
        message: `Failed to parse stdout JSON line: ${line}`,
        details: err,
      });
      return;
    }

    if (!isRpcEvent(parsed)) {
      return;
    }

    this.handleRpcEvent(parsed);
  }

  private handleRpcEvent(event: PiRpcEvent): void {
    this.updateStateOnEvent(event);
    this.resolvePendingIfResponse(event);
    this.emitTypedEvents(event);
  }

  private updateStateOnEvent(event: PiRpcEvent): void {
    switch (event.type) {
      case "agent_start":
        this._isIdle = false;
        break;
      case "turn_start":
        this._isIdle = false;
        this._isStreaming = true;
        if ("id" in event && typeof (event as { id?: unknown }).id === "string") {
          this._activeTurnId = (event as { id: string }).id;
        }
        break;
      case "turn_end":
        this._isStreaming = false;
        break;
      case "toolcall_start":
        this._currentTool = event.toolName;
        break;
      case "toolcall_end":
        this._currentTool = null;
        break;
      case "agent_settled":
        this._isIdle = true;
        this._isStreaming = false;
        this._currentTool = null;
        this._activeTurnId = null;
        break;
    }
  }

  private resolvePendingIfResponse(event: PiRpcEvent): void {
    if (event.type !== "response") return;
    const resp = event as PiResponseEvent;
    const pending = this.pendingRequests.get(resp.id);
    if (!pending) return;

    this.pendingRequests.delete(resp.id);
    if (pending.timer) clearTimeout(pending.timer);

    if (resp.error) {
      pending.reject(new Error(typeof resp.error === "string" ? resp.error : JSON.stringify(resp.error)));
    } else {
      pending.resolve(resp.data);
    }
  }

  private emitTypedEvents(event: PiRpcEvent): void {
    // Always emit the generic 'event'
    this.emit("event", event);
    // Emit named event (e.g. 'agent_start', 'turn_start', etc.)
    this.emit(event.type, event);

    if (event.type === "message_update") {
      const delta = extractTextDelta(event);
      if (delta !== undefined) {
        this.emit("token", delta);
      }
    } else if (event.type === "toolcall_start") {
      this.emit("tool_start", event as ToolCallStartEvent);
    } else if (event.type === "toolcall_end") {
      this.emit("tool_end", event as ToolCallEndEvent);
    } else if (event.type === "agent_settled") {
      this.emit("settled", event as AgentSettledEvent);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private cleanupProcess(): void {
    this._isIdle = true;
    this._isStreaming = false;
    this._currentTool = null;
    this._activeTurnId = null;
    this.childProcess = null;
    if (this.framer) {
      this.framer.reset();
      this.framer = null;
    }
    this.rejectAllPending(new Error("Pi client stopped"));
  }
}
