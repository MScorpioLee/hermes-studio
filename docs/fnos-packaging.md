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
`fnos-v<package.json version>`. This gives fnOS app stores or custom update
checks a stable URL to poll. A manually installed `.fpk` still needs an app
store/feed integration to show in-product update prompts inside fnOS.

## fnOS Runtime Paths

- Web UI entrypoint: `http://<fnos-host>:6060/`
- Hermes Agent state: `${TRIM_PKGVAR}/hermes`
- Web UI state: `${TRIM_PKGVAR}/hermes-web-ui`
- Logs: `${TRIM_PKGVAR}/log/hermes-studio.log`

The default Web UI account is `admin` / `123456`. Change it after first login.
