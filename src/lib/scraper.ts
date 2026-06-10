import * as cheerio from 'cheerio';

export interface ScrapedData {
  html: string;
  title: string;
  metaDescription: string;
  titleLength: number;
  metaDescLength: number;
  h1s: string[];
  h2s: string[];
  formFieldCount: number;
  hasCTAAboveFold: boolean;
  hasTestimonials: boolean;
  mainCopy: string;
  url: string;
}

/**
 * Scrapea la URL dada y extrae los elementos relevantes para el análisis.
 * Si FIRECRAWL_API_KEY está definido, lo usa como fallback para sitios que bloquean fetch.
 */
export async function scrapeUrl(rawUrl: string): Promise<ScrapedData> {
  // Normalizar URL — aceptar "empresa.com" sin protocolo
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

  // --- Fallback a Firecrawl si está configurado ---
  // TODO: activar cuando haya sitios que bloqueen el fetch directo
  // if (process.env.FIRECRAWL_API_KEY) {
  //   return scrapeWithFirecrawl(url, process.env.FIRECRAWL_API_KEY);
  // }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DigitalAuditBot/1.0; +https://growthaudit.ar)',
      Accept: 'text/html,application/xhtml+xml',
    },
    // Timeout de 15s para no colgar el request indefinidamente
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`El sitio respondió con error HTTP ${response.status}. Verificá que la URL sea correcta.`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // ── Metadatos básicos ──────────────────────────────────────────────────────
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? '';

  // ── Headings ───────────────────────────────────────────────────────────────
  const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 8);

  // ── Formularios ────────────────────────────────────────────────────────────
  // Contamos campos visibles (excluimos hidden, submit y button)
  const formFieldCount = $(
    'form input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), form select, form textarea'
  ).length;

  // ── CTA above the fold (heurístico) ───────────────────────────────────────
  // Buscamos botones o links con palabras de acción en hero/header/primera sección
  const ctaKeywords = /contáctanos|contactanos|demo|prueba|gratis|free|empezar|empezá|comenzar|comenzá|comprar|compra|cotizar|cotizá|reunión|reunion|agenda|reservar|reservá|suscribir|suscribite|registrarse|registrate/i;
  const hasCTAAboveFold =
    $('header a, header button, [class*="hero"] a, [class*="hero"] button, section:first-of-type a, section:first-of-type button')
      .toArray()
      .some(el => ctaKeywords.test($(el).text())) ||
    $('a.btn, a.button, a.cta, button.cta, .btn-primary, .btn-main').first().length > 0;

  // ── Testimonios ───────────────────────────────────────────────────────────
  const testimonialSelectors = '[class*="testimonial"], [class*="review"], [class*="client"], [class*="opinion"], [class*="reseña"]';
  const testimonialKeywords = /testimonio|testimonial|reseña|review|opinión|opinion|estrella|star|calificación|clientes dicen/i;
  const hasTestimonials =
    $(testimonialSelectors).length > 0 ||
    testimonialKeywords.test($('body').text());

  // ── Copy principal ─────────────────────────────────────────────────────────
  // Removemos ruido y extraemos el texto más relevante
  $('script, style, noscript, nav, footer, [aria-hidden="true"]').remove();
  const mainCopy = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3_000);

  return {
    html,
    title,
    metaDescription,
    titleLength: title.length,
    metaDescLength: metaDescription.length,
    h1s,
    h2s,
    formFieldCount,
    hasCTAAboveFold,
    hasTestimonials,
    mainCopy,
    url,
  };
}
