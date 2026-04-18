# Agent Routing

## Default Route
Use the `finance_agent` tool for ALL incoming WhatsApp messages.

Pass:
- `phone`: the sender's WhatsApp number (e.g. +5511999990000)
- `message`: the text content of the message
- `mediaType`: "text" | "audio" | "image" | "pdf" (default: "text")
- `mediaData`: base64 content for audio/image/pdf messages (omit for text)

## Rules
- Route every message to finance_agent — no exceptions
- Never reply directly without calling finance_agent first
- Never save data without going through the agent's confirmation flow
