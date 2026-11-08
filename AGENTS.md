# Agent Guidelines for tg-bot-agent-streamer

This repository contains a Telegram Bot bridge that connects users to the `pi` AI coding agent running in bidirectional RPC mode (`pi --mode rpc`), providing real-time streaming, rich markdown rendering, tool call status tracking, and multimodal support.

---

## 1. System Architecture & Tech Stack

- **Runtime**: Node.js $\ge$ 20 / TypeScript 5+ (ESM, NodeNext).
- **Package Manager**: `pnpm`.
- **Telegram Bot Framework**: `grammY` (`@grammyjs/auto-retry`, `@grammyjs/stream`).
- **Agent Subprocess**: `pi` CLI (`@earendil-works/pi-coding-agent`), executed via `node:child_process` with strict JSONL LF framing.
- **Markdown Processing**: `telegramify-markdown` with intermediate tag balancing for streaming chunks.

---

## 2. Directory Structure

```
tg-bot-agent-streamer/
├── src/
│   ├── index.ts               # Entry point (bootstrapping, signal handling)
│   ├── config.ts              # Strongly-typed environment configuration
│   ├── bot.ts                 # grammY bot setup, auth guard, and handlers
│   ├── pi/
│   │   ├── client.ts          # Subprocess manager for `pi --mode rpc`
│   │   ├── framing.ts         # Strict LF-based JSONL parser and serializer
│   │   └── types.ts           # Protocol types (commands, events, messages)
│   └── telegram/
│       ├── throttler.ts       # Message streaming throttler (1s buffer, 4096-char split)
│       ├── markdown.ts        # Tag balancer & Telegram-safe markdown converter
│       └── media.ts           # Telegram photo downloader & base64 converter
├── docs/                      # Technical documentation
│   ├── architecture.md        # System design, data flow, sequence diagrams
│   ├── pi-rpc-integration.md  # Detailed Pi RPC protocol specs & events
│   ├── telegram-streaming.md  # Throttling, partial markdown, rate limit handling
│   └── configuration.md       # Setup, environment variables, deployment
├── tests/                     # Unit and integration tests
├── AGENTS.md                  # This file (agent instructions)
├── README.md                  # Human-facing documentation
├── package.json
└── tsconfig.json
```

---

## 3. Critical Protocol Rules for Pi RPC

1. **Strict LF Framing**:
   - The JSONL protocol requires records to be terminated strictly by LF (`\n`).
   - Do **NOT** use `readline` module from Node.js directly for splitting protocol lines, because `readline` treats Unicode line/paragraph separators (`U+2028`, `U+2029`) as record boundaries, which breaks JSON strings.
   - Use the custom byte/string buffer in `src/pi/framing.ts` that splits exclusively on `\n`.
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

## 4. Telegram Streaming Constraints

1. **Rate Limiting**: Telegram allows at most $\sim 1$ edit per second per chat. Intermediate edits in `src/telegram/throttler.ts` must be throttled to $\ge 1000\text{ms}$.
2. **Partial Markdown Balancing**: Unclosed markdown tags (` ``` `, `*`, `_`, `||`) cause `Bad Request: can't parse entities`. Always run text through `src/telegram/markdown.ts` before sending to Telegram with `parse_mode: "MarkdownV2"`.
3. **Fallback Mechanism**: If Telegram rejects an intermediate edit due to entity parsing, immediately retry as plain unformatted text to preserve streaming continuity.
4. **Message Length Limit**: Telegram restricts messages to 4096 UTF-8 characters. When buffer exceeds 4000 characters, finalize the current message and spawn a continuation message.

---

## 5. Development & Testing Conventions

- **Run Dev**: `pnpm dev` (uses `tsx watch src/index.ts`).
- **Typecheck**: `pnpm typecheck` (`tsc --noEmit`).
- **Test**: `pnpm test` (unit tests for framing, markdown tag balancing, and throttler).
- When modifying existing code, make surgical changes without touching unrelated styles or comments.
