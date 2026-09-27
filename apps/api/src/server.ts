import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { loadConfig } from './config';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const app = createApp(config, prisma);
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: {
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin || config.corsOrigins.includes(origin));
      },
    },
  });

  app.locals.io = io;
  io.on('connection', (socket) => {
    socket.on('match:join', (id: unknown) => {
      if (typeof id === 'string' && id.length > 0 && id.length <= 128) socket.join(`match:${id}`);
    });
    socket.on('match:leave', (id: unknown) => {
      if (typeof id === 'string' && id.length > 0 && id.length <= 128) socket.leave(`match:${id}`);
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(config.port, () => {
      httpServer.off('error', rejectListen);
      resolveListen();
    });
  });
  console.log(`FutLiga API listening on port ${config.port}`);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down FutLiga API`);
    const forceExit = setTimeout(() => process.exit(1), 25_000);
    forceExit.unref();
    io.close(async () => {
      try {
        await prisma.$disconnect();
        clearTimeout(forceExit);
        process.exitCode = 0;
      } catch (error) {
        console.error('Failed to disconnect Prisma cleanly', error);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('FutLiga API failed to start', error);
  process.exitCode = 1;
});
