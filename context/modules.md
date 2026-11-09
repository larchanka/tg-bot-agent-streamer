# Module Catalog

This document details all modules, exported public APIs, classes, functions, and test suites across the repository.

---

## 1. Application Entry & Bootstrap

### `src/index.ts`
- **Location**: [`src/index.ts`](../src/index.ts)
- **Role**: Primary application bootstrap, signal handling, and lifecycle orchestration.
- **Key Functions**:
  - `main()`: Loads configuration, instantiates `PiClient`, initializes Telegram bot via `createBot()`, attaches process signal listeners, and starts bot polling.
  - `setupProcessHandlers(cleanupFn)`: Handles `SIGINT`, `SIGTERM`, unhandled promise rejections, and uncaught exceptions to guarantee clean subprocess and bot termination.
- **Dependencies**: `src/config.ts`, `src/pi/client.ts`, `src/bot.ts`, `node:fs`, `node:url`.
- **Test Suite**: [`tests/index.test.ts`](../tests/index.test.ts) (verifies bootstrap initialization, signal handling, and shutdown sequences).

---

## 2. Configuration & Validation

### `src/config.ts`
- **Location**: [`src/config.ts`](../src/config.ts)
- **Role**: Environment variable parsing, default assignment, and strict schema validation using Zod.
- **Key Types & Functions**:
  - `ConfigSchema`: Zod schema validating `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS` (comma-separated integer list), `PI_COMMAND`, `PI_ARGS`, `PI_WORKDIR`, `PI_AUTO_RESTART`, `STREAM_THROTTLE_MS`, etc.
  - `loadConfig()`: Reads environment variables, validates them against `ConfigSchema`, and returns a strongly-typed `Config` object.
  - `type Config`: TypeScript inference of the validated configuration schema.
- **Dependencies**: `dotenv`, `zod`.
- **Test Suite**: [`tests/config.test.ts`](../tests/config.test.ts) (tests default values, type coercions, missing variable errors, and user ID parsing).

---

## 3. Telegram Bot Layer

### `src/bot.ts`
- **Location**: [`src/bot.ts`](../src/bot.ts)
- **Role**: GrammY bot configuration, authentication guard middleware, command dispatching, and message handling.
- **Key Functions**:
  - `createBot(config: Config, piClient: PiClient)`: Builds and returns a configured `Bot` instance.
  - Auth Middleware: Intercepts all updates and rejects unauthorized users not in `config.allowedUserIds`.
  - Command Handlers:
    - `/start`: Welcome message and usage instructions.
    - `/status`: Checks status of `PiClient` subprocess, active session, and current model.
    - `/abort`: Issues an abort command to immediately stop the running agent execution.
    - `/model`: Displays available models and sets active model via inline buttons.
    - `/session`: Lists or switches active agent sessions.
  - Message Handlers:
    - Text messages: Passes text prompt to `PiClient.prompt()`, streams deltas via `Throttler`.
    - Photo messages: Uses `media.ts` to download image, converts to base64, and sends multimodal prompt to `PiClient`.
- **Dependencies**: `grammy`, `@grammyjs/auto-retry`, `src/config.ts`, `src/pi/client.ts`, `src/telegram/throttler.ts`, `src/telegram/media.ts`.
- **Test Suite**: [`tests/bot.test.ts`](../tests/bot.test.ts) (tests auth middleware, command routing, inline keyboard interactions, and photo handling).

---

## 4. Pi Subprocess & Protocol Subsystem

### `src/pi/client.ts`
- **Location**: [`src/pi/client.ts`](../src/pi/client.ts)
- **Role**: Subprocess manager for `pi --mode rpc`. Handles lifecycle, bidirectional communication, event parsing, and process resurrection.
- **Exported Classes**:
  - `PiClient`: Extends `EventEmitter`.
    - `start()`: Spawns the `pi` process with configured args and working directory.
    - `prompt(text: string, options?: PromptOptions)`: Sends a prompt command to the agent subprocess.
    - `abort()`: Dispatches an abort signal to cancel in-flight agent actions.
    - `setSession(sessionId: string)`: Switches or creates an agent session.
    - `setModel(modelName: string)`: Changes the LLM model.
    - `listModels()`: Requests available models from the agent.
    - `stop()`: Gracefully closes stdin and kills the subprocess.
    - `restart()`: Re-spawns the agent subprocess if auto-restart is enabled.
- **Events Emitted**:
  - `agent_start`: Low-level run starts.
  - `turn_start`: Assistant turn begins.
  - `message_start`: Beginning of model text response.
  - `message_update`: Live streaming text deltas (`text_delta`).
  - `toolcall_start`: Tool execution begins (e.g., bash, read, edit).
  - `toolcall_end`: Tool execution finishes.
  - `turn_end`: Assistant turn completes.
  - `agent_settled`: Agent run fully settled; signals readiness for final message edit.
  - `error`: Subprocess or protocol errors.
