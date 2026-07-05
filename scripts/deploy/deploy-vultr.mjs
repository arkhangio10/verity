/**
 * Verity — despliegue de "un clic" en Vultr Cloud Compute (VM + Docker).
 *
 * La app es UN solo servicio Next.js: las API routes (SSE del agente, health,
 * meta, runs) y el frontend React corren en el mismo proceso Node. Por eso se
 * despliega un único contenedor, no dos servicios separados.
 *
 * Qué hace (idempotente — puedes correrlo varias veces):
 *   1. Verifica requisitos (VULTR_API_KEY de cuenta, ssh, tar, docker en local
 *      opcional; el build real ocurre en la VM).
 *   2. Provisiona (o reutiliza) una instancia Vultr Cloud Compute etiquetada
 *      `verity-deploy` vía la API v2 de Vultr.
 *   3. Espera a que la VM tenga IP y SSH listo, e instala Docker si falta.
 *   4. Empaqueta el repo (sin node_modules/.next/.git) y lo sube por SSH.
 *   5. Hace `docker build` con el Dockerfile del repo y arranca el contenedor
 *      inyectando las variables de inferencia (VULTR_API_KEY del .env, etc.)
 *      en runtime — nunca se hornean en la imagen.
 *   6. Imprime la URL pública. Deja el smoke-test listo para verificar.
 *
 * Uso:
 *   node scripts/deploy/deploy-vultr.mjs                 # provisiona/actualiza
 *   node scripts/deploy/deploy-vultr.mjs --destroy       # borra la instancia
 *   node scripts/deploy/deploy-vultr.mjs --plan          # solo muestra el plan
 *
 * Requiere en tu entorno o en scripts/deploy/.env.deploy:
 *   VULTR_API_KEY_ACCOUNT   Personal Access Token de la cuenta Vultr (API v2).
 *                           OJO: es DISTINTO de la key de Serverless Inference.
 *   SSH_KEY_ID  (opcional)  id de una SSH key ya cargada en Vultr; si falta se
 *                           usa/crea ~/.ssh/id_ed25519 y se sube automáticamente.
 *   VULTR_REGION (opcional) por defecto "ewr" (New Jersey).
 *   VULTR_PLAN   (opcional) por defecto "vc2-1c-2gb".
 *
 * Las variables de la APP (las de inferencia) se leen del .env de la raíz del
 * repo — las mismas que ya usas en local: VULTR_API_KEY, VULTR_CHAT_MODEL, etc.
 *
 * Sin dependencias externas: Node >= 20 (usa fetch nativo).
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const TAG = 'verity-deploy';
const API = 'https://api.vultr.com/v2';
const CONTAINER = 'verity';
const APP_PORT = 3000;

// ── carga de .env (sin dependencias, mismo parser que check-vultr) ───────────
function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const appEnv = loadEnvFile(join(ROOT, '.env'));
const deployEnv = { ...loadEnvFile(join(HERE, '.env.deploy')), ...process.env };

const ACCOUNT_KEY = (deployEnv.VULTR_API_KEY_ACCOUNT || '').trim();
const REGION = deployEnv.VULTR_REGION || 'ewr';
const PLAN = deployEnv.VULTR_PLAN || 'vc2-1c-2gb';
const OS_ID = 2136; // Ubuntu 24.04 LTS x64 (estable en Vultr)
const SSH_KEY_PATH = join(homedir(), '.ssh', 'id_ed25519');

const args = process.argv.slice(2);
const MODE = args.includes('--destroy') ? 'destroy' : args.includes('--plan') ? 'plan' : 'deploy';

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}
function log(msg) {
  console.log(msg);
}

async function vultr(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ACCOUNT_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Vultr API ${init.method || 'GET'} ${path} → HTTP ${res.status}: ${text}`);
  }
  return json;
}

// ── requisitos ───────────────────────────────────────────────────────────────
function requireTool(bin, hint) {
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (r.status !== 0 && r.error) die(`Falta "${bin}" en el PATH. ${hint}`);
}

function checkPrereqs() {
  if (!ACCOUNT_KEY) {
    die(
      'Falta VULTR_API_KEY_ACCOUNT (Personal Access Token de la cuenta Vultr, API v2).\n' +
        '   Obtenlo en https://my.vultr.com/settings/#settingsapi y ponlo en\n' +
        '   scripts/deploy/.env.deploy   (o como variable de entorno).\n' +
        '   NOTA: no es la misma key que VULTR_API_KEY de Serverless Inference.',
    );
  }
  requireTool('ssh', 'Instala OpenSSH client.');
  requireTool('scp', 'Instala OpenSSH client (incluye scp).');
  requireTool('tar', 'Instala tar (Git Bash / WSL lo traen).');
}

// ── SSH key ──────────────────────────────────────────────────────────────────
function ensureLocalSshKey() {
  if (existsSync(`${SSH_KEY_PATH}.pub`)) return readFileSync(`${SSH_KEY_PATH}.pub`, 'utf8').trim();
  log('🔑 No hay ~/.ssh/id_ed25519 — generando una nueva clave…');
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', SSH_KEY_PATH], { stdio: 'inherit' });
  return readFileSync(`${SSH_KEY_PATH}.pub`, 'utf8').trim();
}

async function ensureVultrSshKey() {
  if (deployEnv.SSH_KEY_ID) return deployEnv.SSH_KEY_ID;
  const pub = ensureLocalSshKey();
  const { ssh_keys = [] } = await vultr('/ssh-keys');
  const existing = ssh_keys.find((k) => k.ssh_key.trim() === pub);
  if (existing) {
    log(`🔑 Reutilizando SSH key en Vultr (${existing.id}).`);
    return existing.id;
  }
  log('🔑 Subiendo tu clave pública a Vultr…');
  const { ssh_key } = await vultr('/ssh-keys', {
    method: 'POST',
    body: JSON.stringify({ name: `${TAG}-key`, ssh_key: pub }),
  });
  return ssh_key.id;
}

// ── instancia ────────────────────────────────────────────────────────────────
async function findInstance() {
  const { instances = [] } = await vultr('/instances');
  return instances.find((i) => (i.tags || []).includes(TAG) || i.label === TAG);
}

async function provisionInstance(sshKeyId) {
  const existing = await findInstance();
  if (existing) {
    log(`🖥️  Reutilizando instancia existente ${existing.id} (${existing.main_ip || 'IP pendiente'}).`);
    return existing;
  }
  log(`🖥️  Creando instancia Vultr  region=${REGION}  plan=${PLAN}  os=${OS_ID}…`);
  const { instance } = await vultr('/instances', {
    method: 'POST',
    body: JSON.stringify({
      region: REGION,
      plan: PLAN,
      os_id: OS_ID,
      label: TAG,
      tags: [TAG],
      sshkey_id: [sshKeyId],
      backups: 'disabled',
    }),
  });
  return instance;
}

async function waitForIp(id) {
  process.stdout.write('⏳ Esperando IP pública');
  for (let i = 0; i < 60; i++) {
    const { instance } = await vultr(`/instances/${id}`);
    if (instance.main_ip && instance.main_ip !== '0.0.0.0' && instance.status === 'active') {
      log(`\n✅ Instancia activa · ${instance.main_ip}`);
      return instance.main_ip;
    }
    process.stdout.write('.');
    await sleep(5000);
  }
  die('La instancia no llegó a estado "active" con IP a tiempo.');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── SSH helpers ──────────────────────────────────────────────────────────────
const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=10',
  '-i', SSH_KEY_PATH,
];

function ssh(ip, cmd, opts = {}) {
  return spawnSync('ssh', [...SSH_OPTS, `root@${ip}`, cmd], {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: false,
  });
}

async function waitForSsh(ip) {
  process.stdout.write('⏳ Esperando SSH');
  for (let i = 0; i < 40; i++) {
    const r = ssh(ip, 'echo ready', { quiet: true });
    if (r.status === 0 && /ready/.test(r.stdout || '')) {
      log('\n✅ SSH listo.');
      return;
    }
    process.stdout.write('.');
    await sleep(5000);
  }
  die('No se pudo conectar por SSH a tiempo.');
}

// ── despliegue del contenedor ─────────────────────────────────────────────────
function buildRuntimeEnvFlags() {
  // Sólo las variables de la app. Se pasan a `docker run -e`, nunca a la imagen.
  const keys = [
    'VULTR_API_KEY',
    'VULTR_INFERENCE_BASE_URL',
    'VULTR_CHAT_MODEL',
    'VULTR_EMBED_MODEL',
    'AGENT_LOOP_MODE',
    'SMV_BASE_URL',
  ];
  const flags = [];
  for (const k of keys) {
    if (appEnv[k] !== undefined && appEnv[k] !== '') flags.push('-e', `${k}=${appEnv[k]}`);
  }
  return flags;
}

function packRepo() {
  const tarball = join(HERE, '.verity-src.tar.gz');
  log('📦 Empaquetando el repo (sin node_modules/.next/.git)…');
  execFileSync(
    'tar',
    [
      '--exclude=./node_modules',
      '--exclude=./.git',
      '--exclude=./apps/web/.next',
      '--exclude=./**/node_modules',
      '--exclude=./scripts/deploy/.verity-src.tar.gz',
      '-czf',
      tarball,
      '-C',
      ROOT,
      '.',
    ],
    { stdio: 'inherit' },
  );
  return tarball;
}

