# Arquitetura

Este documento descreve como a extensão é organizada por dentro: o fluxo de
ativação, o fluxo de geração de mensagens, a arquitetura plugável de
providers e as decisões estruturais. Para o modelo de segurança, veja
`SECURITY.md` na raiz.

## Visão geral dos módulos

| Arquivo | Papel |
|---------|-------|
| `src/extension.ts` | Ativação: Output Channel, comandos e o painel de settings (WebviewView). |
| `src/commands.ts` | Comando `generate` e o orquestrador do fluxo de geração; ações de erro abrem o painel. |
| `src/git.ts` | Acesso à extensão Git built-in (`vscode.git` API v1), resolução multi-repo, diffs e log recente. |
| `src/config.ts` | Leitura e validação das settings (`generateCommit.*`) e chaves do SecretStorage. |
| `src/providers/` | Interface única + implementações (detalhes abaixo). |
| `src/prompt.ts` | Montagem de system/user prompt e normalização da saída do modelo (puras). |
| `src/diffFilter.ts` | Split do diff por arquivo, exclusões (lockfile, binário, minificado, grande) e truncamento (puras). |
| `src/secretsScan.ts` | Padrões de segredos, varredura do diff e redação de texto (puras). |
| `src/cliDetect.ts` | Resolução de binários de CLI (PATH, shell de login, caminhos comuns). |
| `src/cliRun.ts` | Execução de CLI com stdin, timeout, cancelamento por grupo de processos e classificação de erros. |
| `src/http.ts` | POST JSON somente HTTPS com timeout, cancelamento e mapeamento de erros HTTP. |
| `src/log.ts` | Log somente de metadados, com redação defensiva de segredos. |
| `src/settingsModel.ts` | Modelo puro do painel: whitelist de chaves, validação de valores e helpers. |
| `src/settingsPanel.ts` | WebviewView do painel de configurações (formulário inline na sidebar). |
| `src/modelCatalog.ts` | Catálogo de modelos HTTP: busca `/models` de cada provider, cache com TTL e parser tolerante de formatos. |
| `src/cliCatalog.ts` | Catálogo do Codex CLI: lê `codex debug models` (modelos + níveis de reasoning por modelo), cache com TTL e fallback estático. |
| `src/providersRuntime.ts` | Factories dos providers, disponibilidade, status de chaves e validação de chave. |
| `media/` | JS/CSS do painel (os únicos recursos que a CSP da webview permite). |
| `src/typings/git.d.ts` | Tipagens oficiais da Git API, vendorizadas da tag 1.126.0 do `microsoft/vscode`. |

## Fluxo de ativação

1. `activate()` cria o Output Channel "Generate Commit".
2. Registra os comandos (`generateCommit.generate` e `.settings`, que foca
   o painel).
3. Registra o `SettingsPanelProvider` na view `generateCommit.settingsView`
   (painel da Activity Bar), uma WebviewView sandboxed que hospeda o
   formulário de configurações.

A ativação é preguiça de verdade: `activationEvents` está vazio porque o VS
Code ativa a extensão automaticamente quando qualquer comando contribuído é
invocado (comportamento desde 1.74). Nada roda em segundo plano e não há
telemetria.

## Fluxo de geração (`generateCommit.generate`)

1. **Repositório**: o argumento do comando traz `rootUri` (menu
   `scm/inputBox`); pela Command Palette, sem argumento. Resolve via
   `api.getRepository(uri)`; com um único repo, usa direto; ambíguo, abre
   QuickPick.
2. **Diff**: `repo.diff(true)` (staged). Vazio → setting
   `unstagedFallback` (`ask`/`always`/`never`) decide se usa
   `repo.diff(false)`. Falha (HEAD unborn) → mensagem orientando o commit
   inicial.
3. **Filtro**: split por arquivo e exclusão de lockfiles, binários,
   minificados e chunks acima de `maxFileSizeKB` (medido em bytes UTF-8).
   Tudo excluído → informa e aborta.
