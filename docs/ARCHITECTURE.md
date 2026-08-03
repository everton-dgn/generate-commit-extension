# Architecture

This document describes how the extension is organized on the inside: the
activation flow, the message generation flow, the pluggable provider
architecture and the structural decisions. For the threat model, see
`SECURITY.md` at the root.

## Module overview

| File | Role |
|------|------|
| `src/extension.ts` | Activation: Output Channel, commands and the settings panel (WebviewView). |
| `src/commands.ts` | The `generate` command and the generation flow orchestrator; error actions open the panel. |
| `src/git.ts` | Access to the built-in Git extension (`vscode.git` API v1), multi-repo resolution, diffs and recent log. |
| `src/config.ts` | Reading and validating settings (`generateCommit.*`) and SecretStorage keys. |
| `src/providers/` | Single interface + implementations (details below). |
| `src/prompt.ts` | System/user prompt assembly and model output normalization (pure). |
| `src/diffFilter.ts` | Per-file diff splitting, exclusions (lockfile, binary, minified, large) and truncation (pure). |
| `src/secretsScan.ts` | Secret patterns, diff scanning and text redaction (pure). |
| `src/cliDetect.ts` | CLI binary resolution (PATH, login shell, common paths). |
| `src/cliRun.ts` | CLI execution with stdin, timeout, process-group cancellation and error classification. |
| `src/http.ts` | HTTPS-only JSON POST with timeout, cancellation and HTTP error mapping. |
| `src/log.ts` | Metadata-only logging, with defensive secret redaction. |
| `src/settingsModel.ts` | Pure panel model: key whitelist, value validation and helpers. |
| `src/settingsPanel.ts` | Settings panel WebviewView (inline form in the sidebar). |
| `src/modelCatalog.ts` | HTTP model catalog: fetches `/models` from each provider, TTL cache and a format-tolerant parser. |
| `src/cliCatalog.ts` | Codex CLI catalog: reads `codex debug models` (models + per-model reasoning levels), TTL cache and static fallback. |
| `src/providersRuntime.ts` | Provider factories, availability, key status and key validation. |
| `media/` | Panel JS/CSS (the only resources the webview CSP allows). |
| `src/typings/git.d.ts` | Official Git API typings, vendored from the `microsoft/vscode` 1.126.0 tag. |

## Activation flow

1. `activate()` creates the "Generate Commit" Output Channel.
2. Registers the commands (`generateCommit.generate` and `.settings`, which
   focuses the panel).
3. Registers the `SettingsPanelProvider` in the `generateCommit.settingsView`
   view (Activity Bar panel), a sandboxed WebviewView hosting the settings
   form.

Activation is truly lazy: `activationEvents` is empty because VS Code
activates the extension automatically when any contributed command is
invoked (behavior since 1.74). Nothing runs in the background and there is
no telemetry.

## Generation flow (`generateCommit.generate`)

1. **Repository**: the command argument carries `rootUri` (`scm/inputBox`
   menu); from the Command Palette, no argument. Resolves via
   `api.getRepository(uri)`; with a single repo, uses it directly; when
   ambiguous, opens a QuickPick.
2. **Diff**: `repo.diff(true)` (staged). Empty → the `unstagedFallback`
   setting (`ask`/`always`/`never`) decides whether to use
   `repo.diff(false)`. Failure (unborn HEAD) → message guiding the initial
   commit.
3. **Filter**: per-file split and exclusion of lockfiles, binaries,
   minified files and chunks above `maxFileSizeKB` (measured in UTF-8
   bytes). Everything excluded → informs and aborts.
4. **Secret scanning**: `scanDiff` over the kept files. With findings, a
   modal lists file + type (never the value) and requires an explicit
   "Send Anyway" to proceed.
5. **Truncation**: `maxDiffChars` cut at file boundaries, with an explicit
   marker in the prompt when it truncates.
6. **Prompt**: system (Conventional Commits + language + custom
   instructions) and user (recent commits as style reference, truncation
   notice, diff).
7. **Provider**: reads the availability of all of them in parallel
   (`Promise.all`), picks the configured one if available, otherwise the
   first available in registry order (CLIs first). None available → offers
   the guided setup flow.
8. **Generation**: cancellable `withProgress`; the token aborts the
   `AbortController`, which cancels the HTTP fetch or kills the CLI
   process group.
9. **Writing**: per-repository generation guard (starting another aborts
   the previous one; only the latest writes). If the diff was staged, it is
   re-read and compared before writing; if it changed, the result is
   discarded. The final message goes through `parseModelOutput` (extracts
   the code block, strips labels and quotes) and into
   `repository.inputBox.value`.

The extension **never** runs a commit. The only write is to the input box,
for human review.

## Provider architecture

Single interface (`src/types.ts`):

```ts
interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: 'http' | 'cli';
  isAvailable(): Promise<boolean>;
  generate(req: GenerateRequest): Promise<string>;
}
```

- `src/providers/registry.ts` — metadata, display/fallback order and
  provider choice (`resolveProviderChoice`, pure and tested).
- `src/providers/openrouter.ts` — OpenAI-compatible client
  (`/chat/completions`).
- `src/providers/anthropic.ts` — generic Messages API client
  (`<baseUrl>/v1/messages`), used by the Kimi, GLM and MiniMax presets and
  by the custom endpoint (`x-api-key` or `bearer` auth per preset/setting).
- `src/providers/claudeCli.ts` / `codexCli.ts` — CLIs detected on PATH
  (with session cache), prompt via stdin, no key needed.

`ProviderError` carries a `kind` (`auth`, `billing`, `rateLimit`,
`server`, `network`, `timeout`, `cancelled`, `cli`, `invalidResponse`,
`unknown`) that drives distinct, actionable error messages in the UI.

### Adding a new provider

1. Create `src/providers/myProvider.ts` exposing a factory that returns a
   `Provider` object (reuse `postJson` for HTTP or `runCli` for CLI).
2. Register the `ProviderMeta` in `registry.ts` (id, label, kind, whether
   it needs a key, default model, key console URL).
3. Add the id to the `ProviderId` union in `types.ts`, to the defaults in
   `config.ts` and to the settings in `package.json`
   (`generateCommit.<id>.model`, etc.).
4. Instantiate it in `createProviders` (`src/providersRuntime.ts`).
5. Tests: pure parser/builders in `tests/providers.test.ts` and the
   `generate` flow with mocks in `tests/providers-generate.test.ts`.

## Build and tests

- **Bundle**: esbuild (`esbuild.config.mjs`) produces `dist/extension.js`
  (CJS, minified, `vscode` external). VS Code loads only this file.
- **Tests**: Vitest, pure modules only (no `vscode` import). Modules with
  side effects (`runCli`, `postJson`) have behavioral tests with a real
  child process and stubbed fetch; providers are tested with `vi.mock` of
  the transport layers.
- **Lint/format**: Biome 2 (`biome check`).
- **Packaging**: `@vscode/vsce` (`pnpm package`), with `.vscodeignore`
  limiting the contents to `dist/`, `images/`, manifest, README and
  LICENSE.
