---
date: 2026-07-01
pr: pending
feature: fnOS unified gateway
impact: Chat, group chat, pet state, workflow, terminal, and kanban sockets now honor the packaged public base path used by the fnOS gateway.
---

The fnOS package serves Hermes Studio under `/app/hermes-studio` through the
native unified gateway while keeping the direct Web UI port available. Socket.IO
and raw WebSocket clients now build URLs through the shared base-path helpers so
chat-chain sockets work through both entrypoints.
