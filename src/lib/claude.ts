import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ScrapedData } from './scraper.js';
import type { TrackingSignals } from './tracking.js';
import { buildTrackingContext } from './tracking.js';
import type { AdDetectionResult } from './ads.js';
import { buildAdsContext } from './ads.js';

// El cliente se inicializa una vez (singleton) para reutilizar conexión HTTP
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface AnalysisResult {
  growthScore: number;
  scores: {
    seo: number;
    paidReadiness: number;
    cro: number;
    tracking: number;
    mensaje: number;
  };
  oportunidades: Array<{ titulo: string; detalle: string }>;
}

/**
 * Llama a Claude con los datos scrapeados + señales de tracking
 * y retorna el JSON de análisis estructurado.
 *
 * Modelo: claude-sonnet-4-6 (balance costo/calidad para análisis de copywriting)
 */
export async function analyzeWithClaude(
  scraped: ScrapedData,
  tracking: TrackingSignals,
  ads: AdDetectionResult
): Promise<AnalysisResult> {
  const trackingContext = buildTrackingContext(tracking);
  const adsContext = buildAdsContext(ads);

  // ── Prompt de usuario con todos los datos del sitio ────────────────────────
  const userPrompt = `
Analizá este sitio web como consultor de performance marketing y devolvé el JSON de evaluación.

## DATOS DEL SITIO (${scraped.url})
- **Title:** "${scraped.title}" (${scraped.titleLength} caracteres)
- **Meta Description:** "${scraped.metaDescription}" (${scraped.metaDescLength} caracteres)
- **H1s encontrados:** ${scraped.h1s.length > 0 ? scraped.h1s.map(h => `"${h}"`).join(' | ') : 'NINGUNO'}
- **H2s (primeros 8):** ${scraped.h2s.length > 0 ? scraped.h2s.map(h => `"${h}"`).join(' | ') : 'NINGUNO'}
- **Campos en formulario principal:** ${scraped.formFieldCount}
- **CTA visible above the fold:** ${scraped.hasCTAAboveFold ? 'Sí' : 'No detectado'}
- **Testimonios/reseñas:** ${scraped.hasTestimonials ? 'Detectados' : 'No detectados'}

## TRACKING DEL LADO DEL CLIENTE
${trackingContext}

## PUBLICIDAD EN META (detección pública)
${adsContext}

## COPY PRINCIPAL DEL SITIO
${scraped.mainCopy.slice(0, 2_500)}

---

## REGLAS CRÍTICAS (violación invalida el análisis):
1. SIN JERGA TÉCNICA en las oportunidades. Prohibido usar: H1, H2, meta description, píxel,
   GTM, GA4, Google Tag Manager, Meta Pixel, above the fold, CTA, conversión, bounce rate,
   crawl, indexación, schema, o cualquier término que un dueño de pyme no entendería.
   Si tenés que mencionar algo técnico, explicalo en criollo.
   MAL: "No detectamos Meta Pixel ni GA4 en el HTML del cliente."
   BIEN: "No sabés qué anuncios te generan ventas — si invertís en publicidad, estás volando a ciegas."
2. Cada oportunidad: título de MÁXIMO 6 palabras + detalle de MÁXIMO 2 frases cortas.
   Sin excepciones. Si usás más de 2 frases, cortá.
3. El detalle tiene que hablar de IMPACTO DE NEGOCIO: plata, ventas, clientes que se van,
   oportunidades perdidas. Que el dueño entienda "esto me está costando dinero".
   MAL: "Tu formulario tiene 4 campos lo que genera fricción en el proceso de conversión."
   BIEN: "Tu formulario pide ${scraped.formFieldCount} datos antes de que el cliente
   te contacte — cada campo extra que sobra hace que se vayan sin escribirte."
4. Igual tenés que citar el dato real del sitio (número de campos, texto exacto del título,
   cantidad de caracteres, lo que sea) para que no suene genérico — pero traducido a
   por qué le importa al dueño, no como diagnóstico técnico.
5. El score de tracking se basa SOLO en lo detectado. NUNCA digas "no tenés tracking".
   Siempre frasealo como "no pudimos verificar si medís tus resultados" o similar, porque
   existen implementaciones del lado del servidor que son invisibles para este análisis.
5b. Para la publicidad en Meta: usá el dato de ads para enriquecer las oportunidades.
    - Si NO corre ads y el sitio tiene buen score → oportunidad de empezar a invertir en pauta.
    - Si SÍ corre ads pero el sitio puntúa bajo en conversión o preparación → oportunidad
      de optimizar el sitio para no desperdiciar la inversión en publicidad.
    - Frasealo siempre como "desde la búsqueda pública de Meta" o "del lado del cliente",
      nunca como afirmación absoluta.
6. Devolver ÚNICAMENTE JSON válido — sin markdown, sin texto antes ni después.

## SCORING (cada categoría de 0 a 20, growthScore = suma de las 5):
- **seo (0-20):** title length, meta description, presencia y calidad de H1/H2
- **paidReadiness (0-20):** tracking detectado, calidad de landing para campañas de pago, si la empresa ya está invirtiendo en Meta Ads o no
- **cro (0-20):** fricción del formulario, CTAs, testimonios, propuesta de valor above the fold
- **tracking (0-20):** SOLO basado en señales HTML detectadas — ni más ni menos
- **mensaje (0-20):** claridad del value proposition, diferenciación, tono orientado a conversión

## FORMATO DE RESPUESTA (JSON exacto):
{
  "growthScore": <suma de los 5 scores>,
  "scores": {
    "seo": <0-20>,
    "paidReadiness": <0-20>,
    "cro": <0-20>,
    "tracking": <0-20>,
    "mensaje": <0-20>
  },
  "oportunidades": [
    { "titulo": "<máximo 6 palabras, sin jerga>", "detalle": "<máximo 2 frases cortas: citá el dato real del sitio + impacto en ventas o plata>" },
    { "titulo": "<máximo 6 palabras, sin jerga>", "detalle": "<máximo 2 frases cortas: citá el dato real del sitio + impacto en ventas o plata>" },
    { "titulo": "<máximo 6 palabras, sin jerga>", "detalle": "<máximo 2 frases cortas: citá el dato real del sitio + impacto en ventas o plata>" }
  ]
}
`.trim();

  // ── Llamada a la API ───────────────────────────────────────────────────────
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1_200,
    system:
      'Sos un experto en performance marketing y CRO. ' +
      'Analizás sitios web con criterio de negocio y devolvés únicamente JSON válido, sin markdown ni texto adicional.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Respuesta inesperada de Claude (tipo no texto)');
  }

  // ── Parseo y validación del JSON ───────────────────────────────────────────
  // A veces Claude igualmente wrappea en ```json ... ``` aunque le pedimos que no
  const jsonText = content.text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let result: AnalysisResult;
  try {
    result = JSON.parse(jsonText);
  } catch {
    console.error('[Claude] Respuesta que no se pudo parsear:', content.text.slice(0, 500));
    throw new Error('No se pudo parsear la respuesta del análisis. Intentá de nuevo.');
  }

  // Validación mínima de estructura
  if (
    typeof result.growthScore !== 'number' ||
    !result.scores ||
    !Array.isArray(result.oportunidades) ||
    result.oportunidades.length < 1
  ) {
    throw new Error('La respuesta del análisis tiene formato inválido.');
  }

  // Asegurar exactamente 3 oportunidades
  result.oportunidades = result.oportunidades.slice(0, 3);

  // Clamp scores a sus rangos válidos
  result.growthScore = Math.max(0, Math.min(100, Math.round(result.growthScore)));
  for (const key of ['seo', 'paidReadiness', 'cro', 'tracking', 'mensaje'] as const) {
    result.scores[key] = Math.max(0, Math.min(20, Math.round(result.scores[key] ?? 0)));
  }

  return result;
}
