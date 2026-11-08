# System Architecture

## High-Level Overview

`tg-bot-agent-streamer` is a real-time bridge connecting Telegram users to the `pi` AI coding agent (`@earendil-works/pi-coding-agent`). The bridge runs `pi` in bidirectional RPC mode (`pi --mode rpc`) as a long-running subprocess communicating over `stdin` and `stdout` using strict newline-delimited JSON (JSONL).

The system handles token-level streaming, interactive tool call tracking, multimodal image attachments, and agent control commands (such as steering, aborting, and switching sessions or models) while respecting Telegram's strict API rate limits and message parsing constraints.

```mermaid
flowchart TD
    User["Telegram User"] <-->|"Telegram Bot API<br/>(grammY)"| Bot["Telegram Bot Router<br/>(src/bot.ts)"]
    
    subgraph Telegram_Presentation ["Telegram Presentation Subsystem"]
        Bot --> Throttler["Streaming Throttler<br/>(src/telegram/throttler.ts)"]
        Throttler --> Markdown["Tag Balancer & MarkdownV2<br/>(src/telegram/markdown.ts)"]
        Bot --> Media["Media Downloader<br/>(src/telegram/media.ts)"]
    end
    
    subgraph Core_Orchestration ["Core Orchestrator"]
        Index["Application Bootstrap<br/>(src/index.ts)"] --> Bot
        Index --> Config["Environment Config<br/>(src/config.ts)"]
        Index --> PiClient["Pi RPC Client<br/>(src/pi/client.ts)"]
    end
    
    subgraph Agent_RPC_Subsystem ["Agent RPC Subprocess Subsystem"]
        PiClient <-->|"JSONL LF Framer<br/>(src/pi/framing.ts)"| Stdio["Child Process Stdio<br/>(stdin / stdout)"]
        Stdio <--> PiProcess["pi --mode rpc Subprocess<br/>(@earendil-works/pi-coding-agent)"]
    end
```

---

## Subsystems & Layers

### 1. Presentation & Telegram Subsystem (`src/telegram/`, `src/bot.ts`)
- **Location**: [`src/bot.ts`](../src/bot.ts), [`src/telegram/throttler.ts`](../src/telegram/throttler.ts), [`src/telegram/markdown.ts`](../src/telegram/markdown.ts), [`src/telegram/media.ts`](../src/telegram/media.ts).
- **Responsibilities**:
  - Authenticate incoming updates against `ALLOWED_USER_IDS`.
  - Handle bot commands (`/start`, `/status`, `/abort`, `/model`, `/session`) and conversational messages.
  - Download photo attachments and convert them to base64 images for multimodal prompts.
  - Buffer streaming text deltas and tool call indicators, throttling Telegram edits to at least 1,000ms.
  - Balance unclosed markdown tags (code blocks, bold, italics, spoilers) and render Telegram-safe MarkdownV2.
  - Automatically split long agent responses exceeding 4,000 characters into consecutive messages.
  - Fall back to plain unformatted text if Telegram rejects partial MarkdownV2 entities.

### 2. Orchestration & Configuration Layer (`src/index.ts`, `src/config.ts`)
- **Location**: [`src/index.ts`](../src/index.ts), [`src/config.ts`](../src/config.ts).
- **Responsibilities**:
  - Load environment variables (`.env`) with Zod schema validation.
  - Instantiate and wire `PiClient` and `grammY` bot instance.
  - Implement graceful shutdown on `SIGINT` and `SIGTERM`.
  - Handle unexpected process crashes or unhandled rejections.

### 3. Agent RPC Subsystem (`src/pi/`)
- **Location**: [`src/pi/client.ts`](../src/pi/client.ts), [`src/pi/framing.ts`](../src/pi/framing.ts), [`src/pi/types.ts`](../src/pi/types.ts).
- **Responsibilities**:
  - Spawn and monitor the `pi --mode rpc` child process.
  - Frame outgoing JSON commands strictly with LF (`\n`).
  - Buffer incoming stdout bytes and split exclusively on `\n` to prevent JSON corruption from Unicode line separators (`U+2028`, `U+2029`).
  - Emit typed EventEmitter events (`turn_start`, `message_update`, `toolcall_start`, `toolcall_end`, `turn_end`, `agent_settled`).
  - Manage in-flight requests, abort signals, and steering behavior.

---

## Request Lifecycle & Streaming Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Telegram User
    participant Bot as grammY Bot (bot.ts)
    participant Throttler as Throttler (throttler.ts)
    participant Client as PiClient (client.ts)
    participant Pi as Pi Subprocess (stdio)

    User->>Bot: Sends prompt or photo
    Bot->>Bot: Check auth (ALLOWED_USER_IDS)
    alt Unauthorized
        Bot-->>User: 403 Forbidden response
    else Authorized
        Bot->>Client: client.prompt(text, images)
        Client->>Pi: Send JSONL command: {"type": "prompt", ...}\n
        
        loop Stream Events from Pi
            Pi-->>Client: {"type": "turn_start", ...}\n
            Pi-->>Client: {"type": "message_update", "delta": "..."}\n
            Client-->>Bot: emit('message_update', delta)
            Bot->>Throttler: pushChunk(delta)
            Note over Throttler: Throttle edits (>= 1000ms)<br/>Balance Markdown tags
            Throttler-->>User: editMessageText (MarkdownV2)
        end

        Pi-->>Client: {"type": "toolcall_start", "name": "bash"}\n
        Client-->>Bot: emit('toolcall_start')
        Bot->>Throttler: updateStatus("Running bash...")
        Throttler-->>User: editMessageText (status update)

        Pi-->>Client: {"type": "agent_settled"}\n
        Client-->>Bot: emit('agent_settled')
        Bot->>Throttler: finalize()
        Throttler-->>User: Final edit / complete message
    end
```
