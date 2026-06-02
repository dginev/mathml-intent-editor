import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createHandlers } from './handlers.js';
import { exchangeCode, loginFor } from './github.js';

const env = process.env;
const need = (k) => {
  const v = env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

const handlers = createHandlers({
  exchangeCode: (code) =>
    exchangeCode(code, { clientId: need('GH_CLIENT_ID'), clientSecret: need('GH_CLIENT_SECRET') }),
  loginFor,
});

const app = Fastify({ logger: true });
// Caddy terminates TLS in front of us; CORS allows the GitHub Pages origin(s).
await app.register(cors, {
  origin: (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  methods: ['GET', 'POST', 'OPTIONS'],
});

const wrap = (fn) => async (req, reply) => {
  try {
    return await fn(req);
  } catch (e) {
    reply.code(e.status || 500);
    return { error: e.message };
  }
};

app.get('/health', async () => ({ ok: true }));
app.post('/auth', wrap((req) => handlers.auth(req.body)));

await app.listen({ port: Number(env.PORT) || 8787, host: '127.0.0.1' });
