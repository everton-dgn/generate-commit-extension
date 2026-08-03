# Security policy and threat model

## Reporting vulnerabilities

Open a private report (GitHub Security Advisories) or contact the maintainer
directly. Do not open a public issue describing the problem before it is
fixed.

## Threat model

The extension sends **your diff content** to the AI provider you chose. That
is the only data that leaves your machine, and these are the protection
layers:

### 1. Secret scanning before any send

- Patterns: keys (`sk-`, `sk-or-`, `sk-ant-`, `ghp_`/`gho_`/...,
  `github_pat_`, `AKIA`/`ASIA`, `xox[baprs]-`, `AIza`), JWTs, private key
  PEM blocks, credentials embedded in URLs (`https://user:pass@host`),
  `.env*` files and keystores (`.jks`, `.keystore`, `.p12`, `.pfx`).
- On detection: **blocked by default**. A modal lists file + secret type
  (the value is never shown) and sending only happens with an explicit
  "Send Anyway", per occurrence.
- Honest limitation: scanning is heuristic. No list covers every key
  format, and false positives are possible. Review what goes into the
  stage.

### 2. Minimizing what is sent

- Lockfiles, binaries, minified files and files whose diff chunk exceeds
  `generateCommit.maxFileSizeKB` × 1024 bytes are excluded from the diff.
- The total diff is truncated at `generateCommit.maxDiffChars`, at file
  boundaries, with an explicit notice in the prompt.
- Recent commits (subjects only) are only included if
  `includeRecentCommits` is on.

### 3. API keys

- Stored **only** in `context.secrets` (VS Code SecretStorage, backed by
  the operating system keychain).
- Never in `settings.json`, never in logs, never in error messages.
- **`machine` scope on sensitive URLs**: the `*.baseUrl` and
  `anthropicCustom.authHeader` settings are declared with `machine` scope,
  so values coming from a workspace's `.vscode/settings.json` are ignored.
  Without this, a malicious repository could point the base URL to a
  third-party-controlled host and receive your key on the next call
  (generation or model catalog).
- The model catalog (`GET /models` of each provider) sends the key only to
  the provider's own endpoint, with the header its contract requires
  (MiniMax lists models behind `X-Api-Key`, even though the messages
  endpoint accepts Bearer; verified on 2026-08-02).
- Key validation uses a minimal request (`max_tokens: 8`). An
  authentication failure invalidates the key; non-authentication responses
  from the endpoint (rate limit, credits, server error, rejected payload)
  confirm the key was accepted; failures with no response (network,
  timeout) leave the key unverified and prevent saving through the panel
  (with an explicit "Save anyway" option, logged as unverified).

### 4. Transport and network

- HTTPS only: non-HTTPS base URLs are rejected at config read time and at
  the HTTP layer (`postJson` refuses before fetch).
- Configurable timeout (default 60 s) on requests and CLI executions.
- **Zero telemetry** and zero calls to services other than the active
  provider.
- No `vscode.lm` API.

### 5. Logs and error messages

- Output Channel with metadata only (provider, model, latency, sizes,
  counts). Every value goes through defensive secret redaction before being
  written.
- HTTP error details go through the same redaction before reaching the UI.
- CLI stderr is **never** displayed or logged raw: it is classified against
  a closed list of signatures (e.g. "not logged in", "rate limited"),
  because it may echo the prompt (the diff) or secrets.
- Invalid URLs are logged by host only (credentials embedded in userinfo
  never reach the log).

### 6. CLI execution

- Binaries resolved by validated name (`[A-Za-z0-9._-]+`) passed as a
  positional argument to the shell (no interpolation into a command
  string).
- Spawn without a shell (`args` as an array), cwd at the repository root.
- Cancellation/timeout kills the **process group** (`detached` spawn +
  group signal), escalating SIGTERM → SIGKILL.
- CLI providers neither receive nor require API keys (they use the CLI's
  own login).
- Environment variables from nested sessions (`CLAUDECODE`,
  `CLAUDE_CODE_ENTRYPOINT`) are removed from the `claude` environment.

### 7. Consistency and abuse

- One generation per repository: starting another aborts the previous one;
  late responses from old runs are discarded.
- The staged diff is re-read before writing the result into the commit box;
  if the stage changed during generation, the result is discarded.
- API errors mapped by type (401/403, 402, 429 with `retry-after`, 5xx,
  network, timeout) with distinct messages and suggested actions.

### 8. Settings panel webview

The extension's only webview is the settings form in the sidebar, isolated
like this:

- **Strict CSP**: `default-src 'none'` with `script-src` and `style-src`
  limited to the bundle's local files (`media/`). No remote content, no
  inline script or style, no external images or fonts.
- **XSS-free by construction**: the static HTML interpolates no data at
  all; state flows through `postMessage` and is rendered only with safe DOM
  APIs (`textContent`, `createElement`, `value` properties), never
  `innerHTML` with user data.
- **Never-trusted messages**: every write coming from the webview goes
  through the `PANEL_SETTINGS` whitelist (`validateSettingValue`), which
  rejects unknown keys and inherited members (`__proto__` and the like via
  `Object.hasOwn`), and validates types, minimums, enums and the HTTPS
  rule.
- **Secrets out of the DOM**: API key fields are `type=password`, never
  pre-filled; the extension only returns status (configured/invalid), and
  the value goes straight to SecretStorage after validation.
- Local scope: `localResourceRoots` restricted to the bundle's `media/`
  directory.

## Out of scope (accepted threats)

- Compromise of the AI provider itself or of the TLS chain up to it.
- Secrets in formats outside the patterns known to the scanner.
- A user who explicitly chooses "Send Anyway" in the secrets modal.
