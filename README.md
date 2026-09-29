# FutLiga

Plataforma em construção para campeonatos de futebol. A fundação técnica e a identidade/multi-tenancy estão implementadas, assim como login, sessões server-side e autorização básica por organização. O sistema **não está production-ready**; ainda não inclui o painel administrativo nem os fluxos completos do produto.

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
| `CORS_ORIGIN` | Lista separada por vírgulas das origens permitidas para API e Socket.IO. Desenvolvimento assume `http://localhost:5173`; produção exige valor explícito. A API permite credenciais para cookies. |
| `APP_VERSION` | Valor informativo retornado pelo health check. |
| `VITE_API_URL` | URL pública da API usada pelo frontend no build do Vite. Não é segredo. |

Não há segredo JWT: a API usa sessões server-side. Em produção, o cookie de sessão recebe `Secure`; em todos os ambientes ele usa `HttpOnly`, `SameSite=Lax` e expira em sete dias. Não configure credenciais demonstrativas como acesso de produção.

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

A migration da Etapa 2.1 renomeia `Club` para `Organization` e converte relações existentes sem apagar registros. A migration de autenticação adiciona a tabela `Session` ligada a `User`. As migrations foram validadas estaticamente, mas não foram aplicadas a um PostgreSQL real nesta etapa; revise e faça backup antes de aplicar em um banco existente.

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

`POST /api/auth/login`, `GET /api/auth/me` e `POST /api/auth/logout` gerenciam sessão server-side. Senhas usam Argon2id; tokens de sessão aleatórios são guardados como SHA-256 no banco e enviados apenas em cookie HttpOnly. O login limita a dez tentativas por IP a cada 15 minutos e responde com erro genérico para credenciais inválidas.

`MASTER_ADMIN` tem acesso global. `CHAMPIONSHIP_ADMIN` depende de associação ativa à organização proprietária do campeonato. `POST /api/matches/:id/status` exige autenticação, carrega a partida, resolve seu campeonato e organização no banco e só então verifica a associação antes de alterar o status. IDs fornecidos pelo cliente não concedem autorização.

As leituras públicas existentes de campeonatos e partidas continuam públicas. O painel administrativo, outras operações de escrita e os fluxos completos do produto ainda não foram implementados. Esta camada é a base da etapa, mas o sistema como um todo ainda não está pronto para produção.

## Render

O `render.yaml` configura uma API Node, um site estático e um banco PostgreSQL. O blueprint declara planos pagos de entrada para API e PostgreSQL; revise dimensionamento e custo antes de provisionar. A API gera o cliente durante o build, executa `prisma migrate deploy` no `preDeployCommand` e expõe `/health` como health check. As origens e URL do frontend usam os domínios Render definidos pelo nome dos serviços; atualize `CORS_ORIGIN` e `VITE_API_URL` se usar domínios próprios.

O `preDeployCommand` do Render exige um plano que ofereça esse recurso. Confirme a disponibilidade no plano e no workspace antes de aplicar o Blueprint. Em planos sem pre-deploy, aplique `npm run db:deploy` por um job/release command compatível antes de iniciar a nova versão; não substitua isso por `prisma migrate dev` em produção.

Antes de usar um banco existente, faça backup e determine se ele está vazio, se já possui o schema ou se precisa de baseline. As migrations estão versionadas, mas não foram executadas contra PostgreSQL real nesta etapa.

## Dependências

O lockfile desta base mantém `Prisma 6.19.3` e resolve `deepmerge-ts@8.0.2` pelo override já validado da Etapa 1.5.

## Limites desta etapa

As rotas públicas atuais de campeonatos e partidas foram preservadas. O endpoint de alteração de status de partida agora exige autenticação e autorização por tenant. Ainda faltam o painel e as operações administrativas restantes, relógio de partida, fluxo completo de eventos, moderação, votação, gestão comercial, retenção e exclusão de dados.
