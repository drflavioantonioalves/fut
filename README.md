# FutLiga — Plataforma de Campeonatos de Futebol

Base profissional multi-tenant preparada para Render + PostgreSQL.

## Componentes
- `apps/web`: React + TypeScript + Vite
- `apps/api`: Node.js + Express + Socket.IO
- `prisma`: PostgreSQL / Prisma
- `render.yaml`: blueprint inicial de deploy

## Início local
1. Node.js 20+
2. PostgreSQL
3. `npm install`
4. copie `.env.example` para `.env`
5. `npm run db:generate`
6. `npm run db:migrate`
7. `npm run db:seed`
8. `npm run dev`

## Contas de demonstração
- Master: `master@futliga.local`
- Admin: `admin@velhobol.local`
- Senha seed: `troque-esta-senha`

Troque as credenciais antes de qualquer uso público.

## Escopo
O projeto já separa público, administrador do campeonato e Admin Master, possui modelo PostgreSQL para campeonatos, fases, partidas, jogadores, escalações, eventos, comentários, votos, patrocinadores e premiações.

Antes de comercialização pública, faça revisão independente de segurança, gestão de segredos, observabilidade, backups e testes de carga.
