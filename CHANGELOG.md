# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui, seguindo o
espírito do [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
versionamento semântico.

## [Unreleased]

### Adicionado

- Sugestões de modelo ao vivo no campo Model do painel: a lista completa é
  buscada no endpoint de modelos de cada provider (cache de 1 hora) e
  modelos novos aparecem automaticamente no dropdown, com a opção "Custom…"
  para digitar um ID fora da lista.

## [0.1.0] - 2026-08-02

Primeira versão funcional.

### Adicionado

- Geração de mensagem de commit (Conventional Commits) a partir do diff
  staged, escrita na caixa de commit do Source Control para revisão, sem
  nunca commitar automaticamente.
- Botão com ícone de estrelinhas na caixa de commit (menu `scm/inputBox`,
  API proposta `contribSourceControlInputBoxMenu`, habilitável via
  `--enable-proposed-api=everton.generate-commit`), com fallback pela
  Command Palette.
- Providers plugáveis: OpenRouter, Anthropic-compatible (presets Kimi,
  GLM, MiniMax e endpoint custom com auth `x-api-key` ou `bearer`), Claude
  Code CLI e Codex CLI (ambos sem chave, usando o login do próprio CLI).
- Painel Generate Commit na Activity Bar: formulário inline na sidebar com
  todas as configurações (provider, modelo, chaves de API com status,
  idioma, limites, comportamento, timeout e seções avançadas por provider),
  validado e sem janelas flutuantes.
- Segurança: varredura local de segredos com bloqueio por padrão (opt-in
  por ocorrência), exclusão de lockfiles/binários/minificados/arquivos
  grandes, truncamento sinalizado no prompt, chaves somente em
  SecretStorage, somente HTTPS, zero telemetria, log apenas de metadados
  com redação de segredos, cancelamento que mata o grupo de processos do
  CLI e guarda contra gerações concorrentes e diff obsoleto.
- Multi-repo com QuickPick de escolha quando ambíguo; suporte a diff
  unstaged configurável (`ask`/`always`/`never`).
- Erros de provider distintos e acionáveis (autenticação, créditos, rate
  limit, servidor, rede, timeout).
- Documentação: README, `docs/ARCHITECTURE.md`, `SECURITY.md`, tabela de
  verificações datadas (endpoints, model IDs e flags verificados em fontes
  oficiais em 2026-08-02).

[0.1.0]: https://github.com/everton-dgn/generate-commit-extension/releases/tag/v0.1.0
