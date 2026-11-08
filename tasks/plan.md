# Implementation Plan: Telegram Bot Pi Agent Streamer

## Overview

Build a production-grade Telegram bot bridge connecting authorized Telegram users to the `pi` AI coding assistant running in bidirectional RPC mode (`pi --mode rpc`). The service features real-time streaming with 1-second rate-limiting, strict LF-based JSONL framing immune to Unicode line corruption, in-flight prompt steering and aborts, live tool execution indicators, resilient MarkdownV2 formatting with dynamic tag balancing and unformatted fallback, multimodal photo support, and security whitelisting.

---

## Architecture Decisions

1. **Strict LF Framing over Node.js Readline**:
   - *Rationale*: Node.js `readline` splits on `U+2028` and `U+2029` (ECMA-262 line terminators), which are valid inside JSON string literals and silently corrupt streamed JSON payloads. We implement a custom byte/string buffer in `src/pi/framing.ts` that splits exclusively on `\n` (stripping trailing `\r`).
2. **Decoupled Throttler with Dynamic Tag Balancing**:
   - *Rationale*: Telegram enforces a ~1 edit/sec flood limit and rejects unclosed formatting delimiters in MarkdownV2. The throttler buffers LLM tokens, flushes edits on a 1000ms timer, balances unclosed syntax tags (` ``` `, `*`, `_`, `||`, `~`, `` ` ``), and automatically falls back to plain unformatted text if Telegram entity parsing fails.
3. **Session & In-Flight Concurrency Management**:
   - *Rationale*: When Pi is actively streaming and a user submits a follow-up prompt, sending a raw prompt would disrupt the execution queue. The Pi client detects `isStreaming` state and sets `"streamingBehavior": "steer"` to seamlessly guide the agent after its current tool call. Aborts (`/stop`) immediately emit `{"type": "abort"}`.
4. **Modularity & Testability**:
   - *Rationale*: Each subsystem (framing, Pi client, throttler, markdown balancing, media downloader, bot routing) has clean boundaries and dedicated unit tests using `vitest`, allowing independent verification before end-to-end integration.

---

## Dependency Graph

```
Project Scaffold (package.json, tsconfig.json, config.ts)
    │
    ├── src/pi/framing.ts (LF Framer)
    │       │
    │       └── src/pi/client.ts (Pi Subprocess Manager & RPC Lifecycle)
    │
    ├── src/telegram/markdown.ts (Tag Balancer & MarkdownV2 Sanitizer)
    │       │
    │       └── src/telegram/throttler.ts (Edit Throttler & Chunk Splitter)
    │
    ├── src/telegram/media.ts (Telegram Photo to Base64 ImageContent)
    │
    └── src/bot.ts (grammY Bot, Whitelist Guard, Commands, Routing)
            │
            └── src/index.ts (Application Bootstrap & Lifecycle Management)
```

---

## Task List

### Phase 1: Project Setup & Core Protocol Framing

#### Task 1: Project Scaffolding & Configuration Module
**Description:** Initialize TypeScript project configuration, package dependencies (`grammy`, `@grammyjs/auto-retry`, `telegramify-markdown`, `dotenv`, `zod`, `vitest`, `tsx`, `typescript`), `package.json` scripts (`dev`, `build`, `start`, `typecheck`, `test`), and implement strongly typed environment configuration in `src/config.ts`.

**Acceptance criteria:**
- [ ] `package.json` contains all required runtime and development dependencies and scripts.
- [ ] `tsconfig.json` configured for Node.js 20+ ESM (`NodeNext` module resolution).
- [ ] `src/config.ts` parses and validates environment variables (`TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_IDS`, `PI_WORKSPACE_DIR`, `PI_MODEL`, `PI_SESSION_DIR`, `STREAM_THROTTLE_MS`) with Zod, throwing descriptive errors on invalid configurations.
- [ ] `vitest.config.ts` configured for ESM TypeScript test execution.

**Verification:**
- [ ] Build succeeds: `pnpm typecheck`
- [ ] Tests pass: `pnpm test`
- [ ] Config test verifies valid and invalid `.env` scenarios.

