---
date: 2026-07-01
pr: pending
feature: fnOS Socket.IO namespace base
impact: Chat, group chat, global agent, workflow, and pet-state sockets no longer include the fnOS public base path in the Socket.IO namespace URI.
---

Packaged fnOS builds keep `/app/hermes-studio` on the Engine.IO `path` option
for gateway routing, while namespace URLs connect from the origin root. This
prevents clients from requesting `/app/hermes-studio/chat-run` as a namespace,
which the server rejects with `Invalid namespace`.
