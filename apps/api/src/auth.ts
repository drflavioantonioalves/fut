import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';

export const SESSION_COOKIE = 'futliga_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_PATH = '/';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  active: boolean;
}

declare global {
  namespace Express {
    interface Request { authUser?: AuthenticatedUser; sessionId?: string; }
  }
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

export function setSessionCookie(response: Response, token: string, production: boolean) {
  const attributes = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, `Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (production) attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

export function clearSessionCookie(response: Response, production: boolean) {
  const attributes = [`${SESSION_COOKIE}=`, `Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (production) attributes.push('Secure');
  response.setHeader('Set-Cookie', attributes.join('; '));
}

export function requireAuth(prisma: PrismaClient) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token || token.length > 256) return response.status(401).json({ error: 'Autenticação necessária.' });
    const session = await prisma.session.findUnique({
      where: { id: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date() || !session.user.active) {
      return response.status(401).json({ error: 'Autenticação necessária.' });
    }
    const { passwordHash: _passwordHash, ...user } = session.user;
    request.authUser = user;
    request.sessionId = session.id;
    next();
  };
}

export function requireMasterAdmin(request: Request, response: Response, next: NextFunction) {
  if (request.authUser?.role !== 'MASTER_ADMIN') return response.status(403).json({ error: 'Acesso negado.' });
  next();
}

export async function hasOrganizationAccess(prisma: PrismaClient, user: AuthenticatedUser, organizationId: string) {
  if (user.role === 'MASTER_ADMIN') return true;
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: user.id, organizationId, role: 'CHAMPIONSHIP_ADMIN', active: true, organization: { active: true } },
    select: { id: true },
  });
  return Boolean(membership);
}

export async function hasChampionshipAccess(prisma: PrismaClient, user: AuthenticatedUser, championshipId: string) {
  const championship = await prisma.championship.findUnique({
    where: { id: championshipId },
    select: { organizationId: true },
  });
  if (!championship) return { exists: false, allowed: false };
  return { exists: true, allowed: await hasOrganizationAccess(prisma, user, championship.organizationId) };
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}
