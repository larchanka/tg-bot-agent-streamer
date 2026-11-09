# Implementation Plan: Telegram Rich Messages Native Support (Bot API 10.1+)

## Overview

Implement native Telegram Rich Messages (introduced in Telegram Bot API 10.1+) in `tg-bot-agent-streamer`. This enhances the bot from sending flat MarkdownV2 strings to constructing and streaming native `InputRichMessage` objects with structured block elements. Key capabilities include parsing standard GitHub Flavored Markdown (GFM) tables into native `InputRichBlockTable` blocks (with header flags, alignments, border and compact styles), native headings, preformatted code blocks, lists (ordered, unordered, and checkboxes), blockquotes, expandable blockquotes / `<details>`, and AI thinking indicators (`InputRichBlockThinking`) during real-time streaming via `sendRichMessageDraft`. A robust, automatic fallback ensures seamless degradation to classic MarkdownV2 / plain text if Telegram clients or chats do not support Rich Messages.

---

## Architecture Decisions

1. **Dedicated Modular Parsing Pipeline (`rich-text` -> `rich-table` -> `rich-parser`)**:
   - *Rationale*: Decoupling inline text parsing (`RichText`) from table parsing (`InputRichBlockTable`) and the top-level block orchestrator (`InputRichMessage`) ensures clear separation of concerns, testability in isolation, and zero regression on existing flat markdown utilities (`src/telegram/markdown.ts`).
2. **Native Table AST Generation with Format Alignment**:
   - *Rationale*: Markdown tables are converted into Telegram Bot API 10.1+ `InputRichBlockTable` structures containing a 2D matrix of `RichBlockTableCell[][]`. Alignment indicators (`:---`, `:---:`, `---:`) map directly to `align: "left" | "center" | "right"`, first rows are marked with `is_header: true`, and tables default to clean native styling (`is_bordered: true`, `is_striped: true`, `is_compact: true`).
3. **Draft Streaming with AI Thinking Indicators (`sendRichMessageDraft`)**:
   - *Rationale*: Telegram Bot API 10.1+ provides `sendRichMessageDraft` for streaming ephemeral drafts (previewed in private chats). Active tool calls (e.g. running bash commands or file lookups) are represented natively as `InputRichBlockThinking` blocks at the top or bottom of the message draft, providing visual status indicators.
4. **Resilient Two-Tier Fallback Mechanism**:
   - *Rationale*: If `sendRichMessageDraft` or `sendRichMessage` fails (e.g. group chat, older Telegram client, or API rejecting rich payload), the throttler transparently catches the error and degrades to standard `sendMessage` / `editMessageText` with balanced MarkdownV2 or stripped plain text.
5. **Preserving NodeNext ESM and Strict Types**:
   - *Rationale*: All new modules use TypeScript strict typings matching `@grammyjs/types` Rich Message definitions (`InputRichMessage`, `InputRichBlock`, `RichText`), with strict `.js` import specifiers adhering to NodeNext conventions.

---

## Dependency Graph

```
src/telegram/rich-types.ts (Rich Message & Block Type Definitions)
       │
       ├── src/telegram/rich-text.ts (Inline Markdown -> RichText AST Parser)
       │         │
       │         ├── src/telegram/rich-table.ts (GFM Table -> InputRichBlockTable Converter)
       │         │         │
       │         └─────────┴── src/telegram/rich-parser.ts (Markdown -> InputRichMessage Orchestrator)
       │                                 │
       └─────────────────────────────────┼──────────────────────────────┐
                                         │                              │
                            src/telegram/throttler.ts                   │
                       (sendRichMessageDraft & fallback)                │
                                         │                              │
                                    src/bot.ts ◄────────────────────────┘
                            (Session wiring & AI Thinking)
```

---

## Task List

### Phase 1: Rich Text & Markdown Table Foundations

