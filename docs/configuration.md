# Configuration & Deployment Guide

This document describes environment variables, configuration options, and production deployment recommendations for `tg-bot-agent-streamer`.

---

## 1. Environment Variables

Create a `.env` file in the project root:

```env
# Required: Telegram Bot Token from @BotFather
TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"

# Required: Comma-separated list of Telegram User IDs allowed to access the bot
ALLOWED_TELEGRAM_USER_IDS="123456789,987654321"

# Optional: Directory where the Pi agent will execute commands and tools (defaults to ./workspace)
PI_WORKSPACE_DIR="/Users/yourname/Projects/my-project"

# Optional: LLM model to use (e.g., anthropic/claude-3-7-sonnet, gemini/gemini-2.5-flash)
PI_MODEL="anthropic/claude-3-7-sonnet"

# Optional: Directory for persistent Pi session history files (defaults to .sessions)
PI_SESSION_DIR=".sessions"

# Optional: Stream throttle interval in milliseconds (defaults to 1000)
STREAM_THROTTLE_MS="1000"
```

---

## 2. Setting Up Telegram

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Run `/newbot` and follow the prompts to choose a name and username.
3. Copy the HTTP API token into `TELEGRAM_BOT_TOKEN`.
4. Configure bot commands in BotFather with `/setcommands`:
   ```
   start - Start the bot and see instructions
   help - Detailed command help
   stop - Abort current agent execution
   status - Check agent process health and model
   new - Start a clean session context
   ```

---

## 3. Obtaining Your Telegram User ID

To protect your system from unauthorized tool execution, whitelist your Telegram User ID:
1. Message [@userinfobot](https://t.me/userinfobot) or [@raw_data_bot](https://t.me/raw_data_bot).
2. Note your numeric ID (e.g. `123456789`).
3. Set `ALLOWED_TELEGRAM_USER_IDS="123456789"` in `.env`.

---

## 4. Production Deployment

### Process Management with PM2
For background execution with automatic restarts:

1. Install PM2:
   ```bash
   pnpm add -g pm2
   ```
2. Build the project:
   ```bash
   pnpm build
   ```
3. Start the application:
   ```bash
   pm2 start dist/index.js --name "tg-pi-streamer"
   ```
4. Save the process list:
   ```bash
   pm2 save
   pm2 startup
   ```

### Docker Deployment
When containerizing, ensure the host directory mounted into `PI_WORKSPACE_DIR` has appropriate file permissions and the required CLI tools (Node, git, etc.) are available inside the container.
