# Telegram Bot Pi Agent Streamer 🤖⚡

A high-performance Telegram bot that connects to the [`pi`](https://github.com/earendil-works/pi) AI coding agent running in bidirectional RPC mode (`pi --mode rpc`). It streams responses from the agent to Telegram with rich Markdown formatting, enables real-time steering and aborting, displays live tool execution badges, and supports multimodal photo inputs.

---

## Features

- ⚡ **Bidirectional Live Streaming**: Streams text tokens directly to Telegram messages using smart 1-second throttling to avoid Telegram flood limits.
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

### 3. Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
ALLOWED_TELEGRAM_USER_IDS="12345678,87654321"
PI_WORKSPACE_DIR="/path/to/your/project"
PI_MODEL="anthropic/claude-3-7-sonnet"
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

## Documentation

- [Architecture & System Design](docs/architecture.md)
- [Pi RPC Protocol Integration](docs/pi-rpc-integration.md)
- [Telegram Streaming & Markdown Handling](docs/telegram-streaming.md)
- [Configuration & Deployment Guide](docs/configuration.md)

---

## License

MIT