#### Task 1: Rich Message Types & Inline RichText Parser
**Description:** Define Telegram Bot API 10.1+ Rich Message interfaces in `src/telegram/rich-types.ts` (re-exporting / supplementing `@grammyjs/types`) and implement `src/telegram/rich-text.ts` to parse inline Markdown (bold, italic, code, strikethrough, spoiler, underline, links, math expressions) into structured `RichText` objects.

**Acceptance criteria:**
- [ ] `src/telegram/rich-types.ts` exports complete interfaces for `RichText`, `RichTextBold`, `RichTextItalic`, `RichTextCode`, `RichTextSpoiler`, `RichTextStrikethrough`, `RichTextUnderline`, `RichTextUrl`, `RichTextMathematicalExpression`, `RichBlockTableCell`, `InputRichBlockTable`, and all `InputRichBlock` variants.
- [ ] `parseRichText(text: string): RichText` correctly parses plain strings, single inline styles, and nested styles (e.g. `**bold _italic_**`).
- [ ] Properly handles unclosed inline tags in streaming chunks without throwing syntax errors.
- [ ] Unit tests in `tests/rich-text.test.ts` cover all inline formatting styles, edge cases, nested formats, and empty strings.

**Verification:**
- [ ] Tests pass: `pnpm vitest run tests/rich-text.test.ts`
- [ ] Type check succeeds: `pnpm typecheck`

**Dependencies:** None
**Files likely touched:**
- `src/telegram/rich-types.ts`
- `src/telegram/rich-text.ts`
- `tests/rich-text.test.ts`
**Estimated scope:** Medium (3 files)

---

#### Task 2: GFM Markdown Table Parser & Converter
**Description:** Implement `src/telegram/rich-table.ts` to parse standard GitHub Flavored Markdown tables (e.g. `| col1 | col2 |`) into Telegram's native `InputRichBlockTable`. Detect header rows (`is_header: true`), cell content alignments (`align: "left" | "center" | "right"`), and apply configurable table styling flags (`is_bordered`, `is_striped`, `is_compact`).

**Acceptance criteria:**
- [x] `isMarkdownTable(text: string): boolean` accurately detects valid GFM table blocks.
- [x] `parseMarkdownTable(tableMarkdown: string, options?: TableOptions): InputRichBlockTable` parses headers, delimiter alignment row, and data rows into `RichBlockTableCell[][]`.
- [x] Col alignments `:---`, `:---:`, and `---:` are mapped to `"left"`, `"center"`, and `"right"`. Default alignment is `"left"`.
- [x] Header row cells are marked with `is_header: true`.
- [x] Table options `is_bordered`, `is_striped`, and `is_compact` default to `true`.
- [x] Handles messy markdown tables: irregular spacing, missing outer pipes, escaped pipes `\|`, and empty cells.
- [x] Unit tests in `tests/rich-table.test.ts` verify all table variants, alignment combinations, and edge cases.

**Verification:**
- [x] Tests pass: `pnpm vitest run tests/rich-table.test.ts`
- [x] Type check succeeds: `pnpm typecheck`

**Dependencies:** Task 1
**Files likely touched:**
- `src/telegram/rich-table.ts`
- `tests/rich-table.test.ts`
**Estimated scope:** Small (2 files)

---

### Checkpoint: Foundation
- [x] Inline RichText parser passes all unit tests with full formatting support.
- [x] GFM table parser converts complex tables to `InputRichBlockTable` cleanly.
- [x] `pnpm typecheck` passes with zero errors.

---

### Phase 2: Comprehensive Block Parser

