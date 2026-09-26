import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demonstration seed is disabled in production.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.club.upsert({
      where: { id: 'seed-club-demo' },
      update: { name: 'Clube Demonstração FutLiga' },
      create: { id: 'seed-club-demo', name: 'Clube Demonstração FutLiga' },
    });
    await tx.user.upsert({
      where: { email: 'master@futliga.example.test' },
      update: { name: 'Master demonstrativo', role: UserRole.MASTER, clubId: null },
      create: {
        id: 'seed-user-master',
        name: 'Master demonstrativo',
        email: 'master@futliga.example.test',
        // Deliberately not a password hash. Authentication is outside this stage.
        passwordHash: 'seed-account-has-no-login-credential',
        role: UserRole.MASTER,
      },
    });
    await tx.championship.upsert({
      where: { id: 'seed-championship-demo' },
      update: { name: 'Copa Demonstração', clubId: 'seed-club-demo' },
      create: { id: 'seed-championship-demo', name: 'Copa Demonstração', clubId: 'seed-club-demo' },
    });
    await tx.team.upsert({
      where: { id: 'seed-team-home' },
      update: { name: 'Atlético Exemplo', championshipId: 'seed-championship-demo', clubId: 'seed-club-demo' },
      create: { id: 'seed-team-home', name: 'Atlético Exemplo', championshipId: 'seed-championship-demo', clubId: 'seed-club-demo' },
    });
    await tx.team.upsert({
      where: { id: 'seed-team-away' },
      update: { name: 'União Fictícia', championshipId: 'seed-championship-demo', clubId: 'seed-club-demo' },
      create: { id: 'seed-team-away', name: 'União Fictícia', championshipId: 'seed-championship-demo', clubId: 'seed-club-demo' },
    });
    await tx.player.upsert({
      where: { id: 'seed-player-home' },
      update: { name: 'Jogador Exemplo A', teamId: 'seed-team-home', shirtNumber: 9 },
      create: { id: 'seed-player-home', name: 'Jogador Exemplo A', teamId: 'seed-team-home', shirtNumber: 9, position: 'Atacante' },
    });
    await tx.player.upsert({
      where: { id: 'seed-player-away' },
      update: { name: 'Jogador Exemplo B', teamId: 'seed-team-away', shirtNumber: 10 },
      create: { id: 'seed-player-away', name: 'Jogador Exemplo B', teamId: 'seed-team-away', shirtNumber: 10, position: 'Meio-campo' },
    });
    await tx.phase.upsert({
      where: { id: 'seed-phase-demo' },
      update: { name: 'Fase demonstrativa', championshipId: 'seed-championship-demo', type: 'GROUP', order: 1 },
      create: { id: 'seed-phase-demo', name: 'Fase demonstrativa', championshipId: 'seed-championship-demo', type: 'GROUP', order: 1 },
    });
    await tx.match.upsert({
      where: { id: 'seed-match-demo' },
      update: {
        championshipId: 'seed-championship-demo', phaseId: 'seed-phase-demo',
        homeTeamId: 'seed-team-home', awayTeamId: 'seed-team-away', venue: 'Estádio de Exemplo',
      },
      create: {
        id: 'seed-match-demo', championshipId: 'seed-championship-demo', phaseId: 'seed-phase-demo',
        homeTeamId: 'seed-team-home', awayTeamId: 'seed-team-away', venue: 'Estádio de Exemplo',
      },
    });
  });

  console.log('Demo seed completed. All records use fictitious data and the demo user has no login credential.');
}

main()
  .catch((error: unknown) => {
    console.error('Demo seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
