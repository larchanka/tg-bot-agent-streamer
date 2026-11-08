import { formatTelegramMarkdown, stripMarkdown } from "./markdown.js";

export interface TelegramApiLike {
  sendMessage(
    chatId: number | string,
    text: string,
    other?: { parse_mode?: string; [key: string]: unknown }
  ): Promise<{ message_id: number }>;
  editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    other?: { parse_mode?: string; [key: string]: unknown }
  ): Promise<unknown>;
  sendChatAction(
    chatId: number | string,
    action: string
  ): Promise<unknown>;
}

export interface StreamThrottlerOptions {
  throttleMs?: number;
  maxMessageLength?: number;
  typingIntervalMs?: number;
  initialMessageId?: number;
}

export class StreamThrottler {
  private readonly api: TelegramApiLike;
  private readonly chatId: number | string;
  private readonly throttleMs: number;
  private readonly maxMessageLength: number;
  private readonly typingIntervalMs: number;

  private buffer = "";
  private dirty = false;
  private currentMessageId?: number;
  private currentToolStatus: string | null = null;

  private throttleTimer: NodeJS.Timeout | null = null;
  private typingTimer: NodeJS.Timeout | null = null;
  private inFlightFlush: Promise<void> | null = null;

  private _isFinalized = false;
  private _isAborted = false;

  constructor(
    api: TelegramApiLike,
    chatId: number | string,
    options: StreamThrottlerOptions = {}
  ) {
    this.api = api;
    this.chatId = chatId;
    this.throttleMs = Math.max(100, options.throttleMs ?? 1000);
    this.maxMessageLength = options.maxMessageLength ?? 4000;
    this.typingIntervalMs = options.typingIntervalMs ?? 4000;
    this.currentMessageId = options.initialMessageId;

    this.startTimers();
  }

  public get currentText(): string {
    return this.buffer;
  }

  public get messageId(): number | undefined {
    return this.currentMessageId;
  }

  public get isFinalized(): boolean {
    return this._isFinalized;
  }

  public get isAborted(): boolean {
    return this._isAborted;
  }

  public feed(chunk: string): void {
    if (this._isFinalized || this._isAborted) {
      return;
    }
    this.buffer += chunk;
    this.dirty = true;
  }

  public setToolStatus(toolName: string | null): void {
    if (this._isFinalized || this._isAborted) {
      return;
    }
    this.currentToolStatus = toolName;
    this.dirty = true;
  }

  private startTimers(): void {
    if (this.typingIntervalMs > 0) {
      this.sendTypingAction();
      this.typingTimer = setInterval(() => {
        this.sendTypingAction();
      }, this.typingIntervalMs);
    }

    if (this.throttleMs > 0) {
      this.throttleTimer = setInterval(() => {
        void this.onThrottleTick();
      }, this.throttleMs);
    }
  }

  private sendTypingAction(): void {
    if (this._isFinalized || this._isAborted) {
      return;
    }
    this.api.sendChatAction(this.chatId, "typing").catch(() => {});
  }

  private async onThrottleTick(): Promise<void> {
    if (!this.dirty || this.inFlightFlush || this._isFinalized || this._isAborted) {
      return;
    }

    this.inFlightFlush = this.flushIntermediate();
    try {
      await this.inFlightFlush;
    } catch {
      this.dirty = true;
    } finally {
      this.inFlightFlush = null;
    }
  }

  private async flushIntermediate(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;

    if (!this.buffer && !this.currentToolStatus) {
      return;
    }

    await this.splitAndFinalizeExceededChunks();

    const intermediateText = this.buildIntermediateContent();
    if (!intermediateText) return;

    if (this.currentMessageId === undefined) {
      const res = await this.sendMessageWithFallback(intermediateText, true);
      if (res) {
        this.currentMessageId = res.message_id;
      }
    } else {
      await this.editMessageTextWithFallback(this.currentMessageId, intermediateText, true);
    }
  }

