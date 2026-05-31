import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createHandlers } from './handlers.js';
import { exchangeCode, loginFor, makeBotOctokit, makeReset, makeSubmit } from './github.js';
import { makeSession } from './session.js';

const env = process.env;
const need = (k) => {
  const v = env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};

const privateKey = readFileSync(need('GH_PRIVATE_KEY_PATH'), 'utf8');
const octokit = makeBotOctokit({
  appId: need('GH_APP_ID'),
  privateKey,
  installationId: need('GH_INSTALLATION_ID'),
});
const owner = need('REPO_OWNER');
const repo = need('REPO_NAME');
const submit = makeSubmit({
  octokit,
  owner,
  repo,
  baseBranch: env.BASE_BRANCH || 'main',
  filePath: env.FILE_PATH || 'open.yml',
});
const reset = makeReset({ octokit, owner, repo });
const session = makeSession(need('JWT_SECRET'));

const handlers = createHandlers({
  exchangeCode: (code) =>
    exchangeCode(code, { clientId: need('GH_CLIENT_ID'), clientSecret: need('GH_CLIENT_SECRET') }),
  loginFor,
  signSession: session.signSession,
  verifySession: session.verifySession,
  submit,
  reset,
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
app.post('/submit', wrap((req) => handlers.submit({ authorization: req.headers.authorization, body: req.body })));
app.post('/reset', wrap((req) => handlers.reset({ authorization: req.headers.authorization, body: req.body })));
app.post('/renew', wrap((req) => handlers.renew({ authorization: req.headers.authorization })));

await app.listen({ port: Number(env.PORT) || 8787, host: '127.0.0.1' });
