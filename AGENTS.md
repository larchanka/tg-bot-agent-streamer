# Agent Instructions & Codebase Guidelines

Welcome to **tg-bot-agent-streamer**. This file provides essential guidelines, architecture overview, verified commands, and operating constraints for AI agents and automated tools working in this repository.

---

## 1. Project Overview
- **Repository Purpose**: Telegram Bot bridge that connects users to the `pi` AI coding agent running in bidirectional RPC mode (`pi --mode rpc`), providing real-time token streaming, rich markdown rendering, tool call status tracking, and multimodal support.
- **Core Languages & Frameworks**: TypeScript 5+, Node.js (ESM / NodeNext), `grammY` Telegram Bot Framework, `telegramify-markdown`, Zod.
- **Primary Runtime / Environment**: Node.js $\ge$ 20, `pnpm`, `@earendil-works/pi-coding-agent`.

---

## 2. Essential Commands & Workflow

> [!IMPORTANT]
> Run all commands from the repository root using `pnpm`.

### Setup & Build
```bash
# Install dependencies
pnpm install

# Build / Compile TypeScript to dist/
pnpm build

# Run in development mode with live watch
pnpm dev
```

### Testing & Verification
```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run a single test file
pnpm vitest run tests/framing.test.ts

# Type checking without emit
pnpm typecheck
```

---

## 3. Architecture & Context Navigation

For in-depth architectural details, refer to the documentation in the [`context/`](./context/) directory:

- [**context/index.md**](./context/index.md): Documentation map and quick index.
- [**context/architecture.md**](./context/architecture.md): High-level system design, subsystem relationships, and data flows.
- [**context/modules.md**](./context/modules.md): Complete module catalog with public interfaces and responsibilities.
- [**context/signatures.md**](./context/signatures.md): Searchable index of all function signatures, parameters, and return types.
- [**context/dependencies.md**](./context/dependencies.md): Internal call graphs and third-party dependencies.
- [**context/conventions.md**](./context/conventions.md): Code style, error handling patterns, and test standards.

### Key Entry Points & Hub Modules
| Component / File | Role | Type |
| :--- | :--- | :--- |
| [`src/index.ts`](./src/index.ts) | Application entrypoint, signal handling, process lifecycle | Entrypoint |
| [`src/bot.ts`](./src/bot.ts) | GrammY bot router, auth middleware, command handlers | Presentation Hub |
| [`src/pi/client.ts`](./src/pi/client.ts) | Subprocess manager for `pi --mode rpc` | Core Hub |
| [`src/pi/framing.ts`](./src/pi/framing.ts) | Strict LF JSONL protocol stream parser and serializer | Core Hub |
| [`src/pi/types.ts`](./src/pi/types.ts) | Protocol schemas, commands, and event types | Types Hub |
| [`src/telegram/throttler.ts`](./src/telegram/throttler.ts) | Message streaming throttler ($\ge 1000\text{ms}$) and message splitter | Core Hub |
| [`src/telegram/markdown.ts`](./src/telegram/markdown.ts) | Partial markdown tag balancer and Telegram MarkdownV2 formatter | Utility Hub |
| [`src/telegram/media.ts`](./src/telegram/media.ts) | Telegram photo downloader and base64 converter | Utility Hub |

---

## 4. Critical Protocol Rules for Pi RPC

1. **Strict LF Framing**:
   - The JSONL protocol requires records to be terminated strictly by LF (`\n`).
   - Do **NOT** use `readline` module from Node.js directly for splitting protocol lines, because `readline` treats Unicode line/paragraph separators (`U+2028`, `U+2029`) as record boundaries, which breaks JSON strings.
   - Use the custom byte/string buffer in [`src/pi/framing.ts`](./src/pi/framing.ts) that splits exclusively on `\n`.
2. **Streaming & In-Flight Control**:
   - When Pi is idle: send `{"id": "...", "type": "prompt", "message": text}`.
   - When Pi is actively streaming: prompts must include `"streamingBehavior": "steer"` to steer the active execution after the current tool step, or be queued with `"followUp"`.
   - Aborting: send `{"id": "...", "type": "abort"}` to immediately halt active LLM / tool execution.
3. **Event Stream Lifecycle**:
   - `agent_start` $\to$ low-level run starts.
   - `turn_start` $\to$ assistant turn begins.
   - `message_start` / `message_update` (`text_delta`) $\to$ live streaming tokens.
   - `toolcall_start` / `toolcall_end` $\to$ tool invocations (`bash`, `read`, etc.).
   - `turn_end` $\to$ assistant turn finishes.
   - `agent_end` $\to$ turn cycle ends; may retry or continue.
   - `agent_settled` $\to$ run has completely settled. Finalize all streaming messages.

---

## 5. Telegram Streaming Constraints

1. **Rate Limiting**: Telegram allows at most $\sim 1$ edit per second per chat. Intermediate edits in [`src/telegram/throttler.ts`](./src/telegram/throttler.ts) must be throttled to $\ge 1000\text{ms}$.
2. **Partial Markdown Balancing**: Unclosed markdown tags (` ``` `, `*`, `_`, `||`) cause `Bad Request: can't parse entities`. Always run text through [`src/telegram/markdown.ts`](./src/telegram/markdown.ts) before sending to Telegram with `parse_mode: "MarkdownV2"`.
3. **Fallback Mechanism**: If Telegram rejects an intermediate edit due to entity parsing, immediately retry as plain unformatted text to preserve streaming continuity.
4. **Message Length Limit**: Telegram restricts messages to 4096 UTF-8 characters. When buffer exceeds 4000 characters, finalize the current message and spawn a continuation message.

---

## 6. Agent Rules & Operational Constraints

Follow these rules on every task:

1. **Surgical Changes**: Touch only files necessary for the requested feature or fix. Do not reformat adjacent unrelated code or delete pre-existing dead code.
2. **Never Break Type Checks or Tests**: Always verify with `pnpm test` and `pnpm typecheck` before completing a task.
3. **Preserve Existing Patterns**:
   - All TypeScript imports in this repository use `.js` extension (NodeNext resolution).
   - Follow error handling conventions described in [context/conventions.md](./context/conventions.md).
   - Use existing helpers and abstractions rather than introducing duplicate utilities.
4. **No Speculative Abstractions**: Solve only the immediate problem. Do not add unused configuration or premature abstractions.

---

## 7. Automatic Context & Graph Maintenance (Post-Change Instruction)

> [!IMPORTANT]
> **Always Keep Context & Symbol Graphs In Sync**:
> If any code was created, modified, or deleted during your task, you MUST refresh the symbol graph and context artifacts.

Run the following update sequence:

```bash
# 1. Rescan AST and update symbol/call graphs
python3 /Users/mikhaillarchanka/.gemini/config/skills/codebase-context-generator/scripts/ast_scanner.py --root .
python3 /Users/mikhaillarchanka/.gemini/config/skills/codebase-context-generator/scripts/dependency_graph.py --manifest .context_cache/ast_manifest.json
python3 /Users/mikhaillarchanka/.gemini/config/skills/codebase-context-generator/scripts/symbol_graph.py \
  --manifest .context_cache/ast_manifest.json \
  --save-graph .context_cache/symbol_graph.json \
  --export-signatures context/signatures.md

# 2. Update context documentation if public APIs, modules, or architecture changed:
#    - If new modules were added: update context/modules.md
#    - If architecture/data flow changed: update context/architecture.md
#    - If new dependencies were introduced: update context/dependencies.md

# 3. Verify documentation integrity
python3 /Users/mikhaillarchanka/.gemini/config/skills/codebase-context-generator/scripts/verify_context.py --root .
```
