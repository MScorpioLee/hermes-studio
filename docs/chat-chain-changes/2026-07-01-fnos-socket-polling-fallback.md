---
date: 2026-07-01
pr: pending
feature: fnOS Socket.IO polling fallback
impact: Chat, group chat, global agent, workflow, and pet-state sockets start with polling and can still upgrade to WebSocket when the gateway supports it.
---

Packaged fnOS builds now connect Socket.IO with polling first and enable
transport fallback. Direct app-port deployments can still upgrade to WebSocket,
while fnOS gateway or nginx deployments that reject WebSocket upgrade requests
continue over polling instead of surfacing `websocket error`.
