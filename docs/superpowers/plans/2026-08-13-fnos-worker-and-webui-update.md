# fnOS Worker Recovery And Web UI Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale fnOS profile workers from blocking restart and restore independent Web UI updates in Hermes Studio.

**Architecture:** The Python bridge transport owns deterministic worker endpoints, so it will retire an existing endpoint before spawning a replacement. The Vue version drawer will again consume the existing Web UI runtime-version APIs without changing server contracts. Upstream `v0.6.40` is merged while retaining the fork's fnOS adaptations.

**Tech Stack:** Python 3.12, Node.js 24, TypeScript, Vue 3, Vitest, GitHub Actions, fnOS native application runtime.

## Global Constraints

- Do not rebuild or reinstall the native FPK.
- Do not replace Hermes Runtime `0.20.0`.
- Do not delete or migrate user conversations, profiles, credentials, or model configuration.
- Web UI installation must use the existing version-managed update flow.

---

### Task 1: Recover stale profile worker endpoints

**Files:**
- Modify: `packages/server/src/services/hermes/agent-bridge/python/bridge_transport.py`
- Test: `tests/server/agent-bridge-python-concurrency.test.ts`

**Interfaces:**
- Consumes: worker endpoint strings such as `tcp://127.0.0.1:6912` and `_send_bridge_request(endpoint, request, timeout)`.
- Produces: `_retire_stale_worker_endpoint(endpoint: str) -> None`, called before `subprocess.Popen`.

- [ ] **Step 1: Add a failing source/runtime regression test**

Assert that worker startup calls the stale-endpoint retirement helper before `subprocess.Popen`, and run a Python fixture where a temporary endpoint answers `shutdown` and releases its socket.

- [ ] **Step 2: Run the focused test and confirm the stale endpoint remains occupied**

Run: `npm exec vitest run tests/server/agent-bridge-python-concurrency.test.ts`

Expected: FAIL because worker startup does not retire the existing endpoint.

- [ ] **Step 3: Implement bounded endpoint retirement**

For TCP and IPC endpoints, probe the endpoint, send `{ "action": "shutdown" }`, then poll for up to five seconds until connection fails or the IPC socket disappears. Ignore missing endpoints; surface an occupied endpoint only when it cannot be retired.

- [ ] **Step 4: Run the focused test**

Run: `npm exec vitest run tests/server/agent-bridge-python-concurrency.test.ts`

Expected: PASS.

### Task 2: Restore Web UI version management

**Files:**
- Modify: `packages/client/src/components/layout/VersionManagementModal.vue`
- Test: `tests/client/version-management-modal.test.ts`

**Interfaces:**
- Consumes: `activateWebUiVersion`, `deleteWebUiVersion`, `downloadWebUiVersion`, and Web UI jobs from `runtime-versions.ts`.
- Produces: Web UI version list, download/activate/delete controls, and Web UI download task display.

- [ ] **Step 1: Replace the hide-Web-UI assertion with failing behavior tests**

Assert that remote Web UI `0.6.40` is displayed, its GitHub download button calls `downloadWebUiVersion('0.6.40', 'github')`, and a Web UI job appears in the task list.

- [ ] **Step 2: Run the component test and confirm failure**

Run: `npm exec vitest run tests/client/version-management-modal.test.ts`

Expected: FAIL because `runtimeVersions.webUiTitle` and `0.6.40` are absent.

- [ ] **Step 3: Restore the Web UI section while retaining Runtime diagnostics**

Reintroduce the Web UI imports, computed versions, Web UI actions, combined job polling, section markup, and mixed job labels. Keep `runtime-activation-error`, Runtime Agent version display, and Runtime directory controls.

- [ ] **Step 4: Run the component test**

Run: `npm exec vitest run tests/client/version-management-modal.test.ts`

Expected: PASS.

### Task 3: Merge and publish upstream Web UI 0.6.40

**Files:**
- Resolve: `packages/client/src/stores/hermes/group-chat.ts`
- Resolve: `packages/client/src/views/hermes/SettingsView.vue`
- Resolve: `packages/server/src/security.ts`
- Resolve: `tests/client/group-chat-store-streaming.test.ts`
- Resolve: `tests/server/security-policy.test.ts`
- Update: `fnos/hermes-studio/webui-versions.json` through the release workflow.

**Interfaces:**
- Consumes: upstream tag `v0.6.40` and existing fnOS adaptations on `main`.
- Produces: fork release `v0.6.40` with `.tar.gz`, `.sha256`, and `.json` Web UI assets.

- [ ] **Step 1: Merge `v0.6.40` and resolve each conflict without dropping fnOS behavior**

Run: `git fetch upstream refs/tags/v0.6.40:refs/tags/v0.6.40 && git merge --no-edit v0.6.40`

- [ ] **Step 2: Run focused regression tests and production build**

Run the worker, version modal, group-chat, security, runtime-version, fnOS lifecycle, and metadata tests, then `npm run build`.

- [ ] **Step 3: Commit, push, and verify GitHub Actions**

Push `main`, run the Web UI artifact workflow if sync does not dispatch it, and verify Build, Playwright, release assets, and manifest refresh.

### Task 4: Install and verify on fnOS

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes: authenticated Hermes update API and published Web UI `0.6.40` assets.
- Produces: active Web UI `0.6.40` with Runtime `0.20.0` and healthy default worker.

- [ ] **Step 1: Run the version-managed internal update**

POST `/api/hermes/update`, wait for the native wrapper restart, and verify only the `webui` layer changed.

- [ ] **Step 2: Verify process ownership and endpoint cleanup**

Confirm no orphan `--worker-profile default` process has `PPID 1`, and only the active worker owns its deterministic endpoint.

- [ ] **Step 3: Verify application behavior**

Confirm health HTTP 200, active Web UI `0.6.40`, Runtime `0.20.0`, Web UI versions visible from the API, default bridge running, and no new worker startup errors in logs.
