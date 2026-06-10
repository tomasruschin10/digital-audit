/**
 * Detección de publicidad activa en Meta Ad Library.
 * Siempre devuelve el link directo a la Ad Library (confiable 100%).
 * El conteo de anuncios es best-effort: si falla, retorna null sin romper nada.
 */

export interface AdDetectionResult {
  searchTerm: string;
  adLibraryUrl: string;
  adCount: number | null;    // null = no se pudo determinar
  detected: boolean | null;  // null = no se pudo determinar
}

/**
 * Extrae el término de búsqueda más útil.
 * Prioriza el nombre de empresa sobre el dominio.
 */
function extractSearchTerm(empresa: string, rawUrl: string): string {
  const trimmed = empresa?.trim();
  // Usamos el nombre de empresa si no parece un dominio
  if (trimmed && trimmed.length > 2 && !trimmed.includes('.')) {
    return trimmed;
  }
  // Fallback: raíz del dominio (ej: "zimba" de "zimba.com.ar")
  try {
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname.split('.')[0];
  } catch {
    return trimmed || rawUrl;
  }
}

export function buildAdLibraryUrl(searchTerm: string): string {
  return (
    `https://www.facebook.com/ads/library/` +
    `?active_status=active&ad_type=all&country=AR` +
    `&q=${encodeURIComponent(searchTerm)}&search_type=keyword_unordered`
  );
}

/**
 * Intenta traer la cantidad de anuncios activos desde el endpoint
 * asíncrono de la Ad Library. Meta bloquea muchas requests, así que
 * el resultado es best-effort y falla silenciosamente.
 */
async function fetchAdCount(
  searchTerm: string
): Promise<{ adCount: number | null; detected: boolean | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  const url =
    `https://www.facebook.com/ads/library/async/search_ads/` +
    `?q=${encodeURIComponent(searchTerm)}` +
    `&active_status=active&ad_type=all&country=AR` +
    `&search_type=keyword_unordered&media_type=all`;

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'es-AR,es;q=0.9',
    },
  });
  clearTimeout(timer);

  if (!res.ok) return { adCount: null, detected: null };

  const text = await res.text();

  // Buscar patrones de conteo en la respuesta JSON
  for (const pattern of [
    /"total_count"\s*:\s*(\d+)/,
    /"collation_count"\s*:\s*(\d+)/,
    /"totalCount"\s*:\s*(\d+)/,
  ]) {
    const match = text.match(pattern);
    if (match) {
      const count = parseInt(match[1], 10);
      return { adCount: count, detected: count > 0 };
    }
  }

  // Si la respuesta tiene contenido pero sin conteo reconocible
  return { adCount: null, detected: null };
}

export async function detectMetaAds(
  empresa: string,
  rawUrl: string
): Promise<AdDetectionResult> {
  const searchTerm = extractSearchTerm(empresa, rawUrl);
  const adLibraryUrl = buildAdLibraryUrl(searchTerm);

  try {
    const { adCount, detected } = await fetchAdCount(searchTerm);
    return { searchTerm, adLibraryUrl, adCount, detected };
  } catch {
    // Timeout, bloqueo de Meta, error de red — silencioso
    return { searchTerm, adLibraryUrl, adCount: null, detected: null };
  }
}

/**
 * Formatea el contexto de ads para incluir en el prompt de Claude.
 */
export function buildAdsContext(ads: AdDetectionResult): string {
  if (ads.detected === true) {
    const n = ads.adCount != null ? `${ads.adCount} anuncios activos` : 'anuncios activos';
    return `- Publicidad en Meta: se detectaron ${n} en la biblioteca pública para "${ads.searchTerm}".`;
  }
  if (ads.detected === false) {
    return `- Publicidad en Meta: no se detectaron anuncios activos en la biblioteca pública para "${ads.searchTerm}". (Pueden existir campañas en otros canales o con otra segmentación geográfica.)`;
  }
  return `- Publicidad en Meta: no se pudo verificar desde la búsqueda pública (la empresa puede tener anuncios no detectables con este método del lado del cliente).`;
}
