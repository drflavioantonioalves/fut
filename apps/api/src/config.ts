export interface AppConfig {
  port: number;
  environment: string;
  version: string;
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env.NODE_ENV?.trim() || 'development';
  const portValue = env.PORT?.trim() || '3000';
  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if (environment === 'production' && !env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required in production');
  }

  const configuredOrigins = env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (environment === 'production' && configuredOrigins.length === 0) {
    throw new Error('CORS_ORIGIN must contain at least one allowed origin in production');
  }

  const corsOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : ['http://localhost:5173'];

  for (const origin of corsOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGIN contains an invalid origin: ${origin}`);
    }
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`CORS_ORIGIN entries must be plain HTTP(S) origins: ${origin}`);
    }
  }

  return {
    port,
    environment,
    version: env.APP_VERSION?.trim() || '1.0.0',
    corsOrigins,
  };
}
