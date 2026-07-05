/**
 * Vultr Serverless Inference — verificación de conexión en vivo.
 *
 * Uso:
 *   1. Pega tu VULTR_API_KEY en el archivo .env
 *   2. node scripts/check-vultr.mjs
 *
 * Qué hace:
 *   - GET  /models          → lista los modelos reales de tu cuenta (chat + embeddings)
 *   - POST /chat/completions → una inferencia de prueba (confirma que la key funciona)
 *   - POST /embeddings       → prueba de embeddings si hay un modelo de ese tipo
 *
 * No modifica nada. Solo lee .env y llama al endpoint real.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// — carga mínima de .env (sin dependencias) —
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trimStart().startsWith('#')) {
        env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // sin .env: usa process.env
  }
  return env;
}

const env = loadEnv();
const apiKey = env.VULTR_API_KEY?.trim();
const baseUrl = (env.VULTR_INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1').replace(/\/+$/, '');

if (!apiKey) {
  console.error('\n❌ VULTR_API_KEY está vacía en .env.\n   Pega tu key en el archivo .env y vuelve a correr este script.\n');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
const mask = `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
console.log(`\n🔑 Key cargada (${mask}) · endpoint ${baseUrl}\n`);

async function main() {
  // ── 1. GET /models ─────────────────────────────────────────────────────
  console.log('── GET /models ─────────────────────────────────────────────');
  const modelsRes = await fetch(`${baseUrl}/models`, { headers });
  if (!modelsRes.ok) {
    console.error(`❌ HTTP ${modelsRes.status}: ${await modelsRes.text().catch(() => '')}`);
    console.error('   Revisa que la key sea correcta y tenga acceso a Serverless Inference.\n');
    process.exit(1);
  }
  const modelsJson = await modelsRes.json();
  const models = (modelsJson.data ?? modelsJson.models ?? modelsJson ?? []);
  const ids = (Array.isArray(models) ? models : []).map((m) => m.id ?? m.name ?? m).filter(Boolean);
  console.log(`✅ ${ids.length} modelo(s) disponible(s):`);
  for (const id of ids) console.log(`   · ${id}`);

  const looksEmbed = (id) => /embed|bge|e5|gte|minilm|vultron/i.test(id);
  const chatCandidates = ids.filter((id) => !looksEmbed(id));
  const embedCandidates = ids.filter(looksEmbed);

  const chatModel = ids.includes(env.VULTR_CHAT_MODEL) ? env.VULTR_CHAT_MODEL : chatCandidates[0];
  const embedModel = ids.includes(env.VULTR_EMBED_MODEL) ? env.VULTR_EMBED_MODEL : embedCandidates[0];

  console.log('\n── Sugerencia para tu .env ─────────────────────────────────');
  console.log(`   VULTR_CHAT_MODEL=${chatModel ?? '(elige uno de la lista de arriba)'}`);
  console.log(`   VULTR_EMBED_MODEL=${embedModel ?? '(no se detectó modelo de embeddings; deja vacío → fallback léxico)'}`);

  // ── 2. POST /chat/completions ──────────────────────────────────────────
  if (chatModel) {
    console.log(`\n── POST /chat/completions (${chatModel}) ───────────────────`);
    const chatRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: 'system', content: 'You are a terse assistant.' },
          { role: 'user', content: 'Reply with exactly: Vultr live inference OK' },
        ],
        max_tokens: 20,
        temperature: 0,
      }),
    });
    if (!chatRes.ok) {
      console.error(`❌ HTTP ${chatRes.status}: ${await chatRes.text().catch(() => '')}`);
    } else {
      const j = await chatRes.json();
      const text = j.choices?.[0]?.message?.content ?? '(sin contenido)';
      console.log(`✅ Respuesta del modelo: "${text.trim()}"`);
      if (j.usage) console.log(`   tokens: prompt ${j.usage.prompt_tokens}, completion ${j.usage.completion_tokens}`);
    }
  }

  // ── 3. POST /embeddings (opcional) ─────────────────────────────────────
  if (embedModel) {
    console.log(`\n── POST /embeddings (${embedModel}) ────────────────────────`);
    const embRes = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: embedModel, input: ['covenant leverage ratio'] }),
    });
    if (!embRes.ok) {
      console.error(`❌ HTTP ${embRes.status}: ${await embRes.text().catch(() => '')}`);
    } else {
      const j = await embRes.json();
      const dim = j.data?.[0]?.embedding?.length ?? 0;
      console.log(`✅ Embedding recibido · ${dim} dimensiones`);
    }
  } else {
    console.log('\nℹ️  Sin modelo de embeddings → la app usará el retriever léxico (BM25). Está bien para el demo.');
  }

  console.log('\n🎉 Verificación completa. Copia los model IDs sugeridos a tu .env, luego:');
  console.log('   npm run dev   → el badge debe decir  VULTR · <modelo>\n');
}

main().catch((err) => {
  console.error(`\n❌ Error de red: ${err.message}\n`);
  process.exit(1);
});
