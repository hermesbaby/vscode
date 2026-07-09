# HermesBaby VS Code Extension — Architecture Specification

Structured after [arc42](https://arc42.org).

## 1. Introduction and Goals

The `hermesbaby` extension is a thin VS Code integration for the [HermesBaby](https://github.com/hermesbaby/hermesbaby) `hb` CLI, "the software and systems engineers' typewriter." It gives docs-as-code authors one-click access to `hb` actions (`clean`, `configure`, `htaccess update`, `html`, `html-live`, `publish`) from the Command Palette, the `Terminal > Run Task` menu, or a status bar item, and bundles a curated set of recommended companion extensions.

**Goals**

- Let a user run any `hb` action without memorizing the CLI syntax.
- Surface `hb` output (including errors) in a normal VS Code terminal, using the same UX as any other build task.
- Keep the extension itself buildable without requiring a local Node.js install.
- Define, as a single source of truth, the set of companion extensions required for the recommended HermesBaby docs-as-code workflow (icons, spell/diagram/markup tooling, git tooling, etc.), so installing `hermesbaby` sets up a complete authoring environment rather than just the `hb` action runner.

**Stakeholders**

| Role | Concern |
|---|---|
| Docs-as-code authors (corporate engineers) | Fast, discoverable access to `hb` actions inside their editor |
| HermesBaby/extension maintainers | Small, easy-to-extend codebase; reproducible build |

## 2. Constraints

- Must run inside the VS Code **extension host**, a Node.js context (`target: 'node'` in `webpack.config.js`).
- Ships as a single bundled file (`dist/extension.js`); `vscode` is externalized, everything else is webpacked.
- Targets VS Code engine `^1.91.0` (`package.json`).
- Contributors build without a local Node.js install — the Docker image in `devcontainer-docker/` is the only supported build environment.
- `npm install` must go through the corporate Artifactory proxy; credentials are injected via `.secrets` (git-ignored) and a `.pem` cert, never baked into the image.
- The extension assumes the `hb` CLI is already available on the user's `PATH`/workspace — it does not install or vendor it.

## 3. Context and Scope

**Business context**

The extension is a UI layer in front of the external `hb` CLI. All actual document-build/publish logic lives in HermesBaby itself; the extension's only job is to let users trigger it without a terminal prompt.

```
 User ── Command Palette / Status bar / Run Task ──▶ hermesbaby extension ──▶ hb CLI (external, on PATH)
```

**Technical context**

- Inbound: VS Code UI surfaces (Command Palette, status bar, Tasks: Run Task) invoke the extension via the Commands API and Tasks API.
- Outbound: the extension shells out to `hb <action>` via `vscode.ShellExecution`, in the active workspace folder.
- Build-time only: the extension's own compile/watch/package/lint pipeline runs inside a Docker container (`devcontainer-docker/`), unrelated to the extension's runtime behavior.

## 4. Solution Strategy

- **Thin extension, no duplicated logic**: `extension.ts` contains no docs-build logic; it only maps a fixed list of actions (`HB_TASKS`) to shell invocations of `hb`.
- **Dual exposure per action**: every `hb` action is registered as both a VS Code Task and a VS Code Command, so it's reachable from every relevant surface (Run Task, Command Palette, status bar, keybindings). See [ADR-0001](#9-architecture-decisions).
- **Webpack bundling**: keeps extension activation fast and the packaged `.vsix` small (`ts-loader` + `webpack`, `libraryTarget: 'commonjs2'`).
- **Containerized build**: Docker (`node:latest`) is used only to compile/lint/package the extension, decoupling contributor machines from a specific Node version and centralizing Artifactory auth.

## 5. Building Block View

```
vscode/ (repo root)
├── src/
│   └── extension.ts        — activation, HB_TASKS table, TaskProvider, Commands, status bar item
├── package.json             — contributes.commands, contributes.taskDefinitions, extensionPack
├── webpack.config.js        — bundles src/extension.ts → dist/extension.js
├── .vscode/tasks.json       — DEV-ONLY tasks to build/watch/lint/package the extension itself
└── devcontainer-docker/
    ├── Dockerfile           — node:latest + Artifactory .npmrc/cert
    ├── docker-compose.yml   — mounts repo into /workspace, runs the node service
    ├── .npmrc / .secrets    — Artifactory proxy config/credentials (git-ignored)
    └── bitbucket-*.pem      — Artifactory TLS chain
```

`extension.ts` has four responsibilities, all in one file given the extension's current size:

1. `HB_TASKS` — the single source of truth mapping an action label to its `hb` shell command.
2. A `TaskProvider` for task type `hermesbaby` (declared in `package.json` → `contributes.taskDefinitions`), surfacing each action under **Terminal ▸ Run Task**.
3. One `vscode.commands.registerCommand('hermesbaby.<action>', …)` per action (declared in `package.json` → `contributes.commands`), each just building and executing the corresponding task.
4. `hermesbaby.pickTask` — a QuickPick command with no task of its own, used by the status bar item.

## 6. Runtime View

**Scenario A — status bar / Command Palette**

1. User clicks the `$(tools) hb` status bar item (or runs a `HermesBaby: hb …` command from the Palette).
2. If via status bar: `hermesbaby.pickTask` shows a `QuickPick` of actions, then calls `vscode.commands.executeCommand('hermesbaby.<action>')`.
3. The command handler calls `buildTask()` and `vscode.tasks.executeTask(...)`.
4. VS Code runs the `ShellExecution` (`hb <action>`) in the workspace folder, output shown in the integrated terminal.

**Scenario B — Run Task**

1. User opens **Terminal ▸ Run Task**, VS Code calls the registered `TaskProvider.provideTasks()`.
2. Each `HB_TASKS` entry appears as a `hermesbaby` task; selecting one runs it directly — no command layer involved.

**Scenario C — extension self-build (dev-time only)**

1. Contributor runs a task from `.vscode/tasks.json` (e.g., `compile (docker)`).
2. VS Code shells out to `docker compose run --rm node npm run compile`.
3. Problem matcher (`$ts-webpack`) parses webpack/tsc output into the Problems panel.

## 7. Deployment View

- **Runtime**: the packaged `.vsix` runs inside VS Code's extension host on the end user's machine. It has no server component and no runtime dependency on Docker — Docker is a build-time concern only.
- **Distribution**: `extensionPack` in `package.json` additionally recommends a curated set of companion extensions (docs-as-code authoring tools) at install time.

Two distinct build environments exist, with a deliberate split of responsibilities (see [ADR-0002](#adr-0002-publishing-is-owned-exclusively-by-the-github-actions-pipeline)):

| | Local development & testing (corporate) | CI / Release (GitHub Actions) |
|---|---|---|
| Where | `devcontainer-docker/` (`node:latest` container, repo bind-mounted at `/workspace`) | `.github/workflows/ci.yml`, GitHub-hosted runners |
| npm registry access | Via corporate Artifactory proxy (`.npmrc` + `.pem`, credentials from `.secrets`) | Direct to the public npm registry — no proxy, no Artifactory credentials |
| Allowed operations | `npm install`, `compile`, `watch`, `lint`, `test`, local `package` for manual smoke-testing (F5 / Extension Development Host) | `install`, `build`, `test`, version bump, `package`, and — only on a pushed tag — `vsce publish` |
| Publishing credential | None — never holds `VSCE_PAT` | `VSCE_PAT`, stored only in GitHub Actions secrets |
| Trigger | Manual, via `.vscode/tasks.json` or `docker compose run` | Push/PR to `main` (build+test only); tag creation (adds publish step) |

## 8. Cross-cutting Concepts

- **Task/Command duality** — see [ADR-0001](#9-architecture-decisions).
- **No local Node requirement** — enforced by routing all build scripts through `docker compose run --rm node …` rather than documenting a local `npm` setup.
- **Secrets handling** — the Artifactory token lives in `.secrets` (git-ignored, `env_file` in `docker-compose.yml`), never copied into the Docker image; only the non-secret `.npmrc` and the public TLS chain `.pem` are `COPY`'d in the `Dockerfile`.

## 9. Architecture Decisions

### ADR-0001: Expose each `hb` action as both a VS Code Task and a VS Code Command

**Status**: Accepted

**Context**

VS Code has two distinct extensibility primitives:

- **Tasks** — for running external processes, with terminal output and Problem Matcher integration. Reachable from `Terminal ▸ Run Task`, but not bindable to a status bar item, a keybinding, or another command.
- **Commands** — the addressable, bindable unit of action (Command Palette, keybindings, menus, status bar items, `executeCommand`), but with no built-in terminal/Problem Matcher integration of their own.

Each `hb` action is a long-running external process whose live output/errors matter to the user (compilation, publishing, etc.), which argues for a Task. But the extension also wants a single status bar entry point and Command Palette discoverability, which only Commands provide.

**Decision**

For every entry in `HB_TASKS`, register both:

1. A `hermesbaby`-type Task (via `vscode.tasks.registerTaskProvider`) that runs `hb <action>` as a `ShellExecution`.
2. A `hermesbaby.<action>` Command whose implementation builds that same task and calls `vscode.tasks.executeTask(...)`.

The Command is a thin wrapper delegating to the Task — the Task remains the single execution mechanism; the Command exists purely to make that execution addressable from Command Palette/status bar/keybindings.

**Consequences**

- Users can trigger the same action from Run Task, Command Palette, or the status bar, with identical terminal behavior in all cases.
- `HB_TASKS` stays the single source of truth for the label→shell-command mapping; both the provider and the commands read from it.
- Adding a new `hb` action requires only one new `HB_TASKS` entry plus a matching `contributes.commands` entry in `package.json` — the Task and Command registration loops in `activate()` handle the rest.
- Slight duplication: the action list must be kept in sync between `src/extension.ts` (`HB_TASKS`) and `package.json` (`contributes.commands`) by hand; nothing currently enforces this at build time (see [§11](#11-risks-and-technical-debt)).

### ADR-0002: Publishing is owned exclusively by the GitHub Actions pipeline

**Status**: Accepted

**Context**

The project has two build environments for different reasons:

1. **Corporate/local dev environment** (`devcontainer-docker/`) — exists because the corporate network has restricted direct npm registry access; it routes `npm install` through the Artifactory proxy using credentials in `.secrets`.
2. **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs on GitHub-hosted runners with unrestricted internet access, so it needs no Artifactory proxy at all.

Both environments *can* run install/compile/test, but only one should be trusted to produce and publish the canonical released artifact (`vsce publish`):

- Publishing needs a marketplace credential (`VSCE_PAT`) that shouldn't need to exist on any developer machine or inside the corporate-network-facing Docker image, alongside Artifactory secrets.
- A release should be built from a clean checkout of a tagged commit, not a developer's local working tree, which may contain uncommitted or stashed changes.
- Cutting a release shouldn't depend on corporate network/Artifactory availability.

**Decision**

- The corporate Docker environment is for **local development and testing only**: `npm install`, `compile`, `watch`, `lint`, `test`, and local `package` for manual smoke-testing (F5 / Extension Development Host). It never runs `vsce publish`.
- Only the GitHub Actions workflow, triggered by pushing a version tag, is permitted to run `vsce publish`, using `VSCE_PAT` stored exclusively in GitHub Actions secrets.
- CI needs no Artifactory credentials — GitHub-hosted runners reach the public npm registry directly.

**Consequences**

- Developers can fully build, run, and test the extension from the corporate environment without ever holding a marketplace publish credential.
- Releasing always means: merge to `main` → push a tag → CI builds from that exact commit and publishes. No manual `vsce publish` from a laptop.
- The Artifactory credentials and the `VSCE_PAT` credential have non-overlapping scopes and never need to coexist in the same environment.
- Two existing gaps in `ci.yml` must be fixed for this decision to hold in practice: it calls a non-existent `npm run build` script (the actual script is `compile`), and it pins Node 14, which likely can't build this toolchain (webpack 5 / TypeScript 5.7 / `ts-loader`). Tracked in [§11](#11-risks-and-technical-debt).

## 10. Quality Requirements

| Quality goal | Motivation | Realized by |
|---|---|---|
| Usability | Authors shouldn't need to know `hb`'s CLI syntax | Status bar QuickPick + Command Palette entries |
| Consistency | Same behavior regardless of entry point | All entry points funnel through `buildTask()` / `vscode.tasks.executeTask()` |
| Portability (dev environment) | Contributors shouldn't need a specific local Node version | Docker-based build in `devcontainer-docker/` |
| Maintainability | Small extension, easy to extend with new `hb` actions | Single `HB_TASKS` table drives both Task provider and Commands |

## 11. Risks and Technical Debt

- **`HB_TASKS` / `package.json` drift**: the action list is duplicated between `src/extension.ts` and `package.json`'s `contributes.commands`; nothing fails the build if they fall out of sync (e.g., a new action added to one but not the other).
- **String-built command IDs**: `hermesbaby.pickTask` invokes `hermesbaby.${pick.label}` ([extension.ts:58](../src/extension.ts#L58)) — a typo or renamed label silently breaks the QuickPick with no compile-time check.
- **Dev task paths after the `devcontainer-docker/` move**: `.vscode/tasks.json` still runs `docker compose run --rm node ...` with the default working directory (repo root), but `docker-compose.yml` now lives in `devcontainer-docker/`. Unless Compose is invoked with `-f devcontainer-docker/docker-compose.yml` (or the tasks' `options.cwd` is updated), these dev tasks will fail to find the compose file. Worth verifying/fixing separately.
- **Minimal test coverage**: `src/test/extension.test.ts` is still the scaffold's sample test; the Task/Command registration logic itself is untested.
- **`ci.yml` calls a non-existent script**: the "Run build" step runs `npm run build`, but `package.json` defines `compile`, not `build` — this step fails as written. Blocks [ADR-0002](#adr-0002-publishing-is-owned-exclusively-by-the-github-actions-pipeline), since a broken CI build means releases can't actually happen through the intended pipeline.
- **`ci.yml` pins an outdated Node version**: `actions/setup-node@v2` is configured with `node-version: '14'`, which likely can't build this toolchain (webpack 5, TypeScript 5.7, `ts-loader`). Also blocks ADR-0002 for the same reason.

## 12. Glossary

| Term | Meaning |
|---|---|
| `hb` | The HermesBaby CLI tool that this extension wraps; must be on the workspace `PATH` |
| Task (VS Code) | A VS Code API concept for running an external process with terminal output and Problem Matcher support |
| Command (VS Code) | A VS Code API concept for an addressable, bindable action (Palette, keybinding, menu, status bar) |
| Extension host | The Node.js process VS Code runs extensions in |
