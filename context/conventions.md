# Engineering Conventions & Invariants

This document establishes the architecture conventions, coding standards, error handling patterns, and non-negotiable invariants for `tg-bot-agent-streamer`.

---

## 1. Code Style & TypeScript Standards

- **Runtime Target**: Node.js $\ge$ 20 with ECMAScript Modules (`"type": "module"`).
- **Module Resolution**: `NodeNext`. All relative imports **must** include the explicit `.js` extension (e.g., `import { loadConfig } from "./config.js";`).
- **File Naming**:
  - Source files and test files: `kebab-case.ts` (e.g., `src/pi/client.ts`, `tests/pi-client.test.ts`).
- **Identifier Naming**:
  - Classes, Interfaces, Types: `PascalCase` (e.g., `PiClient`, `ProtocolFramer`, `Config`).
  - Functions, Methods, Variables: `camelCase` (e.g., `createBot`, `balanceMarkdownTags`, `pushChunk`).
  - Constants and Enums: `UPPER_SNAKE_CASE` (e.g., `STREAM_THROTTLE_MS`, `MAX_MESSAGE_LENGTH`).
- **Strict Typing**: No implicit `any`. All function arguments and return types must be explicitly typed or strictly inferred via Zod schemas.

---

## 2. Critical Invariants (Non-Negotiable)

### Invariant 1: Strict LF Framing for Pi RPC
> [!IMPORTANT]
> The Pi RPC protocol requires records to be terminated strictly by LF (`\n`).
- **Never use Node.js `readline`**: The `readline` module splits on Unicode line and paragraph separators (`U+2028`, `U+2029`). Since JSON payloads frequently contain code or text containing these separators, `readline` will fragment JSON strings and corrupt protocol parsing.
- Always use the custom buffer in [`src/pi/framing.ts`](../src/pi/framing.ts) that buffers binary chunks and splits exclusively on `\n`.

### Invariant 2: Telegram Rate Limiting ($\ge 1000\text{ms}$)
- Telegram imposes a strict limit of $\sim 1$ message edit per second per chat.
- All intermediate streaming edits produced by incoming token deltas in [`src/telegram/throttler.ts`](../src/telegram/throttler.ts) must be throttled with a cooldown of at least $1000\text{ms}$.

### Invariant 3: Markdown Tag Balancing & Entity Fallback
- Telegram's `MarkdownV2` mode rejects messages with unmatched styling entities (e.g., unclosed ` ``` `, `*`, `_`, `~`, `||`).
- Every intermediate chunk must pass through `balanceMarkdownTags` in [`src/telegram/markdown.ts`](../src/telegram/markdown.ts) before editing.
- If Telegram still rejects an intermediate edit with an entity parsing error (`Bad Request: can't parse entities`), the throttler **must immediately fall back to plain unformatted text** to preserve stream continuity.

### Invariant 4: Message Length Splitting ($\le 4000$ Characters)
- Telegram hard-limits text messages to 4,096 UTF-8 characters.
- When the buffered agent response exceeds 4,000 characters, the throttler must finalize the current message and spawn a new continuation message.

### Invariant 5: Strict User Authentication
- The Telegram bot must never invoke or pass prompts to `PiClient` for users not explicitly listed in `ALLOWED_USER_IDS`. The auth guard in [`src/bot.ts`](../src/bot.ts) must reject unauthorized users immediately.

---

## 3. Error Handling & Resilience Patterns

1. **Subprocess Failures & Auto-Restart**:
   - If the `pi` subprocess exits unexpectedly, `PiClient` logs the exit code. If `PI_AUTO_RESTART=true`, it automatically restarts the subprocess on the next prompt.
2. **Graceful Shutdown**:
   - On receiving `SIGINT` or `SIGTERM`, [`src/index.ts`](../src/index.ts) catches the signal, stops the Telegram bot polling, issues an abort signal to `pi`, closes subprocess stdio, and terminates cleanly.
3. **Network Retries**:
   - Telegram API network timeouts or 429 Too Many Requests errors are intercepted by `@grammyjs/auto-retry` to avoid unhandled promise rejections.

---

## 4. Testing Strategy

Tests are executed using `vitest run`. All tests run without requiring a live Telegram bot token or an active `pi` binary by utilizing comprehensive mocks for stdio and Telegram contexts.

### Test Suite Directory & Coverage
The test suite consists of 10 test files covering all system layers:

1. [`tests/config.test.ts`](../tests/config.test.ts): Validates environment parsing, default values, and Zod schema constraints.
2. [`tests/framing.test.ts`](../tests/framing.test.ts): Verifies strict LF splitting, multi-chunk accumulation, Unicode character handling, and serialization.
3. [`tests/types.test.ts`](../tests/types.test.ts): Verifies Pi RPC protocol types and schemas.
4. [`tests/markdown.test.ts`](../tests/markdown.test.ts): Tests partial markdown tag balancing across backticks, bold, italic, and strikethrough.
5. [`tests/media.test.ts`](../tests/media.test.ts): Verifies Telegram photo downloading, mock buffer processing, and base64 encoding.
6. [`tests/throttler.test.ts`](../tests/throttler.test.ts): Verifies 1000ms edit throttling, chunk concatenation, length splitting at 4000 characters, and fallback mechanisms.
7. [`tests/pi-client.test.ts`](../tests/pi-client.test.ts): Validates subprocess spawning, stdio piping, event dispatching, and process restarts.
8. [`tests/bot.test.ts`](../tests/bot.test.ts): Tests Telegram command routing (`/start`, `/status`, `/abort`, `/model`), auth guards, and inline keyboards.
9. [`tests/index.test.ts`](../tests/index.test.ts): Verifies bootstrap logic, process signal listeners, and cleanup sequences.
10. [`tests/integration.test.ts`](../tests/integration.test.ts): End-to-end integration test connecting bot, throttler, and mock Pi subprocess.
