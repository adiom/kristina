// Minimal jest setup – we only need the env vars used by the
// runtime when imported (none right now, but the file is here so
// future globals can be added without touching the config).
process.env.DATABASE_URL ||= 'postgresql://localhost:5432/test';
process.env.LM_STUDIO_URL ||= 'http://localhost:1234/v1';