**Dependencies:** None
**Files likely touched:**
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/config.ts`
- `tests/config.test.ts`
**Estimated scope:** Medium (5 files)

---

#### Task 2: Strict LF Protocol Framer
**Description:** Implement `src/pi/framing.ts` with a custom stream framing class and serializer that strictly delimits records by `\n`, safely handles chunked data across network/pipe buffers, strips optional `\r`, and does not split on Unicode line separators `U+2028` / `U+2029`.

**Acceptance criteria:**
- [x] `JsonLineFramer` accumulates arbitrary chunks from a `ReadableStream` or `EventEmitter` and emits complete JSONL strings on `\n`.
- [x] Correctly parses lines containing `\r\n` by stripping `\r`.
- [x] Correctly preserves `\u2028` and `\u2029` within JSON payloads without breaking line boundaries.
- [x] Serializer terminates all outgoing commands strictly with `\n`.
- [x] Comprehensive unit tests cover split chunks, multi-line chunks, empty lines, and Unicode line separators.

**Verification:**
- [x] Tests pass: `pnpm test -- tests/framing.test.ts`
- [x] Build succeeds: `pnpm typecheck`

**Dependencies:** Task 1
**Files likely touched:**
- `src/pi/framing.ts`
- `tests/framing.test.ts`
**Estimated scope:** Small (2 files)

---

### Checkpoint: Foundation
- [x] Configuration validates environment variables accurately.
- [x] Protocol framing unit tests pass 100% with full coverage of edge cases.
- [x] `pnpm typecheck` passes with zero errors.

---

### Phase 2: Pi Subprocess Client & RPC Lifecycle

#### Task 3: Pi RPC Protocol Types & Definitions
**Description:** Define complete TypeScript types and interfaces in `src/pi/types.ts` reflecting the Pi RPC protocol, including incoming stdin commands (`prompt`, `abort`, `get_state`), image payloads, steering options, and outgoing stdout events (`agent_start`, `turn_start`, `message_update`, `toolcall_start`, `toolcall_end`, `turn_end`, `agent_end`, `agent_settled`, `response`, `error`).

**Acceptance criteria:**
- [ ] Type-safe discriminated unions for all Stdin commands and Stdout events.
- [ ] Assistant delta event types (`text_delta`, thinking events if present).
- [ ] Tool call metadata types (`toolName`, `id`, `args`, results).
- [ ] Client event emitter interface for consuming modules.

**Verification:**
- [ ] Build succeeds: `pnpm typecheck`

**Dependencies:** Task 1
**Files likely touched:**
- `src/pi/types.ts`
**Estimated scope:** Small (1 file)

---

#### Task 4: Pi Subprocess Client
**Description:** Implement `PiClient` in `src/pi/client.ts` to spawn `pi --mode rpc`, wire stdin/stdout through `JsonLineFramer`, track operational status (`isIdle`, `isStreaming`, `currentTool`), manage command request/response promises by ID, provide methods for `prompt`, `steer`, `abort`, `getState`, and emit typed lifecycle events.

**Acceptance criteria:**
- [ ] Spawns `pi` with arguments `--mode rpc --session-dir <dir>` and optional `--model <model>` inside `cwd: PI_WORKSPACE_DIR`.
- [ ] Maintains execution state: transitions to streaming on `agent_start` / `turn_start`, tracks active tool on `toolcall_start`/`end`, and returns to idle on `agent_settled`.
- [ ] Automatically uses `streamingBehavior: "steer"` when prompting during an active stream.
- [ ] `abort()` sends abort command and handles graceful halting.
- [ ] Emits high-level events: `token` (`text_delta`), `tool_start`, `tool_end`, `settled`, `error`.
- [ ] Clean shutdown: sends abort or kills child process on close.

**Verification:**
- [ ] Tests pass: `pnpm test -- tests/pi-client.test.ts`
- [ ] Build succeeds: `pnpm typecheck`

**Dependencies:** Tasks 2, 3
**Files likely touched:**
- `src/pi/client.ts`
- `tests/pi-client.test.ts`
**Estimated scope:** Medium (2 files)

---

### Checkpoint: Pi RPC Client
- [ ] Mocked subprocess tests verify prompt, steering, abort, and event emission flows.
- [ ] State transitions between idle and streaming operate reliably without deadlock.

---

### Phase 3: Telegram Formatting & Stream Throttling

#### Task 5: Dynamic Markdown Tag Balancer & Sanitizer
**Description:** Implement `src/telegram/markdown.ts` to balance incomplete markdown formatting tags generated during live LLM streaming (code blocks ` ``` `, inline code `` ` ``, bold `**`, italic `*`, spoilers `||`, strikethrough `~`), convert to Telegram-compatible MarkdownV2 via `telegramify-markdown`, and provide unformatted plain-text fallback handling.

**Acceptance criteria:**
- [ ] Automatically closes open code blocks by balancing triple backticks.
- [ ] Balances unescaped inline code backticks, asterisks, underscores, spoilers, and tildes.
- [ ] Applies `telegramify-markdown` to format valid markdown into MarkdownV2 syntax.
- [ ] Exports `formatStreamingChunk(text: string): { markdown: string; plain: string }` helper.
- [ ] Unit tests verify balancing for cut-off code blocks, lists, bold text, and complex multi-token streams.

**Verification:**
- [ ] Tests pass: `pnpm test -- tests/markdown.test.ts`
- [ ] Build succeeds: `pnpm typecheck`

**Dependencies:** Task 1
**Files likely touched:**
- `src/telegram/markdown.ts`
- `tests/markdown.test.ts`
**Estimated scope:** Small (2 files)

---

#### Task 6: Telegram Stream Throttler & Message Splitter
**Description:** Implement `StreamThrottler` in `src/telegram/throttler.ts` to buffer incoming tokens, enforce a >=1000ms edit throttle, display transient tool badges (e.g. `⚡ Running tool: bash (git status)...`), trigger typing indicators every 4 seconds, and gracefully split messages exceeding 4000 characters into new messages.

**Acceptance criteria:**
- [ ] Queues edits and dispatches `editMessageText` at most once every `STREAM_THROTTLE_MS` (default 1000ms).
- [ ] Appends dynamic transient status badge while a tool is executing, removing it once complete.
- [ ] Catches `can't parse entities` errors and retries edit with plain unformatted text.
- [ ] Ignores `message is not modified` Telegram errors silently.
- [ ] Automatically finalizes the current message and creates a continuation message when the character count approaches 4000 characters.
- [ ] Maintains recurring `typing` action loop while stream is active.
- [ ] `finalize()` immediately flushes any remaining buffer with full formatting and stops all background timers.

