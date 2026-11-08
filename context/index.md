# Codebase Context & Navigation

Welcome to the **tg-bot-agent-streamer** codebase context repository. This directory provides structured technical documentation detailing system architecture, module interfaces, runtime dependencies, and engineering conventions.

## Navigation Map

1. [**System Architecture**](./architecture.md) — System design, sequence flows, subsystem layers, and request-response lifecycle.
2. [**Module Catalog**](./modules.md) — Directory-by-directory and module-by-module breakdown of classes, functions, interfaces, and test suites.
3. [**Signatures & Symbol Index**](./signatures.md) — Full function and method signatures, argument types, return types, and callers extracted via AST scanning.
4. [**Dependencies & Integrations**](./dependencies.md) — Internal call graph, core hubs, third-party libraries, and external environment requirements.
5. [**Engineering Conventions**](./conventions.md) — Invariants, error handling, partial markdown balancing, Telegram rate limiting, and testing strategy.

## Quick Facts

- **Repository Purpose**: Telegram Bot bridge for the `pi` AI coding agent running in bidirectional RPC mode (`pi --mode rpc`), featuring real-time token streaming, markdown entity balancing, tool call status tracking, and multimodal photo input.
- **Total Source Files**: 20 files (10 production modules in `src/`, 10 test suites in `tests/`).
- **Total Lines of Code**: ~6,634 lines.
- **Primary Runtime**: Node.js $\ge$ 20 (ESM / NodeNext), TypeScript 5+.
- **Package Manager**: `pnpm`.
- **Primary Entrypoint**: [`src/index.ts`](../src/index.ts).
- **Core Hub Modules**:
  - [`src/config.ts`](../src/config.ts): Strongly-typed configuration with Zod.
  - [`src/pi/client.ts`](../src/pi/client.ts): Subprocess lifecycle manager for `pi --mode rpc`.
  - [`src/pi/framing.ts`](../src/pi/framing.ts): Strict LF (`\n`) JSONL stream framer and serializer.
  - [`src/pi/types.ts`](../src/pi/types.ts): Pi RPC protocol schemas and event types.
  - [`src/bot.ts`](../src/bot.ts): GrammY bot instance, auth guards, and event listeners.
  - [`src/telegram/throttler.ts`](../src/telegram/throttler.ts): 1000ms message editing throttler and length splitter.
  - [`src/telegram/markdown.ts`](../src/telegram/markdown.ts): Partial markdown tag balancer and Telegram MarkdownV2 renderer.
  - [`src/telegram/media.ts`](../src/telegram/media.ts): Telegram photo downloader and base64 encoder.
