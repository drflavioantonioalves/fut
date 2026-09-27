# FutLiga

Plataforma em construção para campeonatos de futebol. Esta alteração corresponde à **Etapa 1: fundação técnica**. Ela prepara o monorepo, PostgreSQL, Prisma, migrations, seed de desenvolvimento, health check e configuração inicial de hospedagem. O sistema **não está production-ready**; autenticação, autorização e isolamento entre clubes serão tratados na Etapa 2.

## Arquitetura atual

- `apps/api`: API Node.js, Express, Prisma e Socket.IO.
- `apps/web`: frontend React, TypeScript e Vite.
- `prisma/schema.prisma`: schema PostgreSQL compartilhado pelo monorepo.
- `prisma/migrations`: migrations versionadas.
- `prisma/seed.ts`: dados demonstrativos fictícios, somente para desenvolvimento.
- `render.yaml`: Blueprint inicial da API, site estático e PostgreSQL.

## Requisitos

- Node.js 20.19+ dentro da linha 20 ou 22.12+ (requisito do Vite 7).
- npm 10+.
- PostgreSQL local para executar migrations e seed.

## Instalação e ambiente local

Na raiz do repositório:

```sh
npm ci
cp .env.example .env
```

No Windows PowerShell, use `Copy-Item .env.example .env`. Edite `DATABASE_URL` em `.env` para apontar ao PostgreSQL local. As variáveis são:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL usada pela API e pelo Prisma. |
| `PORT` | Porta HTTP da API; padrão local `3000`. |
| `NODE_ENV` | Ambiente da API (`development`, `test` ou `production`). |
| `CORS_ORIGIN` | Lista separada por vírgulas das origens permitidas para API e Socket.IO. Desenvolvimento assume `http://localhost:5173`; produção exige valor explícito. |
| `APP_VERSION` | Valor informativo retornado pelo health check. |
| `VITE_API_URL` | URL pública da API usada pelo frontend no build do Vite. Não é segredo. |

`JWT_SECRET` não é usado nesta etapa. Não configure credenciais demonstrativas como acesso de produção.

## Prisma e dados de desenvolvimento

Os comandos Prisma sempre apontam para `prisma/schema.prisma` na raiz:

```sh
npm run db:validate
npm run db:generate
npm run db:migrate
npm run db:seed
```

`db:migrate` executa `prisma migrate dev` para desenvolvimento local. Para aplicar somente migrations já versionadas em um ambiente de deploy, use:

```sh
npm run db:deploy
```

`db:seed` cria ou atualiza um clube, um campeonato, duas equipes, jogadores, uma fase, uma partida e um usuário Master demonstrativo com dados fictícios. O seed falha quando `NODE_ENV=production`. Esse usuário não tem uma credencial de login; autenticação ainda não está implementada.

Não rode a migration inicial automaticamente em um banco já populado ou com schema criado manualmente sem antes revisar e planejar o baseline. A migration não apaga dados, mas pode falhar se objetos com os mesmos nomes já existirem. O Blueprint abaixo cria uma nova instância PostgreSQL; bancos existentes exigem procedimento de adoção revisado antes de habilitar migrations de deploy.

## Desenvolvimento, testes e build

```sh
npm run dev
npm test
npm run build
```

`npm run dev` inicia API e frontend. A API responde em `http://localhost:3000`; Vite responde em `http://localhost:5173`. O frontend lê `VITE_API_URL` do `.env` da raiz. O build gera `apps/api/dist` e `apps/web/dist`.

O health check `GET /health` verifica a saúde do processo sem consultar o banco e retorna estado, serviço, ambiente e versão. Ele não substitui um monitoramento de conectividade do PostgreSQL.

## Render

O `render.yaml` configura uma API Node, um site estático e um banco PostgreSQL. O blueprint declara planos pagos de entrada para API e PostgreSQL; revise dimensionamento e custo antes de provisionar. A API gera o cliente durante o build, executa `prisma migrate deploy` no `preDeployCommand` e expõe `/health` como health check. As origens e URL do frontend usam os domínios Render definidos pelo nome dos serviços; atualize `CORS_ORIGIN` e `VITE_API_URL` se usar domínios próprios.

O `preDeployCommand` do Render exige um plano que ofereça esse recurso. Confirme a disponibilidade no plano e no workspace antes de aplicar o Blueprint. Em planos sem pre-deploy, aplique `npm run db:deploy` por um job/release command compatível antes de iniciar a nova versão; não substitua isso por `prisma migrate dev` em produção.

Antes de usar um banco de dados existente, faça backup e determine se ele está vazio, se já possui o schema ou se precisa de baseline. A migration inicial foi gerada a partir do schema atual e não foi executada contra banco de produção.

## Dependência com advisory de segurança

O lockfile desta etapa resolve `deepmerge-ts@7.1.5` por `prisma@6.19.3 → @prisma/config@6.19.3 → deepmerge-ts@7.1.5`. Essa versão está afetada por CVE-2026-40345 (GHSA-ggr8-5vv4-36mx), corrigido em `deepmerge-ts@8.0.0`. O Prisma 6.19.3 fixa a dependência transitiva; não foi aplicado override para a major 8 porque sua compatibilidade com esta versão do Prisma ainda não foi validada neste projeto. O advisory permanece pendente de resolução e deve ser reavaliado antes de uso em produção ou do fechamento da auditoria pré-merge. O caminho é usado pela configuração/ferramentas Prisma, não por uma rota de requisição da API; a exposição depende de processar uma configuração recursiva controlada por agente não confiável.

## Limites desta etapa

As rotas atuais de campeonatos e partidas foram preservadas. Ainda não há autenticação, autorização, isolamento multi-tenant, operação administrativa funcional, relógio de partida, fluxo completo de eventos, moderação, votação, gestão comercial, retenção ou exclusão de dados. Não publique a aplicação para uso administrativo até que as etapas de segurança e produto sejam implementadas e revisadas.
