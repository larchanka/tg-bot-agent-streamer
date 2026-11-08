# System Architecture & Design

This document details the architectural components, process boundaries, data flows, and state machines of the `tg-bot-agent-streamer` bridge.

---

## 1. High-Level Architecture

The bridge acts as a stateful adapter between the Telegram Bot API and a long-lived `pi` child process running in RPC mode:

```mermaid
flowchart TD
    subgraph Telegram["Telegram Platform"]
        TGUser["Authorized User"]
        TGApi["Telegram Bot API"]
    end

    subgraph Service["tg-bot-agent-streamer (Node.js/TypeScript)"]
        Auth["Whitelist Guard Middleware"]
        Router["grammY Command & Message Router"]
        
        subgraph TelegramSubsystem["Telegram Subsystem"]
            Media["Media Converter\n(Photo to Base64)"]
            Throttler["Stream Throttler\n(1s edits, 4096-char splitter)"]
            MarkdownEngine["Markdown Sanitizer\n& Tag Balancer"]
        end

        subgraph PiSubsystem["Pi RPC Subsystem"]
            PiClient["Pi Subprocess Manager"]
            Framing["Strict LF Line Framer"]
        end
    end

    subgraph Subprocess["Pi AI Agent Process"]
        PiRPC["pi --mode rpc"]
        Workspace[("Project Workspace")]
    end

    TGUser <-->|Messages / Photos / Commands| TGApi
    TGApi <-->|Long Polling Updates| Router
    Router --> Auth
    Auth -->|Allowed| Media
    Auth -->|Allowed| PiClient
    
    Media -->|Base64 ImageContent| PiClient
    
    PiClient -->|JSONL stdin| Framing
    Framing -->|Buffered Pipe| PiRPC
    PiRPC --> Workspace

    PiRPC -->|JSONL stdout| Framing
    Framing -->|Parsed Events| PiClient
    
    PiClient -->|text_delta / tool_call / settled| Throttler
    Throttler --> MarkdownEngine
    MarkdownEngine -->|Safe MarkdownV2 / plain text| TGApi
```

---

## 2. Core Components

### 2.1 Whitelist Middleware (`src/bot.ts`)
- Intercepts all incoming updates from Telegram before any handler runs.
- Checks `ctx.from?.id` against the parsed numeric set of `ALLOWED_TELEGRAM_USER_IDS`.
- Drops or replies with an unauthorized notification to unknown users, ensuring that only trusted users can trigger tool executions on the host.

### 2.2 Pi RPC Client (`src/pi/client.ts`)
- Spawns and supervises `pi --mode rpc` with designated flags (`--session-dir`, `--model`, etc.).
- Keeps track of execution state:
  - `isIdle`: Ready for new prompt.
  - `isStreaming`: Agent is actively reasoning, calling tools, or generating output.
  - `currentTool`: Name and arguments of any active tool execution.
- Maps command IDs to promises for request/response synchronization.
- Emits high-level typed events to consumers.

### 2.3 Strict LF Line Framer (`src/pi/framing.ts`)
- Manages raw byte streams over stdin/stdout.
- Emits records strictly on `\n` line delimiters.
- Strips optional `\r`.
- Ensures zero corruption from embedded Unicode line separators (`U+2028`, `U+2029`).

### 2.4 Stream Throttler (`src/telegram/throttler.ts`)
- Bridges continuous token events from LLM streams to Telegram's discrete edit rate limits.
- Holds an internal buffer of tokens.
- Flushes updates to Telegram via `editMessageText` at most once every $1000\text{ms}$.
- Periodically triggers `sendChatAction(chatId, "typing")` every 4 seconds.
- Automatically handles the 4096-character limit by finalizing the current message and sending a new message chunk.

### 2.5 Markdown Engine (`src/telegram/markdown.ts`)
- Handles unclosed tags (` ``` `, `*`, `_`, `||`) in streaming buffers using dynamic tag balancing.
- Converts Markdown to Telegram-safe MarkdownV2 using `telegramify-markdown`.
- Provides an automated fallback to plain text if Telegram rejects the formatted payload.

---

## 3. Communication & Turn Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as Telegram User
    participant Bot as grammY Bot
    participant Throttler as Stream Throttler
    participant Pi as Pi Subprocess (RPC)

    User->>Bot: Send prompt "Run git status"
    Bot->>Throttler: Initialize message (send "Thinking...")
    Bot->>Pi: stdin: {"id":"1","type":"prompt","message":"Run git status"}
    Pi-->>Bot: stdout: {"type":"response","command":"prompt","success":true}
    
    Pi-->>Bot: stdout: {"type":"agent_start"}
    Pi-->>Bot: stdout: {"type":"toolcall_start","toolName":"bash"}
    Bot->>Throttler: Update status "⚡ Running tool: bash..."
    Throttler->>User: editMessageText("⚡ Running tool: bash...")

    Pi-->>Bot: stdout: {"type":"toolcall_end"}
    Pi-->>Bot: stdout: {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Here is..."}}
    Bot->>Throttler: appendText("Here is...")
    
    Note over Throttler: Throttle timer (1000ms elapsed)
    Throttler->>User: editMessageText("Here is...")

    User->>Bot: In-flight message: "Actually make it brief"
    Bot->>Pi: stdin: {"type":"prompt","message":"Actually make it brief","streamingBehavior":"steer"}
    Pi-->>Bot: stdout: {"type":"response","command":"prompt","success":true,"data":{"disposition":"queued"}}

    Pi-->>Bot: stdout: {"type":"agent_settled"}
    Bot->>Throttler: finalize()
    Throttler->>User: Final editMessageText with full Markdown formatting
```
