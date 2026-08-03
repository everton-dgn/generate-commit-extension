# Contribuindo

Toda contribuição é bem-vinda: correções, funcionalidades, documentação e
relatos de bug. Este guia cobre o fluxo completo, do ambiente ao PR.

## Preparar o ambiente

Requisitos: Node.js LTS e pnpm 11. A versão do pnpm está fixada no campo
`packageManager` do `package.json`; com o Corepack habilitado, ela é usada
automaticamente:

```bash
corepack enable
pnpm install
```

## Desenvolver

```bash
pnpm watch   # bundle em dist/ com watch
# F5 no VS Code: abre o Extension Development Host
```

A arquitetura da extensão (providers, fluxo de geração, painel de
configurações) está documentada em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Um provider novo é uma implementação da interface `Provider` em
`src/providers/`, registrada em `src/providers/registry.ts`.

## Antes de abrir o PR

Rode localmente o mesmo que o CI executa:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check .
pnpm test        # vitest run
pnpm build       # esbuild
```

Comportamento novo pede teste novo em `tests/` (Vitest). Se a mudança alterar
settings, providers ou fluxos visíveis, atualize o `README.md` e o
`CHANGELOG.md` na mesma PR.

## Commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/pt-br/),
em inglês e com escopo pequeno (commits atômicos):

```text
feat: add kimi coding endpoint preset
fix: abort cli process group on cancel
docs: document machine-scoped settings
```

Tipos comuns: `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`.

## Abrir o PR

1. Faça fork do repositório e crie uma branch a partir de `main`
   (`feat/...`, `fix/...`, `docs/...`).
2. Abra o PR contra `main` preenchendo o template.
3. O CI precisa estar verde antes do merge.

## Reportar bugs e vulnerabilidades

Bugs: abra uma issue usando o template de bug, com passos de reprodução e
ambiente. Nunca cole chaves de API, diffs ou respostas de providers na issue.

Vulnerabilidades de segurança: **não** abra issue pública. Siga o processo
descrito em [SECURITY.md](SECURITY.md).

## Código de conduta

Ao participar, você concorda com o
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
