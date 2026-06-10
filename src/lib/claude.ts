import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ScrapedData } from './scraper.js';
import type { TrackingSignals } from './tracking.js';
import { buildTrackingContext } from './tracking.js';

// El cliente se inicializa una vez (singleton) para reutilizar conexión HTTP
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface AreaExplicacion {
  queSignifica: string; // 1 frase: qué significa el score para el negocio
  queCuesta:    string; // 1 frase: impacto en plata/clientes si está bajo
}

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
  areaExplicaciones: {
    seo:           AreaExplicacion;
    paidReadiness: AreaExplicacion;
    cro:           AreaExplicacion;
    tracking:      AreaExplicacion;
    mensaje:       AreaExplicacion;
  };
}

/**
 * Llama a Claude con los datos scrapeados + señales de tracking + ads
 * y retorna el JSON de análisis estructurado.
 *
 * Modelo: claude-sonnet-4-6 (balance costo/calidad para análisis de copywriting)
 */
export async function analyzeWithClaude(
  scraped: ScrapedData,
  tracking: TrackingSignals
): Promise<AnalysisResult> {
  const trackingContext = buildTrackingContext(tracking);

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

## COPY PRINCIPAL DEL SITIO
${scraped.mainCopy.slice(0, 2_500)}

---

## REGLAS CRÍTICAS (violación invalida el análisis):
1. SIN JERGA TÉCNICA en ninguna parte. Prohibido usar: H1, H2, meta description, píxel,
   GTM, GA4, Google Tag Manager, Meta Pixel, above the fold, CTA, conversión, bounce rate,
   crawl, indexación, schema, o cualquier término que un dueño de pyme no entendería.
   Si tenés que mencionar algo técnico, explicalo en criollo.
   MAL: "No detectamos Meta Pixel ni GA4 en el HTML del cliente."
   BIEN: "No sabés qué anuncios te generan ventas — si invertís en publicidad, estás volando a ciegas."
2. Cada oportunidad: título de MÁXIMO 6 palabras + detalle de MÁXIMO 2 frases cortas.
   Sin excepciones. Si usás más de 2 frases, cortá.
3. El detalle tiene que hablar de IMPACTO DE NEGOCIO: plata, ventas, clientes que se van,
   oportunidades perdidas. Que el dueño entienda "esto me está costando dinero".
4. Igual tenés que citar el dato real del sitio en las oportunidades para que no suene genérico.
5. El score de tracking se basa SOLO en lo detectado. NUNCA digas "no tenés tracking".
   Frasealo como "no pudimos verificar si medís tus resultados" o similar.
6. Devolver ÚNICAMENTE JSON válido — sin markdown, sin texto antes ni después.

## REGLAS PARA areaExplicaciones (CRÍTICO — leé con atención):
Para cada una de las 5 áreas, generá exactamente:
- "queSignifica": UNA SOLA FRASE que traduzca el puntaje al lenguaje del dueño.
  No describas qué es el área; decile qué implica SU puntaje concreto.
  Usá el score para calibrar el tono (bajo = hay un problema, alto = está bien).
  Citá datos reales del sitio cuando puedas (texto del título, cantidad de campos, etc.).
  MAL: "El SEO mide tu visibilidad en Google."
  BIEN: "Cuando alguien busca lo que ofrecés en Google, es difícil que te encuentre."
  BIEN (score alto): "Tu sitio está bien configurado para que Google lo muestre."
- "queCuesta": UNA SOLA FRASE de impacto en el negocio — plata, clientes, ventas.
  Solo si el score es bajo (≤13) ponele urgencia; si es alto (≥14) podés ser positivo.
  MAL: "Esto afecta tu tasa de conversión."
  BIEN: "Hay gente que te busca en Google y termina encontrando a tu competencia."
  BIEN (score alto): "Estás bien posicionado para capturar esas búsquedas."
  NO uses jerga. Sin excepciones.

## SCORING (cada categoría de 0 a 20, growthScore = suma de las 5):
- **seo (0-20):** title length, meta description, presencia y calidad de H1/H2
- **paidReadiness (0-20):** tracking detectado, calidad de landing para campañas de pago, presencia en Meta Ads
- **cro (0-20):** fricción del formulario, CTAs, testimonios, propuesta de valor above the fold
- **tracking (0-20):** SOLO basado en señales HTML detectadas — ni más ni menos
- **mensaje (0-20):** claridad del value proposition, diferenciación, tono orientado a conversión

## FORMATO DE RESPUESTA (JSON exacto, sin markdown):
{
  "growthScore": <suma de los 5 scores>,
  "scores": {
    "seo": <0-20>,
    "paidReadiness": <0-20>,
    "cro": <0-20>,
    "tracking": <0-20>,
    "mensaje": <0-20>
  },
  "areaExplicaciones": {
    "seo":           { "queSignifica": "<1 frase sin jerga>", "queCuesta": "<1 frase de impacto>" },
    "paidReadiness": { "queSignifica": "<1 frase sin jerga>", "queCuesta": "<1 frase de impacto>" },
    "cro":           { "queSignifica": "<1 frase sin jerga>", "queCuesta": "<1 frase de impacto>" },
    "tracking":      { "queSignifica": "<1 frase sin jerga>", "queCuesta": "<1 frase de impacto>" },
    "mensaje":       { "queSignifica": "<1 frase sin jerga>", "queCuesta": "<1 frase de impacto>" }
  },
  "oportunidades": [
    { "titulo": "<máximo 6 palabras, sin jerga>", "detalle": "<máximo 2 frases: dato real + impacto en plata>" },
    { "titulo": "<máximo 6 palabras, sin jerga>", "detalle": "<máximo 2 frases: dato real + impacto en plata>" },
    { "titulo": "<máximo 6 palabras, sin jerga>", "detalle": "<máximo 2 frases: dato real + impacto en plata>" }
  ]
}
`.trim();

  // ── Llamada a la API ───────────────────────────────────────────────────────
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2_000,
    system:
      'Sos un experto en performance marketing. ' +
      'Analizás presencia digital con criterio de negocio y devolvés únicamente JSON válido, ' +
      'sin markdown ni texto adicional. Hablás en español rioplatense, directo, ' +
      'como explicándole a un dueño de pyme que no sabe de marketing.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Respuesta inesperada de Claude (tipo no texto)');
  }

  // ── Parseo y validación del JSON ───────────────────────────────────────────
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

  // Garantizar que areaExplicaciones exista aunque Claude no lo devuelva
  if (!result.areaExplicaciones) {
    result.areaExplicaciones = {} as AnalysisResult['areaExplicaciones'];
  }

  // Clamp scores a sus rangos válidos
  result.growthScore = Math.max(0, Math.min(100, Math.round(result.growthScore)));
  for (const key of ['seo', 'paidReadiness', 'cro', 'tracking', 'mensaje'] as const) {
    result.scores[key] = Math.max(0, Math.min(20, Math.round(result.scores[key] ?? 0)));
  }

  return result;
}
