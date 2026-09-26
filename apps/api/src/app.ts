import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { MatchStatus, PrismaClient } from '@prisma/client';
import type { AppConfig } from './config';

export function createApp(config: AppConfig, prisma: PrismaClient) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || config.corsOrigins.includes(origin));
    },
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'futliga-api',
      environment: config.environment,
      version: config.version,
    });
  });

  app.get('/api/championships', async (_request, response) => {
    const data = await prisma.championship.findMany({
      include: {
        club: true,
        phases: true,
        teams: true,
        matches: { include: { homeTeam: true, awayTeam: true, events: true, roster: true } },
        awards: true,
        sponsors: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    response.json(data);
  });

  app.get('/api/matches/:id', async (request, response) => {
    const data = await prisma.match.findUnique({
      where: { id: request.params.id },
      include: {
        homeTeam: true,
        awayTeam: true,
        events: { orderBy: { createdAt: 'asc' } },
        roster: true,
        championship: true,
      },
    });
    if (!data) return response.status(404).json({ error: 'Partida não encontrada' });
    response.json(data);
  });

  app.post('/api/matches/:id/status', async (request, response) => {
    const status = request.body?.status;
    if (typeof status !== 'string' || !Object.values(MatchStatus).includes(status as MatchStatus)) {
      return response.status(400).json({ error: 'Status inválido' });
    }

    const data = await prisma.match.update({
      where: { id: request.params.id },
      data: {
        status: status as MatchStatus,
        startedAt: status === MatchStatus.FIRST_HALF ? new Date() : undefined,
        secondHalfAt: status === MatchStatus.SECOND_HALF ? new Date() : undefined,
        finishedAt: status === MatchStatus.FINISHED ? new Date() : undefined,
      },
    });
    request.app.locals.io?.to(`match:${data.id}`).emit('match:status', data);
    response.json(data);
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error('Request failed', error);
    if (response.headersSent) return;
    response.status(500).json({ error: 'Erro interno do servidor' });
  };
  app.use(errorHandler);

  return app;
}
