import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { MatchStatus, PrismaClient } from '@prisma/client';
import type { AppConfig } from './config';
import argon2 from 'argon2';
import { clearSessionCookie, hashSessionToken, hasChampionshipAccess, newSessionToken, readCookie, requireAuth, SESSION_COOKIE, SESSION_TTL_MS, setSessionCookie } from './auth';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,p=4,t=3$Q2nU6dBv5RGlIdxm5BQpqg$xW2gRrlO06wpeUwmbWxRpPY0Cy8hF2q/dbuqGgQkF9g';

function allowLoginAttempt(key: string, now = Date.now()) {
  for (const [attemptKey, entry] of loginAttempts) if (entry.resetAt <= now) loginAttempts.delete(attemptKey);
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

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

  app.post('/api/auth/login', async (request, response) => {
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    if (!allowLoginAttempt(ip)) return response.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    if (!email || !password || email.length > 320 || password.length > 1024) {
      return response.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const validPassword = await argon2.verify(user?.passwordHash || DUMMY_PASSWORD_HASH, password).catch(() => false);
    if (!user || !user.active || !validPassword) return response.status(401).json({ error: 'Credenciais inválidas.' });

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({ data: { id: hashSessionToken(token), userId: user.id, expiresAt } });
    setSessionCookie(response, token, config.environment === 'production');
    return response.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.get('/api/auth/me', requireAuth(prisma), (request, response) => response.json(request.authUser));

  app.post('/api/auth/logout', async (request, response) => {
    const token = readCookie(request, SESSION_COOKIE);
    if (token && token.length <= 256) await prisma.session.deleteMany({ where: { id: hashSessionToken(token) } });
    clearSessionCookie(response, config.environment === 'production');
    return response.status(204).end();
  });

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
        organization: true,
        phases: true,
        teams: true,
        matches: { include: { homeTeam: true, awayTeam: true, events: true, roster: true } },
        awards: true,
        sponsors: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    response.json(data.map(({ organization, ...championship }) => ({ ...championship, club: organization })));
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

  app.post('/api/matches/:id/status', requireAuth(prisma), async (request, response) => {
    const status = request.body?.status;
    if (typeof status !== 'string' || !Object.values(MatchStatus).includes(status as MatchStatus)) {
      return response.status(400).json({ error: 'Status inválido.' });
    }
    const matchId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true, championshipId: true } });
    if (!match) return response.status(404).json({ error: 'Partida não encontrada.' });
    const access = await hasChampionshipAccess(prisma, request.authUser!, match.championshipId);
    if (!access.allowed) {
      return response.status(403).json({ error: 'Acesso negado.' });
    }

    const at = new Date();
    const data = {
      status: status as MatchStatus,
      ...(status === MatchStatus.FIRST_HALF ? { startedAt: at } : {}),
      ...(status === MatchStatus.SECOND_HALF ? { secondHalfAt: at } : {}),
      ...(status === MatchStatus.FINISHED ? { finishedAt: at } : {}),
    };
    const updated = await prisma.match.update({ where: { id: match.id }, data });
    const io = request.app.locals.io;
    if (io) io.to(`match:${match.id}`).emit('match:status', updated);
    return response.json(updated);
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error('Request failed', error);
    if (response.headersSent) return;
    response.status(500).json({ error: 'Erro interno do servidor' });
  };
  app.use(errorHandler);

  return app;
}
