import type { APIRoute } from 'astro';
import { scrapeUrl } from '../../lib/scraper.js';
import { detectTracking } from '../../lib/tracking.js';
import { analyzeWithClaude } from '../../lib/claude.js';
import { saveLead } from '../../lib/leads.js';

// Forzar renderizado en servidor (no pre-renderizar)
export const prerender = false;

/**
 * POST /api/analyze
 * Body: { url, nombre, email, empresa }
 *
 * Responde con text/event-stream (SSE) emitiendo:
 *   event: progress  → { step: 1-4, label: string }
 *   event: result    → AnalysisResult completo
 *   event: error     → { message: string }
 */
/** Validación de email (misma regex que el cliente) */
function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);

  if (!body?.url) {
    return new Response(JSON.stringify({ error: 'URL requerida' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { url, nombre = '', email = '', empresa = '' } = body;

  // Validación server-side — rechaza leads con datos inválidos
  if (!email || !isValidEmail(email)) {
    return new Response(JSON.stringify({ error: 'Email inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!nombre || nombre.trim().length < 2) {
    return new Response(JSON.stringify({ error: 'Nombre requerido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!empresa || empresa.trim().length < 2) {
    return new Response(JSON.stringify({ error: 'Empresa requerida' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  // ── ReadableStream para SSE ────────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      /** Envía un evento SSE al cliente */
      function send(event: string, data: unknown) {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }

      try {
        // ── Paso 1: Scraping y revisión de UX ─────────────────────────────
        send('progress', { step: 1, label: 'Revisando UX y estructura...' });
        const scraped = await scrapeUrl(url);

        // ── Paso 2: Tracking ───────────────────────────────────────────────
        send('progress', { step: 2, label: 'Revisando medición y seguimiento...' });
        const tracking = detectTracking(scraped.html);

        // ── Paso 3: Preparando análisis SEO ────────────────────────────────
        send('progress', { step: 3, label: 'Evaluando posicionamiento en Google...' });
        await new Promise(r => setTimeout(r, 400));

        // ── Paso 4: Llamada a Claude ────────────────────────────────────────
        send('progress', { step: 4, label: 'Armando el panorama completo de tu marca...' });
        const analysis = await analyzeWithClaude(scraped, tracking);

        // ── Guardar lead ────────────────────────────────────────────────────
        await saveLead({
          timestamp: new Date().toISOString(),
          url,
          nombre,
          email,
          empresa,
          growthScore: analysis.growthScore,
          analysis,
        }).catch(err => {
          // No rompemos el flujo si falla el guardado del lead
          console.error('[Lead] Error al guardar:', err);
        });

        // ── Enviar resultado final ──────────────────────────────────────────
        send('result', analysis);

      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Ocurrió un error inesperado al analizar el sitio.';
        console.error('[analyze] Error:', err);
        send('error', { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      // Evitar buffering en proxies/nginx
      'X-Accel-Buffering': 'no',
    },
  });
};
