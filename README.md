# hermesbaby

VS Code extension for [HermesBaby](https://github.com/hermesbaby/hermesbaby), the software and systems engineers' typewriter.
The extension provides the following services:

* Run `hb` commands (`clean`, `configure`, `htaccess update`, `html`, `html-live`, `publish`) as VS Code tasks, from the Command Palette, or via the `$(tools) hb` status bar item, and
* bundle a curated set of recommended extensions for docs-as-code authoring.

## Development and Publishing

This project uses two separate environments, deliberately:

- **Local development and testing** — the development action below (`install`, `compile`, `watch`, `package`, `lint`) run in a Docker-based environment on your machine, which allows you to use corporate npm proxy (e.g. Artifactory). \
It's for building and manually smoke-testing the extension (`F5` / Extension Development Host); it never holds a marketplace publish credential.
- **Publishing** — handled exclusively by the GitHub Actions pipeline (`.github/workflows/ci.yml`), triggered by pushing a version tag. It builds from a clean checkout on GitHub-hosted runners (direct npm registry access, no Artifactory proxy) and publishes using a `VSCE_PAT` secret that exists only in GitHub Actions.

In practice: merge to `main`, push a tag, and CI builds and publishes the extension. There is no local `vsce publish` step.

See [specification/architecture.md](specification/architecture.md) for the full reasoning — particularly §7 (Deployment View) for how the two environments compare, and ADR-0002 (§9) for why publishing is CI-only.

## Prerequisites

- VS Code
- Docker Desktop (used to run Node.js — no local Node install required for this project)

## Setup Docker Environment

1. Copy `.secrets.example` to `.secrets` and fill in `NPM_ARTIFACTORY_TOKEN` with your corporate Artifactory credentials.

2. Build the Docker image:

   ```bash
   docker compose build
   ```

3. Install dependencies:

   ```bash
   docker compose run --rm node npm install
   ```

## Compile

```bash
docker compose run --rm node npm run compile
```

Or run the **compile (docker)** task from VS Code (`Ctrl+Shift+B` or via Terminal > Run Task).

## Run / Debug

Press **F5** in VS Code. This compiles the extension (via Docker) and opens an Extension Development Host window with `hermesbaby` loaded. Open a workspace folder and use the `$(tools) hb` status bar item, or run an `hb ...` command from the Command Palette.

## Watch mode

```bash
docker compose run --rm node npm run watch
```

Recompiles automatically on file changes. Or run the **watch (docker)** task from VS Code.

## Package / Lint

```bash
docker compose run --rm node npm run package
docker compose run --rm node npm run lint
```


## Notes

- `node:latest` is used inside the container so the project always builds with the newest Node.js, without affecting your system-wide Node install.
- npm installs go through the corporate Artifactory proxy (configured in `.npmrc`); the auth token is injected at container runtime from `.secrets` and is never committed or baked into the Docker image.
