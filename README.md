# Generate Commit with AI

Extensão para VS Code e VSCodium que gera mensagens de commit no formato
[Conventional Commits](https://www.conventionalcommits.org/pt-br/) a partir do
diff staged, usando o provedor de IA da sua escolha. A mensagem é escrita na
caixa de commit do painel Source Control para você revisar e editar. A
extensão **nunca commita por você**.

## O botão na caixa de commit (leia antes)

O ponto de contribuição `scm/inputBox` (o mesmo que o Copilot usa para o
botão de sparkle dentro da caixa de commit) é uma **API proposta**, não
estável, verificado em 2026-08-02 no código-fonte do VS Code 1.131.0
(`menusExtensionPoint.ts`, proposta `contribSourceControlInputBoxMenu`, em
vigor desde o VS Code 1.85). Extensões instaladas via VSIX só o usam quando o
editor é aberto com o flag da proposta:

```bash
codium --enable-proposed-api=everton.generate-commit
```

Sem esse flag, o menu `scm/inputBox` é rejeitado silenciosamente e a extensão
segue funcionando pela Command Palette (`Generate Commit: Generate Commit
Message`) e pelo painel Generate Commit na barra lateral esquerda.

Em modo de desenvolvimento (F5), a proposta funciona sem flags.

## Funcionalidades

- Gera a mensagem a partir do diff staged; se não houver nada staged, oferece
  usar o diff unstaged (comportamento configurável).
- Multi-repo: usa o repositório do botão clicado; com um único repo, usa
  direto; ambíguo, abre QuickPick.
- Cancelamento: o botão de cancelar na notificação de progresso aborta a
  chamada HTTP ou mata o processo do CLI.
- Troca rápida de provider/modelo pelo comando `Generate Commit: Switch
  Provider / Model`.
- Painel **Generate Commit** na barra lateral esquerda (ícone de
  estrelinhas): todas as configurações em um formulário inline na própria
  sidebar, com valor atual de cada uma (provider, chaves com status, idioma,
  limites, prompt customizado, fallback, timeout e seções avançadas por
  provider), sem nenhuma janela flutuante e sem editar JSON.
- **Sugestões de modelo ao vivo**: o campo Model traz a lista atual do
  provider (buscada no endpoint de modelos dele a cada hora, com fallback
  silencioso para texto livre). Modelo novo lançado pelo provider aparece
  sozinho nas sugestões; texto livre continua valendo.
- Primeiro uso guiado: sem nenhum provider disponível, o fluxo abre a
  configuração (escolha do provider, chave mascarada, validação rápida,
  salvamento no Secret Storage).
- Arquitetura plugável: um provider = uma implementação da interface
  `Provider` em `src/providers/`.

## Instalação

Baixe o `.vsix` e instale por um dos caminhos:

1. Menu `Extensions` → `...` → `Install from VSIX...`;
2. Terminal:

```bash
codium --install-extension generate-commit-0.1.0.vsix
```

## Providers

| Provider        | Tipo | Endpoint / binário default                        | Modelo default             | Onde obter a chave |
|-----------------|------|---------------------------------------------------|----------------------------|--------------------|
| Claude Code CLI | CLI  | binário `claude` no PATH                          | default do CLI             | não precisa (usa seu login do Claude Code) |
| Codex CLI       | CLI  | binário `codex` no PATH                           | default do CLI             | não precisa (usa seu login do Codex) |
| OpenRouter      | HTTP | `https://openrouter.ai/api/v1`                    | `google/gemini-2.5-flash-lite` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Kimi (Moonshot) | HTTP | `https://api.moonshot.ai/anthropic`               | `kimi-k2.6`                | [platform.kimi.ai/console/api-keys](https://platform.kimi.ai/console/api-keys) |
| GLM (z.ai)      | HTTP | `https://api.z.ai/api/anthropic`                  | `glm-4.5-air`              | [z.ai/manage-apikey](https://z.ai/manage-apikey/apikey-list) |
| MiniMax         | HTTP | `https://api.minimax.io/anthropic`                | `MiniMax-M2.5-highspeed`   | [platform.minimax.io](https://platform.minimax.io/user-center/basic-information/interface-key) |
| Anthropic (custom) | HTTP | `https://api.anthropic.com` (editável)         | `claude-haiku-4-5-20251001` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

Notas:

- Com o `claude` instalado e logado, a extensão funciona **sem configurar
  nada** (é o provider default).
- Providers de CLI indisponíveis aparecem na seção "Unavailable" do QuickPick
  com a indicação "CLI not found".
- A detecção de CLI procura no PATH, depois no shell de login (resolve o PATH
  mínimo de apps gráficos no macOS) e por fim em diretórios comuns
  (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, entre outros).
- Kimi: evite `kimi-k2.7-code`, que rejeita requisições sem thinking; o
  default `kimi-k2.6` aceita requisições simples (verificado em 2026-08-02).
- China: Kimi tem host `https://api.moonshot.cn/anthropic` e MiniMax
  `https://api.minimaxi.com/anthropic` (editáveis nas settings).
- O provider "Anthropic (custom)" cobre qualquer endpoint compatível com a
  Messages API: edite base URL, modelo e o estilo de autenticação
  (`x-api-key` ou `bearer`).
- As sugestões do campo Model vêm do endpoint de modelos de cada provider
  (`/models`, verificado em 2026-08-02: OpenRouter sem chave; Kimi, GLM,
  MiniMax e Anthropic com a chave configurada), com cache de 1 hora. Se a
  busca falhar (sem chave, rede, endpoint custom sem listagem), o campo
  segue texto livre sem erro. Claude CLI sugere os aliases estáticos
  (`fable`, `opus`, `sonnet`, `haiku`); Codex CLI segue texto livre.

### Configurar uma chave de API

No painel **Generate Commit** da barra lateral, seção **API keys**: cole a
chave do provider (campo de senha, nunca pré-preenchido), clique em Save e
aguarde a validação rápida. O status fica visível ao lado do provider
(configured/not set). A chave fica em `context.secrets` (Secret Storage do
VS Code), **nunca** em `settings.json` e nunca renderizada no painel.

## Settings

Todas as opções abaixo também podem ser alteradas pela interface, no painel
**Generate Commit** da barra lateral (formulário inline com validação; o
comando `Generate Commit: Settings` abre o painel), além da tela de
Settings do editor (filtre por `generateCommit`).

| Setting | Default | Descrição |
|---------|---------|-----------|
| `generateCommit.provider` | `claudeCli` | Provider ativo (`claudeCli`, `codexCli`, `openrouter`, `kimi`, `glm`, `minimax`, `anthropicCustom`). Indisponível cai para o primeiro disponível. |
| `generateCommit.language` | `en` | Idioma da mensagem (`en`, `pt-BR`, `es`, ...). |
| `generateCommit.maxDiffChars` | `50000` | Teto de caracteres do diff enviado; trunca na fronteira de arquivo e sinaliza no prompt. |
| `generateCommit.maxFileSizeKB` | `50` | Arquivos cujo chunk de diff excede este tamanho são excluídos. |
| `generateCommit.includeRecentCommits` | `true` | Envia os 10 commits recentes como referência de estilo. |
| `generateCommit.customPrompt` | `""` | Instruções extras anexadas ao system prompt. |
| `generateCommit.unstagedFallback` | `ask` | Sem diff staged: perguntar, sempre usar unstaged ou nunca. |
| `generateCommit.timeoutSeconds` | `60` | Timeout de requests HTTP e execuções de CLI. |
| `generateCommit.<provider>.model` | ver tabela | Modelo por provider. |
| `generateCommit.<provider>.baseUrl` | ver tabela | Base URL por provider HTTP (somente HTTPS). |
| `generateCommit.anthropicCustom.authHeader` | `x-api-key` | Estilo de auth do endpoint custom (`x-api-key` ou `bearer`). |
| `generateCommit.claudeCli.effort` | `low` | `--effort` do Claude Code (`low` a `max`, vazio = default do CLI). |
| `generateCommit.codexCli.effort` | `low` | `model_reasoning_effort` do Codex. Os valores aceitos dependem do modelo (verificado em 2026-08-02 no modelo default: `none`, `low`, `medium`, `high`, `xhigh`, `max`; a referência de config também lista `minimal`). Vazio = default do CLI. |

## Segurança

- **Varredura de segredos antes de enviar**: chaves (`sk-`, `sk-or-`,
  `sk-ant-`, `ghp_`, `github_pat_`, `AKIA`/`ASIA`, `xox...`, `AIza...`),
  JWT, blocos PEM de chave privada, credenciais em URLs, arquivos `.env*` e
  keystores (`.jks`, `.keystore`, `.p12`, `.pfx`). Ao detectar, a extensão
  **bloqueia** e lista arquivo + tipo de segredo (nunca o valor); enviar é
  sempre uma decisão explícita sua, por ocorrência.
- **Exclusões de diff**: lockfiles (`pnpm-lock.yaml`, `package-lock.json`,
  `yarn.lock`, `bun.lock`, `bun.lockb`, `deno.lock`), binários, minificados
  (`*.min.js/css`) e arquivos acima do limite de tamanho.
- **Truncamento** no teto configurável, com aviso dentro do prompt.
- **Somente HTTPS**; timeout configurável (default 60 s).
- **Log só com metadados** (provider, modelo, latência, tamanho do diff) no
  Output Channel "Generate Commit". Diff, chaves e respostas nunca são
  logados; stderr de CLIs **nunca** é exibido ou logado cru (é classificado
  por uma lista fechada de assinaturas, ex.: "not logged in"), e os detalhes
  de erro HTTP passam pela mesma redação de segredos do scanner antes de
  chegar à UI.
- **Chaves fora do alcance de workspaces**: `*.baseUrl` e
  `anthropicCustom.authHeader` têm escopo `machine`, então um
  `.vscode/settings.json` de repositório não pode redirecionar suas chaves
  para um host de terceiros.
- **Cancelamento robusto**: o botão de cancelar aborta a chamada HTTP ou mata
  o **grupo de processos** do CLI (SIGTERM, depois SIGKILL), incluindo
  subprocessos filhos.
- **Concorrência e consistência**: uma geração por repositório (iniciar outra
  aborta a anterior e só a mais recente escreve na caixa); o diff staged é
  relido antes de preencher a caixa e o resultado é descartado se o stage
  mudou durante a geração.
- **Zero telemetria** e zero chamadas a serviços além do provider escolhido.
- **Webview do painel travada**: o formulário de configurações roda numa
  WebviewView com CSP `default-src 'none'` (só arquivos locais do bundle,
  sem conteúdo remoto, sem script/estilo inline), valores renderizados via
  DOM seguro (sem `innerHTML` com dados do usuário), mensagens validadas
  contra uma whitelist de chaves antes de qualquer `config.update` e
  segredos nunca renderizados no DOM (campos de senha só escrevem).
- Sem a API `vscode.lm` (que depende do Copilot e não existe no VSCodium).

## Desenvolvimento

```bash
pnpm install
pnpm watch        # bundle em dist/ com watch
# F5: abre o Extension Development Host (proposta scm/inputBox habilitada)
```

Scripts: `pnpm test` (Vitest), `pnpm typecheck` (tsc), `pnpm lint` (Biome),
`pnpm build` (esbuild), `pnpm package` (gera o `.vsix` com `@vscode/vsce`).

## Verificações de fonte oficial (2026-08-02)

| Item | Valor verificado | Fonte |
|------|------------------|-------|
| `scm/inputBox` é API proposta | `contribSourceControlInputBoxMenu`, desde o VS Code 1.85, ainda proposta no 1.131 | [menusExtensionPoint.ts](https://raw.githubusercontent.com/microsoft/vscode/1.131.0/src/vs/workbench/services/actions/common/menusExtensionPoint.ts) |
| Argumentos do comando no `scm/inputBox` | `(rootUri, context, token)`, não `SourceControl` | [scmInput.ts](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/scm/browser/scmInput.ts) |
| Git API v1 | `getAPI(1)`, `Repository.diff(cached?)`, `inputBox.value`, `log(options?)` | [git.d.ts](https://raw.githubusercontent.com/microsoft/vscode/1.126.0/extensions/git/src/api/git.d.ts) |
| VSCodium atual | 1.126.04524 (VS Code 1.126.0) | [releases](https://github.com/VSCodium/vscodium/releases/latest) |
| OpenRouter endpoint | `POST https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer` | [docs/quickstart](https://openrouter.ai/docs/quickstart) |
| Modelos OpenRouter baratos | `google/gemini-2.5-flash-lite`, `openai/gpt-5-nano`, `meta-llama/llama-3.2-3b-instruct`, `mistralai/mistral-small-24b-instruct-2501`, `openai/gpt-4o-mini` | [api/v1/models](https://openrouter.ai/api/v1/models) |
| Anthropic Messages API | `POST /v1/messages`; headers `x-api-key` + `anthropic-version: 2023-06-01`; texto em `content[i].text` | [platform.claude.com/docs](https://platform.claude.com/docs/en/api/messages) |
| Kimi endpoint | `https://api.moonshot.ai/anthropic` (China: `api.moonshot.cn/anthropic`) | [platform.kimi.ai/docs](https://platform.kimi.ai/docs/guide/claude-code-kimi) |
| Kimi modelos | `kimi-k3`, `kimi-k2.7-code` (exige thinking), `kimi-k2.6`, entre outros | [platform.kimi.ai/docs/models](https://platform.kimi.ai/docs/models) |
| GLM endpoint | `https://api.z.ai/api/anthropic` | [docs.z.ai](https://docs.z.ai/devpack/tool/claude) |
| GLM modelos | `glm-5.2`, `glm-4.7`, `glm-4.5-air` | [docs.z.ai](https://docs.z.ai/devpack/tool/claude) |
| MiniMax endpoint | `POST https://api.minimax.io/anthropic/v1/messages`; auth Bearer **ou** `x-api-key`; `anthropic-version` não exigido | [platform.minimax.io/docs](https://platform.minimax.io/docs) |
| MiniMax modelos | `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.5`, `MiniMax-M2.1`, `MiniMax-M2` (+ variantes `-highspeed`) | [platform.minimax.io/docs](https://platform.minimax.io/docs) |
| Claude Code flags | `-p`, `--tools`, `--model`, `--effort (low..max)`, `--output-format`, `--no-session-persistence`; **não existe** flag `--fast` na 2.1.220 | `claude --help` local (2.1.220) |
| Codex flags | `codex exec`, `--model`, `--sandbox read-only`, `--skip-git-repo-check`, `--ephemeral`, `--output-last-message`, `--config k=v` | `codex --help` / `codex exec --help` locais (0.146.0) |
| Codex approval/effort | `approval_policy="never"` e `model_reasoning_effort` via `-c`; o flag `--ask-for-approval` apareceu e desapareceu do `--help` na mesma versão (superfície dinâmica), então a política vai pela chave de config | [config-reference](https://developers.openai.com/codex/config-reference) + verificação local em 2026-08-02 |

Ressalvas registradas pela pesquisa: Kimi e GLM não documentam o path literal
(`/v1/messages`) nem os headers HTTP crus fora do contexto do Claude Code
(que autentica via `ANTHROPIC_AUTH_TOKEN`, enviado como `Authorization:
Bearer`); por isso os presets deles usam Bearer. MiniMax é o único com o path
confirmado literalmente na especificação OpenAPI oficial.

## Limitações conhecidas

- Providers de CLI foram desenhados para macOS/Linux (detecção via
  `command -v` e shell de login); no Windows, use um provider HTTP.
- A varredura de segredos é heurística: falsos positivos são possíveis (a
  decisão final de envio é sempre sua) e nenhuma lista de padrões cobre
  todos os formatos de chave existentes.
- Repositórios sem nenhum commit (HEAD unborn) não têm diff staged legível
  pela API do Git; faça o commit inicial antes.

## Licença

MIT. Veja o arquivo `LICENSE` na raiz do repositório.
