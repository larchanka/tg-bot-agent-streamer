# Implementation Checklist: Telegram Bot Pi Agent Streamer

## Phase 1: Project Setup & Core Protocol Framing
- [x] **Task 1: Project Scaffolding & Configuration Module**
  - [x] Configure `package.json` with dependencies (`grammy`, `@grammyjs/auto-retry`, `telegramify-markdown`, `dotenv`, `zod`, `vitest`, `tsx`, `typescript`) and scripts (`dev`, `build`, `start`, `typecheck`, `test`).
  - [x] Configure `tsconfig.json` for Node.js ESM (`NodeNext`).
  - [x] Configure `vitest.config.ts`.
  - [x] Implement strongly typed configuration parser in `src/config.ts`.
  - [x] Write unit tests for configuration parsing in `tests/config.test.ts`.
  - [x] Verify: `pnpm typecheck` and `pnpm test tests/config.test.ts`.
- [x] **Task 2: Strict LF Protocol Framer**
  - [x] Implement `JsonLineFramer` in `src/pi/framing.ts` with strict `\n` line splitting and `\r` stripping.
  - [x] Ensure Unicode line terminators `\u2028` and `\u2029` inside JSON strings are preserved.
  - [x] Implement outbound JSON command serializer in `src/pi/framing.ts`.
  - [x] Write comprehensive unit tests in `tests/framing.test.ts` covering chunked inputs, multi-lines, empty lines, and Unicode line separators.
  - [x] Verify: `pnpm test tests/framing.test.ts`.

## Checkpoint: Foundation
- [x] All tests in Phase 1 pass cleanly.
- [x] `pnpm typecheck` passes with zero errors.

---

## Phase 2: Pi Subprocess Client & RPC Lifecycle
- [x] **Task 3: Pi RPC Protocol Types & Definitions**
  - [x] Define stdin commands (`prompt`, `abort`, `get_state`) in `src/pi/types.ts`.
  - [x] Define stdout events (`agent_start`, `turn_start`, `message_update`, `toolcall_start`, `toolcall_end`, `turn_end`, `agent_end`, `agent_settled`) in `src/pi/types.ts`.
  - [x] Define image attachment structures and client event emitter contracts.
  - [x] Verify: `pnpm typecheck` and `pnpm test tests/types.test.ts`.
- [x] **Task 4: Pi Subprocess Client**
  - [x] Implement `PiClient` in `src/pi/client.ts` to spawn `pi --mode rpc` in `PI_WORKSPACE_DIR`.
  - [x] Wire stdin/stdout via `JsonLineFramer`.
  - [x] Track state: `isIdle`, `isStreaming`, `currentTool`.
  - [x] Implement prompt submission with automatic `streamingBehavior: "steer"` when busy.
  - [x] Implement `abort()`, `getState()`, and request/response promise tracking.
  - [x] Implement event emissions for tokens, tool execution, and settlement.
  - [x] Implement process lifecycle management and graceful shutdown.
  - [x] Write unit tests in `tests/pi-client.test.ts`.
  - [x] Verify: `pnpm test tests/pi-client.test.ts`.

## Checkpoint: Pi RPC Client
- [x] Subprocess lifecycle and RPC event dispatching verified with tests.
- [x] State transitions between idle and streaming operate reliably.

---

## Phase 3: Telegram Formatting & Stream Throttling
- [x] **Task 5: Dynamic Markdown Tag Balancer & Sanitizer**
  - [x] Implement tag balancer in `src/telegram/markdown.ts` for unclosed code blocks (```` ``` ````), inline code (`` ` ``), bold (`**`), italic (`*`), spoiler (`||`), and strikethrough (`~`).
  - [x] Integrate `telegramify-markdown` for MarkdownV2 formatting.
  - [x] Provide safe plain-text fallback formatting function.
  - [x] Write unit tests in `tests/markdown.test.ts` covering cut-off blocks and unbalanced markdown.
  - [x] Verify: `pnpm test tests/markdown.test.ts`.
- [x] **Task 6: Telegram Stream Throttler & Message Splitter**
  - [x] Implement `StreamThrottler` in `src/telegram/throttler.ts` with 1000ms flush timer.
  - [x] Implement periodic `sendChatAction(chatId, "typing")` every 4000ms.
  - [x] Render transient tool execution badges (e.g. `⚡ Running tool: ...`).
  - [x] Catch `can't parse entities` and fallback to plain unformatted text.
  - [x] Handle 4000-character message boundary by finalizing current message and opening continuation message.
  - [x] Implement `finalize()` to cleanly flush remaining buffer and cancel all timers.
  - [x] Write unit tests in `tests/throttler.test.ts`.
  - [x] Verify: `pnpm test tests/throttler.test.ts`.

## Checkpoint: Streaming & Markdown
- [x] Markdown tag balancer handles cut-off chunks safely.
- [x] Throttler rate limiting, typing action, tool badges, and splitting verified with tests.

---

## Phase 4: Multimodal Input & Bot Handlers
- [x] **Task 7: Telegram Photo & Media Downloader**
  - [x] Implement `downloadPhotoAsBase64` in `src/telegram/media.ts`.
  - [x] Pick highest resolution photo from Telegram photo array.
  - [x] Fetch binary stream and convert to base64 `ImageContent`.
  - [x] Write unit tests in `tests/media.test.ts`.
  - [x] Verify: `pnpm test tests/media.test.ts`.
- [x] **Task 8: grammY Bot Setup, Security Whitelist & Command Handlers**
  - [x] Implement `src/bot.ts` with grammY bot and auto-retry plugin.
  - [x] Implement whitelist middleware checking `ALLOWED_TELEGRAM_USER_IDS`.
  - [x] Implement commands: `/start`, `/help`, `/stop`, `/status`, `/new`.
  - [x] Implement text message router (idle prompt vs in-flight steer).
  - [x] Implement photo message router with image attachment handling.
  - [x] Write unit tests in `tests/bot.test.ts`.
  - [x] Verify: `pnpm test tests/bot.test.ts`.

## Checkpoint: Bot & Media Integration
- [x] Unauthorized users are blocked by whitelist.
- [x] Commands and message routes tested and verified.

---

## Phase 5: Entrypoint, Build & End-to-End Verification
- [x] **Task 9: Application Entry Point & Process Lifecycle**
  - [x] Implement `src/index.ts` connecting config, PiClient, and bot.
  - [x] Ensure workspace and session directories exist on startup.
  - [x] Add signal handlers for `SIGINT` and `SIGTERM` for graceful teardown.
  - [x] Verify: `pnpm typecheck` and `pnpm build`.
- [x] **Task 10: Integration Testing, Build Verification & Documentation Validation**
  - [x] Run full test suite: `pnpm test`.
  - [x] Run typecheck: `pnpm typecheck`.
  - [x] Verify production build: `pnpm build` creates runnable `dist/index.js`.
  - [x] Confirm all commands in `README.md` (`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm test`, `pnpm typecheck`) work properly.

## Checkpoint: Complete
- [x] All tasks completed and checked off.
- [x] 100% test pass rate across all test files.
- [x] Ready for deployment and production use.
