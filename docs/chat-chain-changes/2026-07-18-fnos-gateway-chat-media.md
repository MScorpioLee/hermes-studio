---
date: 2026-07-18
commit: pending
feature: fnOS gateway chat transport and media uploads
impact: Chat and group-chat media uploads now honor the configured public base path; no message schema or history migration is required.
---

fnOS packaged Web UI builds run under `/app/hermes-studio`, so chat and
group-chat attachment uploads now post to the active base URL instead of the
site root. Socket.IO transports for fnOS builds stay on HTTP polling under the
gateway path, while raw WebSocket endpoints can use the direct app port with
embedded-mode Origin checks that allow local and private LAN access. Existing
stored sessions and uploaded file references remain compatible.