**Verification:**
- [ ] Tests pass: `pnpm test -- tests/throttler.test.ts`
- [ ] Build succeeds: `pnpm typecheck`

**Dependencies:** Tasks 1, 5
**Files likely touched:**
- `src/telegram/throttler.ts`
- `tests/throttler.test.ts`
**Estimated scope:** Medium (2 files)

---

### Checkpoint: Streaming & Markdown
- [ ] Markdown balancer handles all partial delimiter scenarios without throwing.
- [ ] Throttler passes rate-limit, fallback, tool badge, and 4000-char splitting unit tests.

---

### Phase 4: Multimodal Input & Bot Handlers

#### Task 7: Telegram Photo & Media Downloader
**Description:** Implement `src/telegram/media.ts` to retrieve photo file info from the Telegram Bot API (`bot.api.getFile`), download file content into memory, and convert to base64 `ImageContent` objects accepted by the Pi RPC prompt command.

**Acceptance criteria:**
- [ ] Extracts highest-resolution photo from incoming Telegram `photo` message array.
- [ ] Downloads file stream via Telegram Bot API file download URL.
- [ ] Encodes buffer to Base64 with proper MIME type (`image/jpeg`, `image/png`).
- [ ] Handles download failures or oversized files with helpful error messages.

**Verification:**
- [ ] Tests pass: `pnpm test -- tests/media.test.ts`
- [ ] Build succeeds: `pnpm typecheck`

**Dependencies:** Tasks 1, 3
**Files likely touched:**
- `src/telegram/media.ts`
- `tests/media.test.ts`
**Estimated scope:** Small (2 files)

---

#### Task 8: grammY Bot Setup, Security Whitelist & Command Handlers
**Description:** Implement `src/bot.ts` with grammY bot setup, auto-retry plugin, user ID whitelist middleware, command handlers (`/start`, `/help`, `/stop`, `/status`, `/new`), text message handler, and photo handler with caption support.

