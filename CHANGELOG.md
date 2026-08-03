# Changelog

All notable changes to this project are documented here, following the
spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
semantic versioning.

## [Unreleased]

### Added

- `generateCommit.disableThinking`: disables reasoning on CLI providers for
  lower latency (Codex with `model_reasoning_effort="none"`, Claude CLI
  with `MAX_THINKING_TOKENS=0`). The Effort dropdown is disabled in the
  panel while the toggle is on.
- The "Custom prompt instructions" field is now a vertically resizable
  multiline textarea.
- Live model suggestions in the panel's Model field: the full list is
  fetched from each provider's models endpoint (1-hour cache) and new
  models appear automatically in the dropdown, with a "Custom…" option to
  type an ID outside the list.
- Codex CLI: live model catalog via `codex debug models` and an Effort
  dropdown with the reasoning levels of the selected model (1-hour cache;
  static fallback when the CLI does not respond).
- Claude CLI: Model dropdown with the `fable`, `opus`, `sonnet` and
  `haiku` aliases, and an Effort dropdown with the 5 `--effort` levels.

### Changed

- Settings panel: the active provider's fields (Model, Effort, Base URL,
  Auth header) live in the Provider section; the "Advanced per provider"
  section was removed.
- The language field became a dropdown with a language list plus a
  "Custom…" option (previously: free text with a datalist).
- Panel selects with their own SVG arrow, 5px border-radius and adjusted
  padding.

## [0.1.0] - 2026-08-02

First functional version.

### Added

- Commit message generation (Conventional Commits) from the staged diff,
  written into the Source Control commit box for review, never committing
  automatically.
- Button with a sparkles icon in the commit box (`scm/inputBox` menu,
  proposed API `contribSourceControlInputBoxMenu`, enabled via
  `--enable-proposed-api=everton.generate-commit`), with a Command Palette
  fallback.
- Pluggable providers: OpenRouter, Anthropic-compatible (Kimi, GLM, MiniMax
  presets and a custom endpoint with `x-api-key` or `bearer` auth), Claude
  Code CLI and Codex CLI (both keyless, using the CLI's own login).
- Generate Commit panel on the Activity Bar: inline form in the sidebar
  with every setting (provider, model, API keys with status, language,
  limits, behavior, timeout and advanced per-provider sections), validated
  and with no floating windows.
- Security: local secret scanning with blocking by default (per-occurrence
  opt-in), exclusion of lockfiles/binaries/minified/large files, truncation
  flagged in the prompt, keys only in SecretStorage, HTTPS only, zero
  telemetry, metadata-only logging with secret redaction, cancellation that
  kills the CLI process group, and guards against concurrent generations
  and stale diffs.
- Multi-repo with a selection QuickPick when ambiguous; configurable
  unstaged diff support (`ask`/`always`/`never`).
- Distinct, actionable provider errors (authentication, credits, rate
  limit, server, network, timeout).
- Documentation: README, `docs/ARCHITECTURE.md`, `SECURITY.md`, dated
  verification table (endpoints, model IDs and flags verified against
  official sources on 2026-08-02).

[0.1.0]: https://github.com/everton-dgn/generate-commit-extension/releases/tag/v0.1.0
