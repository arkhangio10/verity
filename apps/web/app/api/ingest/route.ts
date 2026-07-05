import { extractPdfText } from '@covenant/adapters';
import { addUpload, ingestFile } from '../../../lib/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** POST /api/ingest (multipart form: file, session) → ingests one uploaded
 *  file through the real PeruAdapter and reports the mapping quality. */
export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'se esperaba multipart/form-data' }, { status: 400 });
  }
  const file = form.get('file');
  const sessionId = String(form.get('session') ?? 'default');
  if (!(file instanceof File)) {
    return Response.json({ error: 'no se recibió ningún archivo' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `archivo demasiado grande (máx ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name || 'archivo';
  const isPdf = /pdf$/i.test(name) || file.type === 'application/pdf';
  const isJson = /json$/i.test(name) || file.type === 'application/json';

  try {
    let text: string | undefined;
    let json: unknown;
    if (isPdf) {
      text = await extractPdfText(bytes);
    } else if (isJson) {
      json = new TextDecoder().decode(bytes);
    } else {
      // treat anything else as plain text (e.g. a pasted statement .txt/.csv)
      text = new TextDecoder().decode(bytes);
    }

    const result = await ingestFile({
      filename: name,
      contentType: file.type,
      text,
      json,
      sizeBytes: file.size,
    });
    addUpload(sessionId, result);
    // strip the heavy document/filing payloads from the response
    const { document, filing, ...meta } = result;
    return Response.json({ ok: result.status !== 'failed', doc: meta });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
