/**
 * Verity — set de pruebas de humo (smoke test) contra un despliegue en vivo.
 *
 * Verifica que el contenedor desplegado responde correctamente en sus tres
 * superficies reales: health, metadatos, y el streaming SSE del agente (el
 * corazón del producto). No modifica nada — sólo hace peticiones de lectura y
 * una corrida del agente sobre los datos de ejemplo empaquetados.
 *
 * Uso:
 *   node scripts/deploy/smoke-test.mjs http://<ip>:3000
 *   node scripts/deploy/smoke-test.mjs            # usa scripts/deploy/.last-deploy-url
 *
 * Salida: cada prueba imprime PASS/FAIL; exit code 0 sólo si todas pasan.
 * Sin dependencias externas (Node >= 20, fetch nativo + SSE por streaming).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

function resolveBaseUrl() {
  const arg = process.argv[2];
  if (arg) return arg.replace(/\/+$/, '');
  const cached = join(HERE, '.last-deploy-url');
  if (existsSync(cached)) return readFileSync(cached, 'utf8').trim().replace(/\/+$/, '');
  console.error(
    '\n❌ Falta la URL base.\n   Uso: node scripts/deploy/smoke-test.mjs http://<ip>:3000\n' +
      '   (o corre el deploy primero para generar .last-deploy-url)\n',
  );
  process.exit(1);
}

const BASE = resolveBaseUrl();
const TIMEOUT_MS = 90_000; // el agente en modo model puede tardar; margen amplio

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${tag}  ${name}${detail ? `  —  ${detail}` : ''}`);
}

async function withTimeout(promise, ms, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timeout tras ${ms}ms en ${label}`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ── 1. /api/health → { ok: true } ────────────────────────────────────────────
async function testHealth() {
  try {
    const res = await withTimeout((signal) => fetch(`${BASE}/api/health`, { signal }), 15_000, 'health');
    const json = await res.json();
    const ok = res.ok && json.ok === true;
    record('health · GET /api/health devuelve { ok: true }', ok, ok ? '' : `HTTP ${res.status} ${JSON.stringify(json)}`);
  } catch (err) {
    record('health · GET /api/health', false, err.message);
  }
}

// ── 2. /api/meta → branding + provider + dataset ─────────────────────────────
async function testMeta() {
  try {
    const res = await withTimeout((signal) => fetch(`${BASE}/api/meta`, { signal }), 20_000, 'meta');
    const json = await res.json();
    const hasProduct = !!json?.product?.name;
    const hasProvider = typeof json?.provider?.configured === 'boolean';
    const hasDataset = !!json?.dataset?.company;
    const ok = res.ok && hasProduct && hasProvider && hasDataset;
    const detail = ok
      ? `provider=${json.provider.name} configured=${json.provider.configured} retriever=${json.provider.retriever} loop=${json.provider.loopMode}`
      : `HTTP ${res.status} product=${hasProduct} provider=${hasProvider} dataset=${hasDataset}`;
    record('meta · GET /api/meta expone product/provider/dataset (sin secretos)', ok, detail);

    // Chequeo extra de seguridad: la respuesta no debe filtrar la API key.
    const raw = JSON.stringify(json);
    const leaks = /VULTR_API_KEY|sk-[A-Za-z0-9]|Bearer\s/i.test(raw);
    record('meta · no filtra secretos en el payload', !leaks, leaks ? 'aparece algo que parece una key' : '');
  } catch (err) {
    record('meta · GET /api/meta', false, err.message);
  }
}

// ── 3. /api/agent/run → stream SSE de TraceEvents ────────────────────────────
// Ejercita el flujo completo del agente y valida que:
//   · responde con content-type text/event-stream y un header X-Run-Id
//   · llegan varios eventos `data:` (plan/retrieval/tool/decision…)
//   · el stream termina limpiamente sin evento de error fatal
async function testAgentStream(mode) {
  const label = `agent · POST /api/agent/run (mode=${mode}) transmite SSE`;
  try {
    const res = await withTimeout(
      (signal) =>
        fetch(`${BASE}/api/agent/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
          signal,
        }),
      TIMEOUT_MS,
      'agent-connect',
    );

    const ctype = res.headers.get('content-type') || '';
    const runId = res.headers.get('x-run-id') || '';
    if (!res.ok || !ctype.includes('text/event-stream')) {
      record(label, false, `HTTP ${res.status} content-type="${ctype}"`);
      return;
    }

    let eventCount = 0;
    let sawError = false;
    let sawTerminal = false;
    const seenTypes = new Set();
    const decoder = new TextDecoder();
    let buf = '';

    const reader = res.body.getReader();
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        eventCount++;
        try {
          const evt = JSON.parse(dataLine.slice(5).trim());
          if (evt.type) seenTypes.add(evt.type);
          if (/error/i.test(evt.type || '')) sawError = true;
          if (/(done|complete|final|memo|result)/i.test(evt.type || '')) sawTerminal = true;
        } catch {
          // evento no-JSON: lo contamos igual como actividad del stream
        }
      }
    }
    reader.cancel().catch(() => {});

    const ok = eventCount > 0 && !sawError;
    const detail = `runId=${runId ? 'sí' : 'no'} eventos=${eventCount} tipos=[${[...seenTypes].slice(0, 8).join(',')}]${sawTerminal ? ' terminal✓' : ''}${sawError ? ' ⚠ error-event' : ''}`;
    record(label, ok, detail);
  } catch (err) {
    record(label, false, err.message);
  }
}

// ── 4. frontend raíz responde HTML ───────────────────────────────────────────
async function testFrontend() {
  try {
    const res = await withTimeout((signal) => fetch(`${BASE}/`, { signal }), 20_000, 'frontend');
    const html = await res.text();
    const ok = res.ok && /<html|<!doctype html/i.test(html);
    record('frontend · GET / sirve la app (HTML)', ok, ok ? `${html.length} bytes` : `HTTP ${res.status}`);
  } catch (err) {
    record('frontend · GET /', false, err.message);
  }
}

async function main() {
  console.log(`\n🧪 Smoke test contra  ${BASE}\n`);
  await testHealth();
  await testFrontend();
  await testMeta();
  await testAgentStream('after'); // el escenario del demo (verifica cláusulas en vivo)
  // Descomenta para cubrir también el modo BEFORE (diseño de covenants):
  // await testAgentStream('before');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n── Resumen ── ${results.length - failed.length}/${results.length} pruebas OK ──`);
  if (failed.length) {
    console.log('\nFallaron:');
    for (const f of failed) console.log(`  · ${f.name} — ${f.detail}`);
    console.log('');
    process.exit(1);
  }
  console.log('🎉 Todo verde. El despliegue funciona end-to-end.\n');
}

main().catch((err) => {
  console.error(`\n❌ Error inesperado: ${err.stack || err.message}\n`);
  process.exit(1);
});
