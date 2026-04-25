---
name: finn-handler
description: "Routes every incoming WhatsApp message to the Finn finance agent"
metadata:
  {
    "openclaw":
      {
        "events": ["message:received"],
      },
  }
---

# Finn Message Handler

Intercepts every incoming WhatsApp message and routes it to the Finn finance agent plugin.
