import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Keeps schema validation and client generation independent of a running DB.
    // Migration commands must be given the intended DATABASE_URL explicitly.
    url: process.env.DATABASE_URL || 'postgresql://futliga:futliga@localhost:5432/futliga?schema=public',
  },
});
