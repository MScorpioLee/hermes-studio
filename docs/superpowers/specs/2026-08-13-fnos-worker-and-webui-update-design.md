# fnOS Worker Recovery And Web UI Update Design

## Goal

Keep Hermes Studio usable after an abnormal Web UI restart and restore independent Web UI version management on fnOS.

## Confirmed Failures

- A previous `default` profile worker survived its parent with `PPID 1` and kept `127.0.0.1:6912` open.
- The replacement broker spawned another worker on the same deterministic endpoint, which exited with `OSError: [Errno 98] Address already in use`.
- Upstream commit `5d5132e3` removed Web UI download, activation, deletion, and job display from `VersionManagementModal.vue`.
- Upstream Web UI `0.6.40` is available, but the fork sync workflow skipped it because five files require manual conflict resolution.

## Design

Before a broker starts a profile worker, it checks whether the deterministic worker endpoint already accepts connections. If so, it sends the existing worker a bounded shutdown request and waits for the endpoint to become free. It does not kill arbitrary processes by PID and does not touch profile data.

The version management drawer restores the Web UI section from the last working implementation while retaining the current Runtime activation diagnostics and Runtime storage controls. Runtime and Web UI jobs remain independently filterable and visible.

The fork merges upstream `v0.6.40` manually, preserving fnOS gateway, security, and group-chat adaptations. The resulting Web UI artifact is published to the fork release and added to `fnos/hermes-studio/webui-versions.json`.

## Deployment

Install Web UI `0.6.40` through the existing version-managed update API. The native FPK and Hermes Runtime remain unchanged. Existing data under `/vol2/@appdata/hermes-studio/hermes` and `/vol2/@appdata/hermes-studio/hermes-web-ui` is retained.

## Verification

- A regression test proves a stale endpoint is shut down before worker spawn.
- Component tests prove the Web UI version section and Web UI jobs are rendered and actionable.
- Focused server/client tests and the production build pass.
- GitHub release assets and version manifest contain `0.6.40`.
- NAS runs Web UI `0.6.40`, reports the `default` bridge as running, and creates a real chat/context request without `exited before ready` or `Address already in use`.
