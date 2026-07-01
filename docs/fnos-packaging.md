# fnOS Packaging

Hermes Studio can be packaged as a native fnOS application without Docker. The
package definition lives in `fnos/hermes-studio` and is built with the official
`fnpack` tool.

## Native Runtime

The native package includes:

- `app/server` - built Hermes Web UI server, static assets, and production npm dependencies.
- `app/runtime/node` - portable Node.js runtime.
- `app/runtime/python` - portable Python runtime with `hermes-agent`.
- `cmd/main` - fnOS lifecycle script that starts `node dist/server/index.js`.

The first native package target is fnOS `platform = x86` / Linux x64.
The fnOS build disables the in-app Version Preview runtime because that feature
creates a separate development checkout and installs native npm modules on the
NAS at runtime.

The fnOS package is self-contained. It does not declare external fnOS
middleware services and does not require Docker, Redis, MinIO, or RabbitMQ.
The bundled runtime metadata is written to
`fnos/hermes-studio/config/runtime-metadata.json` and is patched during the
build when a workflow supplies a different Hermes Agent version.

## fnOS Integration

The package requests `root` runtime privileges because Hermes Studio needs to
launch and manage shell-backed workers, clean old service processes during
upgrade/stop, and expose the embedded bridge reliably on fnOS. The package still
declares the `hermes-studio` app user/group so fnOS can create the expected
application account records.

The desktop launcher uses fnOS unified gateway registration:

- gateway prefix: `/app/hermes-studio`
- gateway socket: `${TRIM_TARGET_DIR}/hermes-studio.sock`
- minimum fnOS version: `1.1.3100`

The Web UI also keeps the direct HTTP port path for manual access and port
customization. The unified gateway path is the native fnOS desktop entry; the
direct port remains the app setting exposed by the install/config wizard.

## Local Build

Native packages must be built on Linux x64 so native npm modules match fnOS. On
macOS, use GitHub Actions or a Linux builder.

Install or download `fnpack`, prepare the Linux runtime, then run:

```bash
TARGET_OS=linux TARGET_ARCH=x64 HERMES_DESKTOP_NODE_VERSION=24.15.0 HERMES_SKIP_BROWSER_RUNTIME=1 npm --prefix packages/desktop run prepare:runtime
FNPACK_BIN=/path/to/fnpack FNOS_TARGET_OS=linux FNOS_TARGET_ARCH=x64 npm run build:fnos
```

The output is written to `dist/fnos/hermes-studio.fpk`.

## GitHub Updates

The fork tracks upstream through `.github/workflows/sync-upstream.yml`. It runs
every six hours and can also be started manually. When `upstream/main` has new
commits, the workflow merges them into this fork's `main` branch and dispatches
the native fnOS package build.

The package workflow writes two files:

- `dist/fnos/hermes-studio.fpk`
- `dist/fnos/hermes-studio.latest.json`

On a successful build, GitHub publishes both files to a release named
`fnos-v<package.json version>`. Hermes Studio checks the published
`hermes-studio.latest.json` from the Web UI settings update page and reports
whether the native fnOS package is newer than the installed package version.
fnOS App Center update badges still depend on the normal fnOS application
update channel or store/feed integration.

The native fnOS package update should be handled by the fnOS application update
channel. Hermes Web UI and Hermes Agent version management remains in the
existing npm/runtime build flow; the fnOS package does not replace that with a
separate in-app updater.

## fnOS Runtime Paths

- Web UI direct entrypoint: `http://<fnos-host>:6060/`
- fnOS unified gateway entrypoint: `/app/hermes-studio/`
- Hermes Agent state: `${TRIM_PKGVAR}/hermes`
- Web UI state: `${TRIM_PKGVAR}/hermes-web-ui`
- Logs: `${TRIM_PKGVAR}/log/hermes-studio.log`

The default Web UI account is `admin` / `123456`. Change it after first login.