async function deployTo(ip) {
  log('\n🐳 Preparando Docker en la VM (instala sólo si falta)…');
  ssh(
    ip,
    'command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh && systemctl enable --now docker)',
  );

  const tarball = packRepo();
  log('⬆️  Subiendo el código…');
  ssh(ip, 'rm -rf /opt/verity && mkdir -p /opt/verity');
  const scp = spawnSync('scp', [...SSH_OPTS, tarball, `root@${ip}:/opt/verity/src.tar.gz`], {
    stdio: 'inherit',
  });
  if (scp.status !== 0) die('Falló la subida del código por scp.');
  ssh(ip, 'cd /opt/verity && tar -xzf src.tar.gz && rm src.tar.gz');

  log('🔨 Build de la imagen Docker en la VM (usa el Dockerfile del repo)…');
  const build = ssh(ip, 'cd /opt/verity && docker build -t verity:latest .');
  if (build.status !== 0) die('Falló el docker build en la VM.');

  log('🚀 Arrancando el contenedor…');
  const envFlags = buildRuntimeEnvFlags();
  const runCmd = [
    'docker rm -f',
    CONTAINER,
    '2>/dev/null; docker run -d --restart unless-stopped --name',
    CONTAINER,
    '-p',
    `${APP_PORT}:${APP_PORT}`,
    ...envFlags.map((f) => (f === '-e' ? '-e' : JSON.stringify(f))),
    'verity:latest',
  ].join(' ');
  const run = ssh(ip, runCmd);
  if (run.status !== 0) die('Falló el docker run en la VM.');

  return `http://${ip}:${APP_PORT}`;
}