#### Task 3: Full Markdown to InputRichMessage Block Parser
**Description:** Implement `src/telegram/rich-parser.ts` to convert complete Markdown documents into native `InputRichMessage` (`{ blocks: InputRichBlock[] }`). Support paragraphs, headings (`#`..`######`), preformatted code blocks (```` ```lang ````), lists (ordered, unordered, and task lists with checkboxes), blockquotes (`>`), expandable blockquotes / details (`<details>`, `<blockquote expandable>`), and AI thinking indicators (`<thinking>` or `<tg-thinking>`).

**Acceptance criteria:**
- [ ] `parseMarkdownToRichMessage(markdown: string): InputRichMessage` returns valid `{ blocks: InputRichBlock[] }`.
- [ ] Headings (`# Heading`) are parsed into `InputRichBlockSectionHeading` with corresponding `size` (1 to 6).
- [ ] Code blocks (```` ```python ... ``` ````) are parsed into `InputRichBlockPreformatted` with `language` and preformatted content.
- [ ] Tables are parsed into `InputRichBlockTable` via `rich-table.ts`.
- [ ] Unordered and ordered lists are parsed into `InputRichBlockList` with `InputRichBlockListItem[]`. Task lists (`- [ ]`, `- [x]`) include `has_checkbox` and `is_checked`.
- [ ] Standard blockquotes (`> text`) produce `InputRichBlockBlockQuotation`.
- [ ] Expandable details (`<details><summary>Title</summary>Content</details>`) produce `InputRichBlockDetails` with `summary` and inner `blocks`.
- [ ] Thinking tags (`<thinking>...</thinking>`) produce `InputRichBlockThinking`.
- [ ] Normal text blocks produce `InputRichBlockParagraph`.
- [ ] Consecutive/mixed markdown structures are cleanly split into discrete blocks without dropping content.
- [ ] Unit tests in `tests/rich-parser.test.ts` cover all block types, mixed documents, and partial/streaming content.

**Verification:**
- [ ] Tests pass: `pnpm vitest run tests/rich-parser.test.ts`
- [ ] Type check succeeds: `pnpm typecheck`

**Dependencies:** Task 1, Task 2
**Files likely touched:**
- `src/telegram/rich-parser.ts`
- `tests/rich-parser.test.ts`
**Estimated scope:** Medium (2 files)

---

### Checkpoint: Block Parsing Complete
- [ ] All required block types parse cleanly into native `InputRichBlock` structures.
- [ ] GFM tables, headings, code blocks, lists, details, and thinking blocks verified with unit tests.
- [ ] `pnpm typecheck` passes with zero errors.

---

### Phase 3: Bot Streaming, Drafts & Resilient Fallback

#### Task 4: StreamThrottler Rich Message & Draft Streaming Integration
**Description:** Upgrade `src/telegram/throttler.ts` to support Telegram Bot API 10.1+ Rich Messages. When rich messages are enabled and available on `TelegramApiLike`, stream intermediate tokens using `sendRichMessageDraft`, inject `InputRichBlockThinking` when a tool is executing, finalize with `sendRichMessage`, and provide a robust fallback to classic `sendMessage` / `editMessageText` on any failure.

**Acceptance criteria:**
- [x] `TelegramApiLike` interface extended with optional `sendRichMessage` and `sendRichMessageDraft`.
- [x] `StreamThrottlerOptions` accepts `enableRichMessages?: boolean` (defaults to `true`).
- [x] During streaming, throttler calls `sendRichMessageDraft` with generated `draft_id` and parsed `InputRichMessage`.
- [x] If `currentToolStatus` is present, throttler appends an `InputRichBlockThinking` block (`⚙️ Running: ${toolName}...`).
- [x] On `finalize()`, throttler persists the completed response via `sendRichMessage`.
- [x] If `sendRichMessageDraft` or `sendRichMessage` fails (e.g. not supported in chat type, client error, network issue), throttler automatically and permanently falls back to classic `sendMessage` / `editMessageText` for that session.
- [x] Unit tests in `tests/throttler.test.ts` verify rich message drafting, thinking block insertion, finalization, and fallback paths.

**Verification:**
- [x] Tests pass: `pnpm vitest run tests/throttler.test.ts`
- [x] Type check succeeds: `pnpm typecheck`

**Dependencies:** Task 3
**Files likely touched:**
- `src/telegram/throttler.ts`
- `tests/throttler.test.ts`
**Estimated scope:** Medium (2 files)

---

#### Task 5: Bot Configuration & Wiring
**Description:** Wire Rich Messages support into `src/config.ts` (optional configuration toggle `ENABLE_RICH_MESSAGES`) and `src/bot.ts` (pass rich message capabilities to `StreamThrottler` and handle session lifecycles).

**Acceptance criteria:**
- [ ] `src/config.ts` includes `enableRichMessages: boolean` (defaulting to `true`, configurable via `ENABLE_RICH_MESSAGES`).
- [ ] `src/bot.ts` configures `StreamThrottler` with `enableRichMessages` from config.
- [ ] Unit tests in `tests/config.test.ts` and `tests/bot.test.ts` verify configuration parsing and bot session attachment with rich messages enabled/disabled.

**Verification:**
- [ ] Tests pass: `pnpm vitest run tests/config.test.ts tests/bot.test.ts`
- [ ] Type check succeeds: `pnpm typecheck`

**Dependencies:** Task 4
**Files likely touched:**
- `src/config.ts`
- `src/bot.ts`
- `tests/config.test.ts`
- `tests/bot.test.ts`
**Estimated scope:** Small (4 files)

---

### Checkpoint: Streaming & Bot Integrated
- [ ] Throttler streams rich drafts and finalizes via `sendRichMessage`.
- [ ] AI thinking indicator is injected during active tool execution.
- [ ] Graceful fallback to classic text messages on error is fully verified.
- [ ] All unit tests pass.

---

### Phase 4: Full System Verification & Context Maintenance

#### Task 6: End-to-End Integration Tests & Context Graph Maintenance
**Description:** Update `tests/integration.test.ts` to test end-to-end flow with markdown tables, code blocks, and AI thinking streaming to Rich Messages. Re-generate AST symbols, dependency graphs, and update context documentation per repository AGENTS.md instructions.

**Acceptance criteria:**
- [x] `tests/integration.test.ts` validates end-to-end token streaming with rich messages, table rendering, thinking blocks, and fallback.
- [x] Full test suite passes: `pnpm test`.
- [x] Type checking passes with no errors: `pnpm typecheck`.
- [x] Build succeeds: `pnpm build`.
- [x] Context documentation updated (`context/modules.md`, `context/signatures.md`, `context/dependencies.md`, `context/architecture.md`).
- [x] AST and dependency verification scripts run cleanly.

**Verification:**
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `python3 /Users/mikhaillarchanka/.gemini/config/skills/codebase-context-generator/scripts/verify_context.py --root .`

**Dependencies:** Tasks 1-5
**Files likely touched:**
- `tests/integration.test.ts`
- `context/modules.md`
- `context/signatures.md`
- `context/dependencies.md`
- `context/architecture.md`
**Estimated scope:** Medium (5 files)

---

## Checkpoint: Final Review & Acceptance
- [x] All 6 tasks implemented and verified test-first.
- [x] Native Telegram Rich Messages (Bot API 10.1+) fully functional with tables, blocks, and thinking indicators.
- [x] Fallback mechanism guarantees backward compatibility.
- [x] All test suites green, zero type errors.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Telegram API server or client version lacks Bot API 10.1+ Rich Message support | High | Throttler detects 400 Bad Request or missing method error and automatically falls back to MarkdownV2/plain text `sendMessage` / `editMessageText`. |
| Complex/malformed markdown tables cause parser crash | Med | Tolerant parser in `rich-table.ts` normalizes ragged rows, strips unescaped pipes, and defaults missing cells to empty text without throwing. |
| Incomplete streaming chunks break AST or block parsing | Med | Incremental block parser handles open code fences, open `<details>`, and trailing partial blocks safely. |
| `sendRichMessageDraft` rate limiting or private chat restriction | Low | Draft streaming runs inside the existing $\ge 1000\text{ms}$ throttler and gracefully degrades if chat is not private or draft is rejected. |

---

## Open Questions

- None. GrammY 1.46.0 and `@grammyjs/types` 5.0.0 installed in the project already define the full Bot API 10.1+ schema (`sendRichMessage`, `sendRichMessageDraft`, `InputRichMessage`, `InputRichBlockTable`, `InputRichBlockThinking`).