  private async splitAndFinalizeExceededChunks(): Promise<void> {
    while (this.buffer.length >= this.maxMessageLength) {
      let splitIndex = this.maxMessageLength;
      const lastNewline = this.buffer.lastIndexOf("\n", this.maxMessageLength);
      if (lastNewline > this.maxMessageLength * 0.75) {
        splitIndex = lastNewline + 1;
      }

      const chunkToFinalize = this.buffer.slice(0, splitIndex);

      if (this.currentMessageId !== undefined) {
        await this.editMessageTextWithFallback(this.currentMessageId, chunkToFinalize, true);
      } else {
        await this.sendMessageWithFallback(chunkToFinalize, true);
      }

      this.buffer = this.buffer.slice(splitIndex);
      this.currentMessageId = undefined;
    }
  }

  private async sendMessageWithFallback(
    text: string,
    isPartial: boolean
  ): Promise<{ message_id: number } | undefined> {
    try {
      const formatted = formatTelegramMarkdown(text, isPartial);
      return await this.api.sendMessage(this.chatId, formatted, {
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      if (this.isEntityParseError(error)) {
        const plain = stripMarkdown(text);
        return await this.api.sendMessage(this.chatId, plain);
      }
      throw error;
    }
  }

  private async editMessageTextWithFallback(
    messageId: number,
    text: string,
    isPartial: boolean
  ): Promise<void> {
    try {
      const formatted = formatTelegramMarkdown(text, isPartial);
      await this.api.editMessageText(this.chatId, messageId, formatted, {
        parse_mode: "MarkdownV2",
      });
    } catch (error) {
      if (this.isMessageNotModifiedError(error)) {
        return;
      }
      if (this.isEntityParseError(error)) {
        const plain = stripMarkdown(text);
        try {
          await this.api.editMessageText(this.chatId, messageId, plain);
        } catch (plainError) {
          if (this.isMessageNotModifiedError(plainError)) {
            return;
          }
          throw plainError;
        }
        return;
      }
      throw error;
    }
  }

  private isEntityParseError(err: unknown): boolean {
    const str = `${(err as { message?: string })?.message ?? ""} ${(err as { description?: string })?.description ?? ""}`.toLowerCase();
    return str.includes("can't parse entities") || str.includes("cant parse entities") || str.includes("parse error");
  }

  private isMessageNotModifiedError(err: unknown): boolean {
    const str = `${(err as { message?: string })?.message ?? ""} ${(err as { description?: string })?.description ?? ""}`.toLowerCase();
    return str.includes("message is not modified");
  }

  private buildIntermediateContent(): string {
    const badge = this.currentToolStatus
      ? `⚙️ *Running:* \`${this.currentToolStatus}\`...`
      : "";

    if (!this.buffer) {
      return badge;
    }

    if (!badge) {
      return this.buffer;
    }

    return `${this.buffer}\n\n${badge}`;
  }

  public async finalize(): Promise<void> {
    if (this._isFinalized || this._isAborted) {
      return;
    }

    this.clearTimers();

    if (this.inFlightFlush) {
      try {
        await this.inFlightFlush;
      } catch {
        // Ignored
      }
    }

    await this.splitAndFinalizeExceededChunks();

    if (this.buffer.length > 0) {
      if (this.currentMessageId !== undefined) {
        await this.editMessageTextWithFallback(this.currentMessageId, this.buffer, false);
      } else {
        const res = await this.sendMessageWithFallback(this.buffer, false);
        if (res) {
          this.currentMessageId = res.message_id;
        }
      }
    } else if (this.currentMessageId !== undefined) {
      await this.editMessageTextWithFallback(this.currentMessageId, "_Done (no output)_", false);
    }

    this._isFinalized = true;
  }

  public async abort(): Promise<void> {
    this.clearTimers();
    this._isAborted = true;
  }

  private clearTimers(): void {
    if (this.throttleTimer) {
      clearInterval(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }
}