**Acceptance criteria:**
- [ ] Whitelist middleware rejects or notifies any user whose ID is not in `ALLOWED_TELEGRAM_USER_IDS`.
- [ ] Installed `@grammyjs/auto-retry` plugin to automatically handle transient Telegram network issues.
- [ ] `/start` and `/help` provide command overviews and system usage instructions.
- [ ] `/stop` immediately aborts the active Pi RPC agent run and notifies the user.
- [ ] `/status` returns active agent state (idle vs busy), active model, and session path.
- [ ] `/new` resets or rotates the session context.
- [ ] Standard message handler checks Pi state: if idle, starts streaming throttler and initiates agent run; if running, dispatches in-flight steering prompt.
- [ ] Photo handler downloads images via `media.ts`, attaches to prompt, and streams response.

**Verification:**
- [ ] Tests pass: `pnpm test -- tests/bot.test.ts`
- [ ] Build succeeds: `pnpm typecheck`

**Dependencies:** Tasks 4, 6, 7
**Files likely touched:**
- `src/bot.ts`
- `tests/bot.test.ts`
**Estimated scope:** Medium (2 files)

---

### Checkpoint: Bot & Media Integration
- [ ] Whitelist guard successfully blocks unauthorized access.
- [ ] In-flight steer vs idle prompt routing functions properly.
- [ ] Photo conversion integrates with Pi prompt payload structure.

---

### Phase 5: Entrypoint, Build & End-to-End Verification

#### Task 9: Application Entry Point & Process Lifecycle
**Description:** Implement `src/index.ts` to initialize configuration, instantiate `PiClient` and `bot`, configure graceful shutdown listeners for `SIGINT` / `SIGTERM`, ensure workspace and session directories exist, start long polling (`bot.start()`), and log startup diagnostics.

**Acceptance criteria:**
- [ ] Validates workspace and session directories, creating them if missing.
- [ ] Spawns Pi subprocess on startup and verifies handshake.
- [ ] Captures `SIGINT` and `SIGTERM` signals, cleanly stopping the bot and shutting down the Pi subprocess.
- [ ] Catches unhandled rejections and uncaught exceptions with structured logging.

**Verification:**
- [ ] Build succeeds: `pnpm build`
- [ ] `pnpm typecheck` passes cleanly
- [ ] Dry-run startup test succeeds

**Dependencies:** Tasks 1, 4, 8
**Files likely touched:**
- `src/index.ts`
**Estimated scope:** Small (1 file)

---

#### Task 10: Integration Testing, Build Verification & Documentation Validation
**Description:** Run complete test suite, verify production build (`pnpm build`), test `pi` CLI RPC compatibility via automated or scripted subprocess checks, and ensure all README / documentation commands (`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm test`, `pnpm typecheck`) work seamlessly.

**Acceptance criteria:**
- [ ] All unit and integration tests pass: `pnpm test`.
- [ ] TypeScript compilation passes with zero errors: `pnpm typecheck`.
- [ ] Production build (`dist/index.js`) is generated and executable: `pnpm build`.
- [ ] Workspace directory exists and `.env.example` aligns with `src/config.ts`.

**Verification:**
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] `node dist/index.js --help` or startup check confirms packaging integrity

**Dependencies:** Tasks 1-9
**Files likely touched:**
- `README.md`
- `tests/integration.test.ts`
**Estimated scope:** Small (2 files)

---

### Checkpoint: Complete
- [ ] All tasks completed and verified.
- [ ] 100% test pass rate across all modules.
- [ ] Application builds and starts cleanly.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Telegram rate-limit 429 when editing rapidly | High | Strict 1000ms minimum interval throttle in `StreamThrottler` + `@grammyjs/auto-retry` plugin. |
| Telegram entity parse error on partial Markdown | High | Dynamic tag balancing for open syntax tags + automated fallback to plain text if Telegram rejects MarkdownV2. |
| JSON stream corruption from Unicode separators (`U+2028`/`U+2029`) | High | Custom LF framer splitting exclusively on `\n` without Node's `readline`. |
| Concurrent user messages disrupting Pi execution | Medium | Detection of `isStreaming` state; prompts sent with `streamingBehavior: "steer"` during active turns. |
| Telegram message length overflow (>4096 chars) | Medium | Automatic threshold monitoring at 4000 characters; current message finalized and continuation message spawned. |
| Unauthorized tool execution on host machine | Critical | Whitelist middleware running prior to all handlers, dropping or rejecting updates from unlisted user IDs. |

---

## Open Questions
- None. Requirements, architecture, framing rules, and bot commands are fully specified in `docs/` and `AGENTS.md`.
