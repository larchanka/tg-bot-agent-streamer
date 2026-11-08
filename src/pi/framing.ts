import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

export interface ProtocolFramerOptions {
  /**
   * Whether to ignore lines containing only whitespace or empty lines.
   * Defaults to true, as JSONL protocol records cannot be empty.
   */
  ignoreEmpty?: boolean;
}

/**
 * Strips optional trailing '\r' and filters out empty lines if ignoreEmpty is true.
 * Returns null if the line should be discarded.
 */
function sanitizeLine(raw: string, ignoreEmpty: boolean): string | null {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (ignoreEmpty && line.trim().length === 0) {
    return null;
  }
  return line;
}

/**
 * Serializes any JavaScript object or value to a JSON string strictly terminated by LF ('\n').
 *
 * @param command - Object or payload to serialize.
 * @returns JSON string strictly terminated by '\n' (0x0A).
 * @throws TypeError if command serializes to undefined.
 */
export function serializeCommand(command: unknown): string {
  const json = JSON.stringify(command);
  if (json === undefined) {
    throw new TypeError("Cannot serialize undefined command to JSON");
  }
  return json + "\n";
}

/**
 * ProtocolFramer accumulates incoming stream chunks (string or Buffer) and yields
 * complete JSONL records delimited strictly by LF ('\n' or 0x0A).
 *
 * It is completely immune to Unicode Line Separator (U+2028) and Paragraph
 * Separator (U+2029) splitting issues inherent to Node.js `readline`.
 */
export class ProtocolFramer extends EventEmitter {
  private buffer: string = "";
  private readonly decoder: StringDecoder = new StringDecoder("utf8");
  private readonly ignoreEmpty: boolean;

  constructor(options: ProtocolFramerOptions = {}) {
    super();
    this.ignoreEmpty = options.ignoreEmpty ?? true;
  }

  /**
   * Consumes an incoming chunk (string, Buffer, or Uint8Array) and returns
   * an array of complete lines that were terminated by '\n'.
   *
   * Also emits a 'line' event for each complete line.
   */
  public feed(chunk: string | Buffer | Uint8Array): string[] {
    const chunkStr = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.buffer += chunkStr;

    const lines: string[] = [];
    let newlineIndex: number;

    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const sanitized = sanitizeLine(rawLine, this.ignoreEmpty);
      if (sanitized !== null) {
        lines.push(sanitized);
        this.emit("line", sanitized);
      }
    }

    return lines;
  }

  /**
   * Alias for feed(chunk).
   */
  public push(chunk: string | Buffer | Uint8Array): string[] {
    return this.feed(chunk);
  }

  /**
   * Flushes any remaining bytes in the decoder and trailing buffer.
   * If there is an unterminated trailing line, strips optional '\r' and returns it.
   */
  public flush(): string[] {
    const remainder = this.decoder.end();
    if (remainder.length > 0) {
      this.buffer += remainder;
    }

    if (this.buffer.length === 0) {
      return [];
    }

    const rawLine = this.buffer;
    this.buffer = "";

    const sanitized = sanitizeLine(rawLine, this.ignoreEmpty);
    if (sanitized === null) {
      return [];
    }

    this.emit("line", sanitized);
    return [sanitized];
  }

  /**
   * Clears the accumulated buffer and resets the string decoder.
   */
  public reset(): void {
    this.buffer = "";
    this.decoder.end();
  }

  /**
   * Returns the current unconsumed raw buffer string.
   */
  public getBuffer(): string {
    return this.buffer;
  }

  /**
   * Attaches this framer to a Readable stream (e.g. childProcess.stdout).
   */
  public attach(stream: NodeJS.ReadableStream): this {
    stream.on("data", (chunk: Buffer | string) => {
      this.feed(chunk);
    });

    stream.on("end", () => {
      this.flush();
      this.emit("end");
    });

    return this;
  }
}

/**
 * JsonLineFramer is an alias for ProtocolFramer.
 */
export const JsonLineFramer = ProtocolFramer;
export type JsonLineFramer = ProtocolFramer;