- **Dependencies**: `node:child_process`, `node:events`, `node:crypto`, `src/pi/framing.ts`, `src/pi/types.ts`.
- **Test Suite**: [`tests/pi-client.test.ts`](../tests/pi-client.test.ts) (tests lifecycle, command sending, event emission, error recovery, and auto-restart).

### `src/pi/framing.ts`
- **Location**: [`src/pi/framing.ts`](../src/pi/framing.ts)
- **Role**: Strict LF (`\n`) JSONL stream framer and serializer.
- **Key Classes & Functions**:
  - `ProtocolFramer`: Custom stream framing buffer. Accumulates string chunks and splits strictly on newline (`\n`). Avoids using `readline` to protect Unicode paragraph separators (`U+2028`, `U+2029`) inside JSON bodies.
  - `serializeCommand(cmd: Command)`: Serializes a JSON object to a string terminated by `\n`.
- **Dependencies**: `node:string_decoder`.
- **Test Suite**: [`tests/framing.test.ts`](../tests/framing.test.ts) (tests chunk boundary splits, multiline chunks, Unicode line separators, and error handling for invalid JSON).

### `src/pi/types.ts`
- **Location**: [`src/pi/types.ts`](../src/pi/types.ts)
- **Role**: Type definitions and Zod schemas for the Pi RPC protocol.
- **Key Types**:
  - `Command`: Tagged union of commands (`prompt`, `abort`, `set_session`, `set_model`, `list_models`).
  - `RpcEvent`: Tagged union of all incoming events (`turn_start`, `message_update`, `toolcall_start`, etc.).
  - `StreamingBehavior`: Streaming control options (`steer`, `followUp`).
  - `PromptOptions`: Configuration options passed to `client.prompt()`.
- **Test Suite**: [`tests/types.test.ts`](../tests/types.test.ts) (tests type validation and schema parsing).

---

## 5. Telegram Presentation & Formatting Utilities

### `src/telegram/throttler.ts`
- **Location**: [`src/telegram/throttler.ts`](../src/telegram/throttler.ts)
- **Role**: Manages Telegram rate-limited editing and message length splitting during token streaming.
- **Key Classes & Methods**:
  - `Throttler`:
    - `pushChunk(text: string)`: Appends newly arrived tokens to the internal streaming buffer.
    - `updateStatus(status: string)`: Updates the current tool call or status line.
    - `flush()`: Schedules an edit if throttler cooldown ($\ge 1000\text{ms}$) has expired.
    - `finalize()`: Flushes remaining buffer, balances markdown tags, and sends final message edit.
    - `splitMessage(text: string)`: Splits text into chunks of $\le 4000$ characters without breaking words.
- **Dependencies**: `grammy`, `src/telegram/markdown.ts`.
- **Test Suite**: [`tests/throttler.test.ts`](../tests/throttler.test.ts) (tests 1000ms edit throttling, chunk concatenation, message splitting, and finalization).

### `src/telegram/markdown.ts`
- **Location**: [`src/telegram/markdown.ts`](../src/telegram/markdown.ts)
- **Role**: Balances unclosed markdown tags in incomplete streaming chunks and converts standard markdown to Telegram MarkdownV2 format.
- **Key Functions**:
  - `balanceMarkdownTags(text: string)`: Balances unclosed backticks (`` ` `` and ```` ``` ````), asterisks (`*`), underscores (`_`), and spoilers (`||`) to prevent Telegram parse errors.
  - `toTelegramMarkdown(text: string)`: Integrates with `telegramify-markdown` to produce valid MarkdownV2 entities.
- **Dependencies**: `telegramify-markdown`.
- **Test Suite**: [`tests/markdown.test.ts`](../tests/markdown.test.ts) (tests tag balancing for partial streaming inputs and entity safety).

### `src/telegram/media.ts`
- **Location**: [`src/telegram/media.ts`](../src/telegram/media.ts)
- **Role**: Downloads media attachments from Telegram servers and prepares them for Pi multimodal ingestion.
- **Key Functions**:
  - `downloadTelegramPhoto(bot: Bot, fileId: string)`: Fetches file information from Telegram, downloads binary buffer, and encodes as base64 with appropriate MIME type.
- **Dependencies**: `grammy`.
- **Test Suite**: [`tests/media.test.ts`](../tests/media.test.ts) (tests photo downloading, base64 encoding, and error handling for missing files).

