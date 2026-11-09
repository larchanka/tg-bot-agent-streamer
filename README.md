# Telegram Bot Pi Agent Streamer 🤖⚡

A high-performance Telegram bot that connects to the [`pi`](https://github.com/earendil-works/pi) AI coding agent running in bidirectional RPC mode (`pi --mode rpc`). It streams responses from the agent to Telegram with rich Markdown formatting, enables real-time steering and aborting, displays live tool execution badges, and supports multimodal photo inputs.

---

## Features

- ⚡ **Bidirectional Live Streaming**: Streams text tokens directly to Telegram messages using smart 1-second throttling to avoid Telegram flood limits.
- 📊 **Native Rich Messages & Tables (Bot API 10.1+)**: Automatically parses GitHub Flavored Markdown (GFM) tables into native Telegram table blocks (`InputRichBlockTable`) with column alignment and compact borders, alongside native section headings, preformatted code, expandable details, blockquotes, and lists.
- 🧠 **Live Drafts & Thinking Indicators**: Streams live drafts via `sendRichMessageDraft` with native thinking blocks (`InputRichBlockThinking`) during active tool executions, smoothly settling into the final message.
- 🛡️ **Resilient Two-Tier Fallback**: Seamlessly falls back to classic `sendMessage` / `editMessageText` with MarkdownV2 (and stripped plain text) if rich messages are not supported by the client or chat.
- 🎨 **Rich Markdown Support**: Full Telegram Markdown formatting including syntax-highlighted code blocks, blockquotes, inline code, bold, italic, spoilers, and links with resilient intermediate tag balancing.
- 🛠️ **Real-time Tool Badges**: Displays transient indicators while the agent runs tools (e.g. `⚡ Running tool: bash (git status)...`), cleanly finalizing into response text when finished.
- 🎯 **In-Flight Steering & Aborts**:
  - Send a message while Pi is thinking to automatically steer the execution plan (`streamingBehavior: "steer"`).
  - Use `/stop` to immediately abort agent execution.
- 🖼️ **Multimodal Support**: Send photos with captions; images are automatically downloaded, base64-encoded, and passed to the agent.
- 🔒 **Security Whitelist**: Strictly restricts bot access to whitelisted Telegram User IDs specified in `.env`.
- 📁 **Configurable Workspace**: Agent operates inside a designated project directory with access to its standard coding tools (`read`, `write`, `edit`, `bash`).

---

## Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- [pnpm](https://pnpm.io/)
- `pi` CLI installed globally and authenticated:
  ```bash
  pi --version
  ```
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- Your Telegram User ID (obtainable from [@userinfobot](https://t.me/userinfobot))

### 2. Installation

```bash
git clone <repo-url> tg-bot-agent-streamer
cd tg-bot-agent-streamer
pnpm install
```

### 3. Configuration & Telegram Setup

1. Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
2. Open Telegram and message [@BotFather](https://t.me/BotFather) to create a bot (`/newbot`) and configure bot commands (`/setcommands`):
   ```
   start - Start the bot and see instructions
   help - Detailed command help
   stop - Abort current agent execution
   status - Check agent process health and model
   new - Start a clean session context
   ```
3. Whitelist your Telegram User ID by querying [@userinfobot](https://t.me/userinfobot) or [@raw_data_bot](https://t.me/raw_data_bot).
4. Edit `.env` with your values:
   ```env
   TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
   ALLOWED_TELEGRAM_USER_IDS="12345678,87654321"
   PI_WORKSPACE_DIR="/path/to/your/project"
   PI_MODEL="anthropic/claude-3-7-sonnet"
   PI_SESSION_DIR=".sessions"
   STREAM_THROTTLE_MS="1000"
   ENABLE_RICH_MESSAGES="true"
   ```

### 4. Running the Bot

Development mode (with auto-reload):
```bash
pnpm dev
```

Production build & start:
```bash
pnpm build
pnpm start
```

### 5. Production Deployment

#### Process Management with PM2
For background daemon execution with automatic restarts:
```bash
pnpm add -g pm2
pnpm build
pm2 start dist/index.js --name "tg-pi-streamer"
pm2 save
pm2 startup
```

#### Docker Deployment
When containerizing, mount the host project directory into `PI_WORKSPACE_DIR` and ensure the container user has read/write file permissions and access to necessary development tools (Node, git, etc.).

### 6. Testing & Verification

Run the full test suite (unit and end-to-end integration tests):
```bash
pnpm test
```

Watch mode for development:
```bash
pnpm test:watch
```

Typecheck without emitting code:
```bash
pnpm typecheck
```

---

## Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and usage instructions |
| `/help` | Detailed help with available commands and controls |
| `/stop` | Immediately abort the current agent execution |
| `/status` | View current agent status, active model, and session info |
| `/new` | Start a fresh agent session context |

---

## Technical Documentation & Architecture

The repository's complete technical context and architecture documentation is maintained in [`context/`](context/):

- [**Codebase Context & Navigation Map**](context/index.md): Central index and quick facts.
- [**System Architecture & Subsystems**](context/architecture.md): High-level system architecture, Mermaid diagrams, and request lifecycle.
- [**Module Catalog**](context/modules.md): Complete module-by-module public API and component breakdown.
- [**Signatures & Symbol Index**](context/signatures.md): Searchable index of all function signatures, parameters, and return types.
- [**Dependencies & Integrations**](context/dependencies.md): Internal call graphs, hub modules, and third-party dependencies.
- [**Engineering Conventions & Invariants**](context/conventions.md): Code style, error handling patterns, and non-negotiable invariants.

---

## License

MIT