4. **Varredura de segredos**: `scanDiff` sobre os arquivos mantidos. Com
   achados, modal lista arquivo + tipo (nunca o valor) e exige "Send
   Anyway" explícito para prosseguir.
5. **Truncamento**: `maxDiffChars` cortado na fronteira de arquivo, com
   marcação explícita no prompt quando trunca.
6. **Prompt**: system (Conventional Commits + idioma + instruções
   customizadas) e user (commits recentes como referência de estilo, aviso
   de truncamento, diff).
7. **Provider**: lê a disponibilidade de todos em paralelo
   (`Promise.all`), escolhe o configurado se disponível, senão o primeiro
   disponível na ordem do registry (CLIs primeiro). Nenhum disponível →
   oferece o fluxo guiado de configuração.
8. **Geração**: `withProgress` cancelável; o token aborta o
   `AbortController`, que cancela o fetch HTTP ou mata o grupo de
   processos do CLI.
9. **Escrita**: guarda de geração por repositório (iniciar outra aborta a
   anterior; só a mais recente escreve). Se o diff era staged, ele é
   relido e comparado antes de escrever; se mudou, o resultado é
   descartado. A mensagem final passa por `parseModelOutput` (extrai bloco
   de código, remove rótulos e aspas) e vai para `repository.inputBox.value`.

A extensão **nunca** executa commit. A única escrita é no input box, para
revisão humana.

## Arquitetura de providers

Interface única (`src/types.ts`):

```ts
interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: 'http' | 'cli';
  isAvailable(): Promise<boolean>;
  generate(req: GenerateRequest): Promise<string>;
}
```

- `src/providers/registry.ts` — metadados, ordem de exibição/fallback e a
  escolha do provider (`resolveProviderChoice`, pura e testada).
- `src/providers/openrouter.ts` — cliente OpenAI-compatible
  (`/chat/completions`).
- `src/providers/anthropic.ts` — cliente genérico da Messages API
  (`<baseUrl>/v1/messages`), usado pelos presets Kimi, GLM, MiniMax e pelo
  endpoint custom (auth `x-api-key` ou `bearer` por preset/setting).
- `src/providers/claudeCli.ts` / `codexCli.ts` — CLIs detectados no PATH
  (com cache de sessão), prompt via stdin, sem necessidade de chave.

`ProviderError` carrega um `kind` (`auth`, `billing`, `rateLimit`,
`server`, `network`, `timeout`, `cancelled`, `cli`, `invalidResponse`,
`unknown`) que dirige mensagens de erro distintas e acionáveis na UI.

### Adicionar um provider novo

1. Criar `src/providers/meuProvider.ts` expondo uma factory que retorna um
   objeto `Provider` (reaproveite `postJson` para HTTP ou `runCli` para
   CLI).
2. Registrar o `ProviderMeta` em `registry.ts` (id, label, kind, se precisa
   de chave, modelo default, URL do console de chaves).
3. Adicionar o id ao union `ProviderId` em `types.ts`, aos defaults em
   `config.ts` e às settings em `package.json`
   (`generateCommit.<id>.model`, etc.).
4. Instanciar em `createProviders` (`src/providersRuntime.ts`).
5. Testes: parser/builder puros em `tests/providers.test.ts` e fluxo de
   `generate` com mocks em `tests/providers-generate.test.ts`.

## Build e testes

- **Bundle**: esbuild (`esbuild.config.mjs`) gera `dist/extension.js`
  (CJS, minificado, `vscode` externo). O VS Code carrega só esse arquivo.
- **Testes**: Vitest, apenas módulos puros (sem import de `vscode`).
  Módulos com efeitos colaterais (`runCli`, `postJson`) têm testes
  comportamentais com processo filho real e fetch stubado; providers são
  testados com `vi.mock` das camadas de transporte.
- **Lint/format**: Biome 2 (`biome check`).
- **Empacotamento**: `@vscode/vsce` (`pnpm package`), com `.vscodeignore`
  limitando o conteúdo a `dist/`, `images/`, manifest, README e LICENSE.
