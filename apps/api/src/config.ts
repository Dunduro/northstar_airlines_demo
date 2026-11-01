export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  webhookSecret: string;
  /** Simulated Entra ID login (dev only). Production validates real Entra tokens via JWKS. */
  simulatedAuth: boolean;
  /** Demo helpers (reset, history backfill, queue status). Never enabled in production. */
  demoMode: boolean;
}

export function loadConfig(env = process.env): Config {
  const required = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set (see .env.example)`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    jwtSecret: required('JWT_SECRET'),
    webhookSecret: required('WEBHOOK_SECRET'),
    simulatedAuth: env.AUTH_MODE === 'simulated-entra',
    demoMode: env.DEMO_MODE === 'true',
  };
}
