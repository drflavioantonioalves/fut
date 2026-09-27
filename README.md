# FutLiga

Plataforma em construção para campeonatos de futebol. Esta alteração corresponde à **Etapa 2.1: fundação de identidade e multi-tenancy**, construída sobre a fundação técnica da Etapa 1. Ela prepara usuários, organizações, papéis e relações de tenant no Prisma. O sistema **não está production-ready**; autenticação e autorização efetiva ainda não foram implementadas e serão tratadas nas próximas etapas.

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

`db:seed` cria ou atualiza uma organização fictícia, um campeonato, duas equipes, jogadores, uma fase, uma partida e um usuário Master demonstrativo sem credencial utilizável. O seed falha quando `NODE_ENV=production`.

A migration da Etapa 2.1 renomeia `Club` para `Organization` e converte relações existentes sem apagar registros. Ela recusa dados legados inconsistentes em vez de migrá-los silenciosamente. Não foi executada contra PostgreSQL nesta etapa; revise e faça backup antes de aplicar em um banco existente.

## Desenvolvimento, testes e build

```sh
npm run dev
npm test
npm run build
```

`npm run dev` inicia API e frontend. A API responde em `http://localhost:3000`; Vite responde em `http://localhost:5173`. O frontend lê `VITE_API_URL` do `.env` da raiz. O build gera `apps/api/dist` e `apps/web/dist`.

O health check `GET /health` verifica a saúde do processo sem consultar o banco e retorna estado, serviço, ambiente e versão. Ele não substitui um monitoramento de conectividade do PostgreSQL.

## Identidade e multi-tenancy

`Organization` é o tenant principal do FutLiga. Cada `Championship` pertence a exatamente uma organização; equipes e partidas usam chaves estrangeiras compostas para impedir que uma equipe ou fase de outro campeonato seja associada por engano. `Team.organizationId` permanece como relação direta porque a equipe já podia existir sem campeonato e porque a chave composta garante que essa organização corresponda à do campeonato.

`MASTER_ADMIN` é um papel global armazenado em `User.role`. `CHAMPIONSHIP_ADMIN` fica em `OrganizationMember.role`, sempre associado a uma organização. `OrganizationMember` permite que um usuário participe de várias organizações e impede associações duplicadas. O slug identifica a organização em URLs futuras, mas não concede acesso.

Esta etapa prepara somente o modelo de dados: não implementa login, sessão, middleware ou autorização de endpoints. Conhecer IDs, slugs ou URLs não concede acesso. A autorização efetiva e o isolamento em consultas da API ficam para as etapas seguintes. O modelo não torna o sistema seguro para produção por si só.

## Render

O `render.yaml` configura uma API Node, um site estático e um banco PostgreSQL. O blueprint declara planos pagos de entrada para API e PostgreSQL; revise dimensionamento e custo antes de provisionar. A API gera o cliente durante o build, executa `prisma migrate deploy` no `preDeployCommand` e expõe `/health` como health check. As origens e URL do frontend usam os domínios Render definidos pelo nome dos serviços; atualize `CORS_ORIGIN` e `VITE_API_URL` se usar domínios próprios.

O `preDeployCommand` do Render exige um plano que ofereça esse recurso. Confirme a disponibilidade no plano e no workspace antes de aplicar o Blueprint. Em planos sem pre-deploy, aplique `npm run db:deploy` por um job/release command compatível antes de iniciar a nova versão; não substitua isso por `prisma migrate dev` em produção.

Antes de usar um banco existente, faça backup e determine se ele está vazio, se já possui o schema ou se precisa de baseline. A migration da Etapa 2.1 está versionada, mas não foi executada contra PostgreSQL real nesta etapa.

## Dependências

O lockfile desta base mantém `Prisma 6.19.3` e resolve `deepmerge-ts@8.0.2` pelo override já validado da Etapa 1.5.

## Limites desta etapa

As rotas atuais de campeonatos e partidas foram preservadas. Ainda não há autenticação, autorização efetiva dos endpoints, operação administrativa funcional, relógio de partida, fluxo completo de eventos, moderação, votação, gestão comercial, retenção ou exclusão de dados. O schema prepara o isolamento entre tenants, mas as consultas e políticas efetivas da API ainda precisam ser implementadas e revisadas. Não publique a aplicação para uso administrativo até que as etapas de segurança e produto sejam implementadas e revisadas.