// ── destroy ──────────────────────────────────────────────────────────────────
async function destroy() {
  const inst = await findInstance();
  if (!inst) return log('ℹ️  No hay instancia etiquetada para borrar.');
  log(`🗑️  Borrando instancia ${inst.id} (${inst.main_ip})…`);
  await vultr(`/instances/${inst.id}`, { method: 'DELETE' });
  log('✅ Borrada.');
}

// ── plan ─────────────────────────────────────────────────────────────────────
function printPlan() {
  log('\n── Plan de despliegue ─────────────────────────────────────────');
  log(`   Proveedor      Vultr Cloud Compute (VM + Docker)`);
  log(`   Región         ${REGION}`);
  log(`   Plan           ${PLAN}`);
  log(`   OS             Ubuntu 24.04 (os_id ${OS_ID})`);
  log(`   Etiqueta       ${TAG}  (idempotente: reutiliza si ya existe)`);
  log(`   Contenedor     ${CONTAINER}  ·  puerto ${APP_PORT}`);
  log(`   Imagen         build local del Dockerfile del repo, en la VM`);
  const appVars = Object.keys(appEnv).filter((k) => appEnv[k]);
  const hasInfKey = !!appEnv.VULTR_API_KEY;
  log(`   Modo IA        ${hasInfKey ? 'Vultr Serverless Inference (VULTR_API_KEY presente)' : 'OFFLINE (planner determinista + BM25)'}`);
  log(`   Vars de app    ${appVars.length ? appVars.join(', ') : '(ninguna — corre offline)'}`);
  log('───────────────────────────────────────────────────────────────\n');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('\n🛰️  Verity · despliegue en Vultr (VM + Docker)\n');

  if (MODE === 'plan') {
    checkPrereqs();
    printPlan();
    return;
  }
  checkPrereqs();

  if (MODE === 'destroy') {
    await destroy();
    return;
  }

  printPlan();
  const sshKeyId = await ensureVultrSshKey();
  const inst = await provisionInstance(sshKeyId);
  const ip = inst.main_ip && inst.main_ip !== '0.0.0.0' ? inst.main_ip : await waitForIp(inst.id);
  await waitForSsh(ip);
  const url = await deployTo(ip);

  // Deja la URL a mano para el smoke-test.
  writeFileSync(join(HERE, '.last-deploy-url'), url + '\n');

  log('\n🎉 Despliegue completo.');
  log(`   URL pública   ${url}`);
  log(`   Health        ${url}/api/health`);
  log('\n   Verifícalo con:');
  log(`     node scripts/deploy/smoke-test.mjs ${url}`);
  log('   (o simplemente:  npm run smoke  — usa la última URL desplegada)\n');
}

main().catch((err) => {
  die(err.stack || err.message);
});
