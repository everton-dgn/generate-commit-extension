# Generate Commit with AI

VS Code and VSCodium extension that generates
[Conventional Commits](https://www.conventionalcommits.org/en/) messages from
your staged diff, using the AI provider of your choice. The message is written
into the Source Control commit box for you to review and edit. The extension
**never commits for you**.

## The commit box button (read first)

The `scm/inputBox` contribution point (the same one Copilot uses for the
sparkle button inside the commit box) is a **proposed API**, not a stable one,
verified on 2026-08-02 against the VS Code 1.131.0 source code
(`menusExtensionPoint.ts`, proposal `contribSourceControlInputBoxMenu`, in
effect since VS Code 1.85). Extensions installed via VSIX can only use it when
the editor is launched with the proposal flag:

```bash
codium --enable-proposed-api=everton.generate-commit
```

Without that flag, the `scm/inputBox` menu is silently rejected and the
extension keeps working through the Command Palette (`Generate Commit:
Generate Commit Message`) and the Generate Commit panel in the left sidebar.

In development mode (F5), the proposal works without flags.

## Features

- Generates the message from the staged diff; if nothing is staged, offers to
  use the unstaged diff (configurable behavior).
- Multi-repo: uses the repository of the clicked button; with a single repo,
  uses it directly; when ambiguous, opens a QuickPick.
- Cancellation: the cancel button on the progress notification aborts the
  HTTP call or kills the CLI process.
- Quick provider/model switching via the `Generate Commit: Switch Provider /
  Model` command.
- **Generate Commit** panel in the left sidebar (sparkles icon): every
  setting in an inline form right in the sidebar — provider, model, effort
  (CLIs), base URL and auth style of the active provider, API keys with
  status, language, limits, custom prompt, fallback and timeout — with no
  floating windows and no JSON editing.
- **Live model suggestions**: the Model field shows the provider's full
  current model list (fetched from its models endpoint every hour, with a
  silent fallback to free text). A newly released model shows up on its own;
  the "Custom…" option lets you type an ID outside the list. For the Codex
  CLI the list comes from `codex debug models`, and the Effort field shows
  only the reasoning levels the selected model supports.
- Guided first run: with no provider available, the flow opens the settings
  (provider choice, masked key, quick validation, saved to Secret Storage).
- Pluggable architecture: one provider = one implementation of the
  `Provider` interface in `src/providers/`.

## Installation

Download the `.vsix` and install it through one of these paths:

1. `Extensions` menu → `...` → `Install from VSIX...`;
2. Terminal:

```bash
codium --install-extension generate-commit-0.1.0.vsix
```

## Providers

| Provider        | Type | Default endpoint / binary                       | Default model             | Where to get the key |
|-----------------|------|--------------------------------------------------|---------------------------|----------------------|
| Claude Code CLI | CLI  | `claude` binary on PATH                          | CLI default               | not needed (uses your Claude Code login) |
| Codex CLI       | CLI  | `codex` binary on PATH                           | CLI default               | not needed (uses your Codex login) |
| OpenRouter      | HTTP | `https://openrouter.ai/api/v1`                   | `google/gemini-2.5-flash-lite` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Kimi (Moonshot) | HTTP | `https://api.moonshot.ai/anthropic`              | `kimi-k2.6`               | [platform.kimi.ai/console/api-keys](https://platform.kimi.ai/console/api-keys) |
| GLM (z.ai)      | HTTP | `https://api.z.ai/api/anthropic`                 | `glm-4.5-air`             | [z.ai/manage-apikey](https://z.ai/manage-apikey/apikey-list) |
| MiniMax         | HTTP | `https://api.minimax.io/anthropic`               | `MiniMax-M2.5-highspeed`  | [platform.minimax.io](https://platform.minimax.io/user-center/basic-information/interface-key) |
| Anthropic (custom) | HTTP | `https://api.anthropic.com` (editable)        | `claude-haiku-4-5-20251001` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

Notes:

- With `claude` installed and logged in, the extension works **with zero
  configuration** (it is the default provider).
- Unavailable CLI providers show up in the "Unavailable" section of the
  QuickPick with a "CLI not found" hint.
- CLI detection looks on PATH, then in the login shell (works around the
  minimal PATH of graphical apps on macOS), and finally in common
  directories (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, among
  others).
- Kimi: avoid `kimi-k2.7-code`, which rejects requests without thinking;
  the `kimi-k2.6` default accepts simple requests (verified on 2026-08-02).
- China: Kimi has the `https://api.moonshot.cn/anthropic` host and MiniMax
  has `https://api.minimaxi.com/anthropic` (editable in settings).
- The "Anthropic (custom)" provider covers any Messages API-compatible
  endpoint: edit the base URL, the model and the authentication style
  (`x-api-key` or `bearer`).
- The Model field suggestions come from each provider's models endpoint
  (`/models`, verified on 2026-08-02: OpenRouter without a key; Kimi, GLM,
  MiniMax and Anthropic with the configured key), cached for 1 hour. If the
  fetch fails (no key, network, custom endpoint without listing), the field
  stays free text with no error. Claude CLI suggests the static aliases
  (`fable`, `opus`, `sonnet`, `haiku`, verified with `claude --help`
  2.1.220); Codex CLI reads the live catalog from `codex debug models`
  (codex-cli 0.146.0), which also reports each model's effort levels — the
  panel's Effort field shows only the levels valid for the selected model.
- Kimi for Coding: anyone with a key for the `api.kimi.com/coding` service
  (instead of the Moonshot platform) can point `generateCommit.kimi.baseUrl`
  to `https://api.kimi.com/coding` — messages (`/v1/messages`) and catalog
  (`/v1/models`) work on that host (verified on 2026-08-02).

### Configuring an API key

In the **Generate Commit** panel in the sidebar, **API keys** section: paste
the provider key (password field, never pre-filled), click Save and wait for
the quick validation. The status stays visible next to the provider
(configured/not set). The key lives in `context.secrets` (VS Code Secret
Storage), **never** in `settings.json` and never rendered in the panel.

## Settings

Every option below can also be changed through the interface, in the
**Generate Commit** panel in the left sidebar (inline form with validation;
the `Generate Commit: Settings` command opens the panel), as well as in the
editor's Settings screen (filter by `generateCommit`).

| Setting | Default | Description |
|---------|---------|-------------|
| `generateCommit.provider` | `claudeCli` | Active provider (`claudeCli`, `codexCli`, `openrouter`, `kimi`, `glm`, `minimax`, `anthropicCustom`). An unavailable one falls back to the first available. |
| `generateCommit.language` | `en` | Language of the generated message (`en`, `pt-BR`, `es`, ...). |
| `generateCommit.maxDiffChars` | `50000` | Character cap of the diff sent; truncates at file boundaries and flags it in the prompt. |
| `generateCommit.maxFileSizeKB` | `50` | Files whose diff chunk exceeds this size are excluded. |
| `generateCommit.includeRecentCommits` | `true` | Sends the 10 recent commits as style reference. |
| `generateCommit.disableThinking` | `false` | Disables reasoning on CLI providers for lower latency: Codex runs with `model_reasoning_effort="none"` and the Claude CLI with `MAX_THINKING_TOKENS=0` (verified on 2026-08-02). The Effort setting is ignored while this is on. |
| `generateCommit.customPrompt` | `""` | Extra instructions appended to the system prompt. |
| `generateCommit.unstagedFallback` | `ask` | With no staged diff: ask, always use unstaged, or never. |
| `generateCommit.timeoutSeconds` | `60` | Timeout for HTTP requests and CLI executions. |
| `generateCommit.<provider>.model` | see table | Model per provider. |
| `generateCommit.<provider>.baseUrl` | see table | Base URL per HTTP provider (HTTPS only). |
| `generateCommit.anthropicCustom.authHeader` | `x-api-key` | Auth style of the custom endpoint (`x-api-key` or `bearer`). |
| `generateCommit.claudeCli.effort` | `low` | Claude Code `--effort` (`low`, `medium`, `high`, `xhigh`, `max`; empty = CLI default). |
| `generateCommit.codexCli.effort` | `low` | Codex `model_reasoning_effort`. Accepted values depend on the model — the panel lists the selected model's levels, read live from `codex debug models` (on 2026-08-02: `low` through `xhigh` on all; `max` and `ultra` on the gpt-5.6 family). Empty = CLI default. |

## Security

- **Secret scanning before sending**: keys (`sk-`, `sk-or-`, `sk-ant-`,
  `ghp_`, `github_pat_`, `AKIA`/`ASIA`, `xox...`, `AIza...`), JWTs, private
  key PEM blocks, credentials in URLs, `.env*` files and keystores (`.jks`,
  `.keystore`, `.p12`, `.pfx`). On detection, the extension **blocks** and
  lists file + secret type (never the value); sending is always an explicit
  decision of yours, per occurrence.
- **Diff exclusions**: lockfiles (`pnpm-lock.yaml`, `package-lock.json`,
  `yarn.lock`, `bun.lock`, `bun.lockb`, `deno.lock`), binaries, minified
  files (`*.min.js/css`) and files above the size limit.
- **Truncation** at the configurable cap, with a notice inside the prompt.
- **HTTPS only**; configurable timeout (default 60 s).
- **Metadata-only logging** (provider, model, latency, diff size) to the
  "Generate Commit" Output Channel. Diffs, keys and responses are never
  logged; CLI stderr is **never** displayed or logged raw (it is classified
  against a closed list of signatures, e.g. "not logged in"), and HTTP error
  details go through the same secret redaction as the scanner before
  reaching the UI.
- **Keys out of workspace reach**: `*.baseUrl` and
  `anthropicCustom.authHeader` are `machine`-scoped, so a repository's
  `.vscode/settings.json` cannot redirect your keys to a third-party host.
- **Robust cancellation**: the cancel button aborts the HTTP call or kills
  the CLI **process group** (SIGTERM, then SIGKILL), including child
  subprocesses.
- **Concurrency and consistency**: one generation per repository (starting
  another aborts the previous one and only the latest writes to the box);
  the staged diff is re-read before filling the box and the result is
  discarded if the stage changed during generation.
- **Zero telemetry** and zero calls to services other than the chosen
  provider.
- **Locked-down panel webview**: the settings form runs in a WebviewView
  with CSP `default-src 'none'` (only local bundle files, no remote content,
  no inline script/style), values rendered via safe DOM (no `innerHTML` with
  user data), messages validated against a key whitelist before any
  `config.update`, and secrets never rendered in the DOM (password fields
  are write-only).
- No `vscode.lm` API (which depends on Copilot and does not exist on
  VSCodium).

## Development

```bash
pnpm install
pnpm watch        # bundle into dist/ with watch
# F5: opens the Extension Development Host (scm/inputBox proposal enabled)
```

Scripts: `pnpm test` (Vitest), `pnpm typecheck` (tsc), `pnpm lint` (Biome),
`pnpm build` (esbuild), `pnpm package` (builds the `.vsix` with
`@vscode/vsce`).

## Official source verifications (2026-08-02)

| Item | Verified value | Source |
|------|----------------|--------|
| `scm/inputBox` is a proposed API | `contribSourceControlInputBoxMenu`, since VS Code 1.85, still proposed in 1.131 | [menusExtensionPoint.ts](https://raw.githubusercontent.com/microsoft/vscode/1.131.0/src/vs/workbench/services/actions/common/menusExtensionPoint.ts) |
| Command arguments in `scm/inputBox` | `(rootUri, context, token)`, not `SourceControl` | [scmInput.ts](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/scm/browser/scmInput.ts) |
| Git API v1 | `getAPI(1)`, `Repository.diff(cached?)`, `inputBox.value`, `log(options?)` | [git.d.ts](https://raw.githubusercontent.com/microsoft/vscode/1.126.0/extensions/git/src/api/git.d.ts) |
| Current VSCodium | 1.126.04524 (VS Code 1.126.0) | [releases](https://github.com/VSCodium/vscodium/releases/latest) |
| OpenRouter endpoint | `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer` | [docs/quickstart](https://openrouter.ai/docs/quickstart) |
| Cheap OpenRouter models | `google/gemini-2.5-flash-lite`, `openai/gpt-5-nano`, `meta-llama/llama-3.2-3b-instruct`, `mistralai/mistral-small-24b-instruct-2501`, `openai/gpt-4o-mini` | [api/v1/models](https://openrouter.ai/api/v1/models) |
| Anthropic Messages API | `POST /v1/messages`; headers `x-api-key` + `anthropic-version: 2023-06-01`; text in `content[i].text` | [platform.claude.com/docs](https://platform.claude.com/docs/en/api/messages) |
| Kimi endpoint | `https://api.moonshot.ai/anthropic` (China: `api.moonshot.cn/anthropic`) | [platform.kimi.ai/docs](https://platform.kimi.ai/docs/guide/claude-code-kimi) |
| Kimi models | `kimi-k3`, `kimi-k2.7-code` (requires thinking), `kimi-k2.6`, among others | [platform.kimi.ai/docs/models](https://platform.kimi.ai/docs/models) |
| GLM endpoint | `https://api.z.ai/api/anthropic` | [docs.z.ai](https://docs.z.ai/devpack/tool/claude) |
| GLM models | `glm-5.2`, `glm-4.7`, `glm-4.5-air` | [docs.z.ai](https://docs.z.ai/devpack/tool/claude) |
| MiniMax endpoint | `POST https://api.minimax.io/anthropic/v1/messages`; Bearer **or** `x-api-key` auth; `anthropic-version` not required | [platform.minimax.io/docs](https://platform.minimax.io/docs) |
| MiniMax models | `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.5`, `MiniMax-M2.1`, `MiniMax-M2` (+ `-highspeed` variants) | [platform.minimax.io/docs](https://platform.minimax.io/docs) |
| Claude Code flags | `-p`, `--tools`, `--model`, `--effort (low..max)`, `--output-format`, `--no-session-persistence`; **no** `--fast` flag in 2.1.220 | local `claude --help` (2.1.220) |
| Codex flags | `codex exec`, `--model`, `--sandbox read-only`, `--skip-git-repo-check`, `--ephemeral`, `--output-last-message`, `--config k=v` | local `codex --help` / `codex exec --help` (0.146.0) |
| Codex approval/effort | `approval_policy="never"` and `model_reasoning_effort` via `-c`; the `--ask-for-approval` flag appeared and disappeared from `--help` within the same version (dynamic surface), so the policy goes through the config key | [config-reference](https://developers.openai.com/codex/config-reference) + local verification on 2026-08-02 |

Caveats recorded by the research: Kimi and GLM do not document the literal
path (`/v1/messages`) nor the raw HTTP headers outside the Claude Code
context (which authenticates via `ANTHROPIC_AUTH_TOKEN`, sent as
`Authorization: Bearer`); that is why their presets use Bearer. MiniMax is
the only one with the path literally confirmed in the official OpenAPI
specification.

## Known limitations

- CLI providers were designed for macOS/Linux (detection via `command -v`
  and login shell); on Windows, use an HTTP provider.
- Secret scanning is heuristic: false positives are possible (the final
  sending decision is always yours) and no pattern list covers every key
  format in existence.
- Repositories with no commits (unborn HEAD) have no staged diff readable
  through the Git API; make the initial commit first.

## License

MIT. See the `LICENSE` file in the repository root.
