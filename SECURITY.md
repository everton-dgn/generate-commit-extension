# Política e modelo de segurança

## Reportar vulnerabilidades

Abra uma issue privada (GitHub Security Advisories) ou contate o mantenedor
diretamente. Não abra issue pública descrevendo o problema antes de ele ser
corrigido.

## Modelo de segurança

A extensão envia o **conteúdo do seu diff** para o provider de IA escolhido.
Esse é o único dado que sai da máquina, e estas são as camadas de proteção:

### 1. Varredura de segredos antes de qualquer envio

- Padrões: chaves (`sk-`, `sk-or-`, `sk-ant-`, `ghp_`/`gho_`/...,
  `github_pat_`, `AKIA`/`ASIA`, `xox[baprs]-`, `AIza`), JWT, blocos PEM de
  chave privada, credenciais embutidas em URLs (`https://user:pass@host`),
  arquivos `.env*` e keystores (`.jks`, `.keystore`, `.p12`, `.pfx`).
- Ao detectar: **bloqueio por padrão**. Um modal lista arquivo + tipo de
  segredo (o valor nunca é exibido) e o envio só acontece com "Send
  Anyway" explícito, por ocorrência.
- Limitação honesta: a varredura é heurística. Nenhuma lista cobre todos os
  formatos de chave, e falsos positivos são possíveis. Revise o que vai no
  stage.

### 2. Minimização do que é enviado

- Lockfiles, binários, minificados e arquivos cujo chunk de diff excede
  `generateCommit.maxFileSizeKB` × 1024 bytes são excluídos do diff.
- O diff total é truncado em `generateCommit.maxDiffChars`, na fronteira de
  arquivo, com aviso explícito no prompt.
- Commits recentes (apenas assuntos) só são incluídos se
  `includeRecentCommits` estiver ligado.

### 3. Chaves de API

- Armazenadas **somente** em `context.secrets` (SecretStorage do VS Code,
  com suporte a keychain do sistema operacional).
- Nunca em `settings.json`, nunca em logs, nunca em mensagens de erro.
- A validação de chave usa uma requisição mínima (`max_tokens: 8`). Falha
  de autenticação invalida a chave; respostas do endpoint que não sejam de
  autenticação (limite, créditos, erro de servidor, payload rejeitado)
  confirmam que a chave foi aceita; falhas sem resposta (rede, timeout)
  deixam a chave não verificada e impedem o salvamento pelo painel.

### 4. Transporte e rede

- Somente HTTPS: base URLs não-HTTPS são rejeitadas na leitura da config e
  na camada HTTP (`postJson` recusa antes do fetch).
- Timeout configurável (default 60 s) em requisições e execuções de CLI.
- **Zero telemetria** e zero chamadas a serviços além do provider ativo.
- Sem a API `vscode.lm`.

### 5. Logs e mensagens de erro

- Output Channel somente com metadados (provider, modelo, latência,
  tamanhos, contagens). Todo valor passa por redação defensiva de segredos
  antes de ser escrito.
- Detalhes de erro HTTP passam pela mesma redação antes de chegar à UI.
- stderr de CLIs **nunca** é exibido ou logado cru: é classificado por uma
  lista fechada de assinaturas (ex.: "not logged in", "rate limited"),
  porque pode ecoar o prompt (o diff) ou segredos.
- URLs inválidas são logadas apenas pelo host (credenciais embutidas em
  userinfo nunca chegam ao log).

### 6. Execução de CLIs

- Binários resolvidos por nome validado (`[A-Za-z0-9._-]+`) passado como
  argumento posicional ao shell (sem interpolação em string de comando).
- Spawn sem shell (`args` em array), cwd no root do repositório.
- Cancelamento/timeout mata o **grupo de processos** (spawn `detached` +
  sinal para o grupo), com escalonamento SIGTERM → SIGKILL.
- Providers CLI não recebem nem exigem chaves de API (usam o login do
  próprio CLI).
- Variáveis de ambiente de sessões aninhadas (`CLAUDECODE`,
  `CLAUDE_CODE_ENTRYPOINT`) são removidas do ambiente do `claude`.

### 7. Consistência e abuso

- Uma geração por repositório: iniciar outra aborta a anterior; respostas
  atrasadas de runs antigas são descartadas.
- O diff staged é relido antes de escrever o resultado na caixa de commit;
  se o stage mudou durante a geração, o resultado é descartado.
- Erros de API mapeados por tipo (401/403, 402, 429 com `retry-after`,
  5xx, rede, timeout) com mensagens distintas e ações sugeridas.

### 8. Webview do painel de configurações

A única webview da extensão é o formulário de settings na sidebar, isolada
assim:

- **CSP estrita**: `default-src 'none'` com `script-src` e `style-src`
  limitados aos arquivos locais do bundle (`media/`). Sem conteúdo remoto,
  sem script ou estilo inline, sem imagens e sem fontes externas.
- **Sem XSS por construção**: o HTML estático não interpola dado nenhum; o
  estado flui por `postMessage` e é renderizado só com APIs seguras de DOM
  (`textContent`, `createElement`, propriedades `value`), nunca `innerHTML`
  com dados do usuário.
- **Mensagens nunca confiáveis**: toda escrita vinda da webview passa pela
  whitelist `PANEL_SETTINGS` (`validateSettingValue`), que rejeita chaves
  desconhecidas e membros herdados (`__proto__` e afins via
  `Object.hasOwn`), valida tipos, mínimos, enums e a regra de HTTPS.
- **Segredos fora do DOM**: campos de API key são `type=password`, nunca
  pré-preenchidos; a extensão só devolve status (configurada/inválida), e o
  valor vai direto para o SecretStorage após validação.
- Escopo local: `localResourceRoots` restrito ao diretório `media/` do
  bundle.

## Fora de escopo (ameaças aceitas)

- Comprometimento do próprio provider de IA ou da cadeia TLS até ele.
- Segredos em formatos fora dos padrões conhecidos pela varredura.
- Um usuário que explicitamente escolhe "Send Anyway" no modal de segredos.
