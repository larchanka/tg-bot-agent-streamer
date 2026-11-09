# Implementation Tasks: Telegram Rich Messages Native Support (Bot API 10.1+)

## Phase 1: Rich Text & Markdown Table Foundations

- [x] **Task 1: Rich Message Types & Inline RichText Parser**
  - [x] Define Bot API 10.1+ Rich Message interfaces in `src/telegram/rich-types.ts`
  - [x] Implement inline Markdown parser in `src/telegram/rich-text.ts` (bold, italic, code, strikethrough, spoiler, underline, links, math expressions)
  - [x] Write unit tests in `tests/rich-text.test.ts` covering all inline styles, nested combinations, and unclosed tags
  - [x] Verify: `pnpm vitest run tests/rich-text.test.ts` and `pnpm typecheck`

- [x] **Task 2: GFM Markdown Table Parser & Converter**
  - [x] Implement `src/telegram/rich-table.ts` to parse GFM tables into native `InputRichBlockTable`
  - [x] Map column delimiters (`:---`, `:---:`, `---:`) to `align: "left" | "center" | "right"`
  - [x] Tag header cells with `is_header: true` and configure table styling (`is_bordered`, `is_striped`, `is_compact`)
  - [x] Handle messy table formatting (missing outer pipes, ragged rows, empty cells)
  - [x] Write unit tests in `tests/rich-table.test.ts` verifying table parsing edge cases
  - [x] Verify: `pnpm vitest run tests/rich-table.test.ts` and `pnpm typecheck`

- [x] **Checkpoint: Foundation**
  - [x] Verify all tests pass and types check clean

## Phase 2: Comprehensive Block Parser

- [x] **Task 3: Full Markdown to InputRichMessage Block Parser**
  - [x] Implement `src/telegram/rich-parser.ts` to convert Markdown to `InputRichMessage` (`blocks: InputRichBlock[]`)
  - [x] Support headings (`#`..`######`) -> `InputRichBlockSectionHeading`
  - [x] Support code blocks (```` ```lang ````) -> `InputRichBlockPreformatted`
  - [x] Integrate GFM tables via `src/telegram/rich-table.ts` -> `InputRichBlockTable`
  - [x] Support lists (ordered, unordered, checkboxes `[ ]`/`[x]`) -> `InputRichBlockList`
  - [x] Support blockquotes (`>`) -> `InputRichBlockBlockQuotation`
  - [x] Support expandable details (`<details><summary>...</summary>...</details>`) -> `InputRichBlockDetails`
  - [x] Support AI thinking indicator (`<thinking>...</thinking>` / `<tg-thinking>`) -> `InputRichBlockThinking`
  - [x] Support paragraphs -> `InputRichBlockParagraph`
  - [x] Write unit tests in `tests/rich-parser.test.ts` covering mixed blocks and streaming edge cases
  - [x] Verify: `pnpm vitest run tests/rich-parser.test.ts` and `pnpm typecheck`

- [x] **Checkpoint: Block Parsing Complete**
  - [x] Verify full document parsing across all block types with zero type errors

## Phase 3: Bot Streaming, Drafts & Resilient Fallback

- [x] **Task 4: StreamThrottler Rich Message & Draft Streaming Integration**
  - [x] Extend `TelegramApiLike` in `src/telegram/throttler.ts` with optional `sendRichMessage` and `sendRichMessageDraft`
  - [x] Add `enableRichMessages` option to `StreamThrottler` (default: `true`)
  - [x] Implement intermediate draft streaming using `sendRichMessageDraft` and unique `draft_id`
  - [x] Inject `InputRichBlockThinking` block when `currentToolStatus` is active
  - [x] Finalize stream with `sendRichMessage`
  - [x] Implement automatic two-tier fallback to classic `sendMessage` / `editMessageText` on failure
  - [x] Write unit tests in `tests/throttler.test.ts` covering rich drafting, thinking blocks, and fallback
  - [x] Verify: `pnpm vitest run tests/throttler.test.ts` and `pnpm typecheck`

- [x] **Task 5: Bot Configuration & Wiring**
  - [x] Add `ENABLE_RICH_MESSAGES` toggle to `src/config.ts` (default: `true`)
  - [x] Configure `src/bot.ts` to pass rich message capability to `StreamThrottler`
  - [x] Write unit tests in `tests/config.test.ts` and `tests/bot.test.ts`
  - [x] Verify: `pnpm vitest run tests/config.test.ts tests/bot.test.ts` and `pnpm typecheck`

- [x] **Checkpoint: Streaming & Bot Integrated**
  - [x] Verify live token streaming with rich draft updates, tool thinking indicator, and fallback

## Phase 4: Full System Verification & Context Maintenance

- [x] **Task 6: End-to-End Integration Tests & Context Graph Maintenance**
  - [x] Update `tests/integration.test.ts` to test end-to-end token streaming with rich messages, tables, and thinking blocks
  - [x] Run full test suite: `pnpm test`
  - [x] Run type check: `pnpm typecheck`
  - [x] Run build: `pnpm build`
  - [x] Rescan AST and update symbol graphs and context documentation (`context/modules.md`, `context/signatures.md`, `context/dependencies.md`, `context/architecture.md`)
  - [x] Verify context integrity with `verify_context.py`

- [x] **Checkpoint: Final Review & Acceptance**
  - [x] All tasks completed and verified
  - [x] Codebase clean and ready for production