### `src/telegram/rich-types.ts`
- **Location**: [`src/telegram/rich-types.ts`](../src/telegram/rich-types.ts)
- **Role**: Telegram Bot API 10.1+ Rich Message type declarations and re-exports.
- **Key Types**:
  - `InputRichMessage`, `InputRichBlock`, `InputRichBlockTable`, `RichBlockTableCell`, `InputRichBlockParagraph`, `InputRichBlockSectionHeading`, `InputRichBlockPreformatted`, `InputRichBlockList`, `InputRichBlockListItem`, `InputRichBlockBlockQuotation`, `InputRichBlockExpandableBlockQuotation`, `InputRichBlockDetails`, `InputRichBlockDivider`, `InputRichBlockThinking`.
  - `RichText`, `RichTextEntity`, `RichTextBold`, `RichTextItalic`, `RichTextUnderline`, `RichTextStrikethrough`, `RichTextSpoiler`, `RichTextCode`, `RichTextUrl`, `RichTextMathematicalExpression`, `RichTextCustomEmoji`.
- **Dependencies**: `grammy/types`.

### `src/telegram/rich-text.ts`
- **Location**: [`src/telegram/rich-text.ts`](../src/telegram/rich-text.ts)
- **Role**: Markdown inline token parser converting inline syntax (bold, italic, code, underline, strikethrough, spoiler, links, LaTeX math) into structured Telegram `RichText` representations.
- **Key Functions**:
  - `parseInlineRichText(text: string): RichText`: Recursively parses Markdown inline formatting into structured `RichText` AST entities.
  - `parseRichText(text: string): RichText`: Alias of `parseInlineRichText`.
- **Dependencies**: `src/telegram/rich-types.ts`.
- **Test Suite**: [`tests/rich-text.test.ts`](../tests/rich-text.test.ts) (tests plain text, single tokens, mixed tokens, nested formatting, escaped chars, and unclosed streaming tokens).

### `src/telegram/rich-table.ts`
- **Location**: [`src/telegram/rich-table.ts`](../src/telegram/rich-table.ts)
- **Role**: GitHub Flavored Markdown (GFM) table parser and converter for Telegram Bot API 10.1+ native `InputRichBlockTable`.
- **Key Types & Functions**:
  - `TableOptions`: Options interface for `is_bordered`, `is_striped`, `is_compact`, `caption`, and `valign`.
  - `isMarkdownTable(text: string): boolean`: Validates whether the given text is a valid GFM table.
  - `parseMarkdownTable(tableMarkdown: string, options?: TableOptions): InputRichBlockTable | null`: Parses GFM table markdown into an `InputRichBlockTable` containing header and data rows with alignments and inline rich text.
  - `splitRowIntoCells(line: string): string[]`: Splits a row by unescaped pipes handling escaped pipes `\|` and stripping outer boundary pipes.
  - `parseDelimiterRow(line: string): CellAlignment[] | null`: Extracts column alignments (`left`, `center`, `right`) from delimiter rows.
- **Dependencies**: `src/telegram/rich-text.ts`, `src/telegram/rich-types.ts`.
- **Test Suite**: [`tests/rich-table.test.ts`](../tests/rich-table.test.ts) (tests basic tables, column alignments, inline formatting in cells, styling options, escaped pipes, ragged rows, and malformed inputs).

### `src/telegram/rich-parser.ts`
- **Location**: [`src/telegram/rich-parser.ts`](../src/telegram/rich-parser.ts)
- **Role**: Full Markdown to Telegram Bot API 10.1+ `InputRichMessage` block parser and orchestrator.
- **Key Types & Functions**:
  - `RichParserOptions`: Options interface supporting `tableOptions?: TableOptions`.
  - `parseMarkdownToRichMessage(markdown: string, options?: RichParserOptions): InputRichMessage & { blocks: InputRichBlock[] }`: Converts complete Markdown documents into structured `InputRichBlock[]` blocks (paragraphs, headings 1-6, fenced code blocks, GFM tables, blockquotes, expandable `<details>`, bullet/ordered/task lists, dividers `---`, and `<thinking>` blocks) with streaming resilience.
- **Dependencies**: `src/telegram/rich-text.ts`, `src/telegram/rich-table.ts`, `src/telegram/rich-types.ts`.
- **Test Suite**: [`tests/rich-parser.test.ts`](../tests/rich-parser.test.ts) (tests all block types, formatting combinations, unclosed code/thinking/details blocks, and complex mixed documents).

---

## 6. End-to-End & Integration Test Suite

### `tests/integration.test.ts`
- **Location**: [`tests/integration.test.ts`](../tests/integration.test.ts)
- **Role**: Full end-to-end integration test exercising the complete flow: Telegram mock message -> `bot.ts` -> `PiClient` -> mock Pi subprocess -> event streaming -> `Throttler` -> Telegram edit verification. Validates streaming token deltas, tool status badges, steering in-flight requests, `/stop` aborts, multimodal photo processing, unauthorized user restriction, and native rich message streaming (`sendRichMessageDraft`, `InputRichBlockThinking`, and finalized `InputRichBlockTable`).
