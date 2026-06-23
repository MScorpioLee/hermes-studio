# fnOS Packaging

Hermes Studio can be packaged as a Docker-style fnOS application. The package
definition lives in `fnos/hermes-studio` and is built with the official
`fnpack` tool.

## Image

The fnOS package expects a self-built container image. The default image used by
the local packaging script is:

```text
ghcr.io/mscorpiolee/hermes-studio:latest
```

The `Build GHCR Image and fnOS Package` workflow builds and pushes the image to
GitHub Container Registry, then creates an `.fpk` that points to the same image
tag.

## Local Build

Install or download `fnpack`, then run:

```bash
FNPACK_BIN=/path/to/fnpack npm run build:fnos
```

Override the image baked into the package when needed:

```bash
FNOS_IMAGE=ghcr.io/mscorpiolee/hermes-studio:0.6.19 FNPACK_BIN=/path/to/fnpack npm run build:fnos
```

The output is written to `dist/fnos/hermes-studio.fpk`.

## fnOS Runtime

The package installs a Docker project with:

- Web UI entrypoint: `http://<fnos-host>:6060/`
- Container image: configured at build time by `FNOS_IMAGE`
- Hermes Agent state: `${TRIM_PKGVAR}/hermes`
- Web UI state: `${TRIM_PKGVAR}/hermes-web-ui`

The default Web UI account is `admin` / `123456`. Change it after first login.
