/**
 * Detección de publicidad activa en Meta Ad Library.
 *
 * Estrategia conservadora: SOLO se genera un link si se puede resolver el
 * page ID numérico de la página de Facebook (el único link que va directo
 * a los anuncios de esa página específica).
 *
 * Si no se obtiene el page ID → devolvemos pageId: undefined y el frontend
 * NO renderiza la sección de Meta.
 */

export interface AdDetectionResult {
  searchTerm: string;           // término usado (para debug/logs)
  adLibraryUrl: string | null;  // null si no hay pageId
  pageId?: string;              // ID numérico resuelto (undefined = no se pudo)
  facebookPageSlug?: string;    // slug encontrado en el sitio
}

// Orden de user-agents a probar.
// facebookexternalhit va primero: Facebook le devuelve 200 con HTML completo
// mientras que los UAs de navegador frecuentemente reciben 400 o el login wall.
const USER_AGENTS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  // Chrome como fallback por si FB cambia el comportamiento
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

// Patrones para extraer el page ID numérico del HTML de una página de Facebook.
// Los IDs de página tienen ≥ 10 dígitos.
const PAGE_ID_PATTERNS = [
  /"pageID"\s*:\s*"(\d{10,})"/,
  /"page_id"\s*:\s*"(\d{10,})"/,
  /fb:\/\/page\/(\d{10,})/,
  /"entity_id"\s*:\s*"(\d{10,})"/,
  /"profile_id"\s*:\s*"(\d{10,})"/,
  /"userID"\s*:\s*"(\d{10,})"/,
  /"actorID"\s*:\s*"(\d{10,})"/,
  /"owner"\s*:\s*\{"id"\s*:\s*"(\d{10,})"/,
  // og:url puede ser "https://www.facebook.com/1234567890123" (perfil con ID)
  /content="https?:\/\/www\.facebook\.com\/(\d{10,})"/,
  // page_id en query strings embebidos
  /[?&]page_id=(\d{10,})/,
  // "ent_id":"12345..." — presente en algunos bundles de FB
  /"ent_id"\s*:\s*"(\d{10,})"/,
];

/**
 * Intenta obtener el page ID numérico de una página pública de Facebook.
 * Prueba múltiples user-agents; falla silenciosamente si ninguno funciona.
 */
async function resolvePageId(slug: string): Promise<string | null> {
  for (const ua of USER_AGENTS) {
    const result = await fetchAndExtractId(slug, ua);
    if (result) return result;
  }
  return null;
}

async function fetchAndExtractId(slug: string, userAgent: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  try {
    const res = await fetch(`https://www.facebook.com/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent':      userAgent,
        Accept:            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        'Cache-Control':   'no-cache',
      },
      // Seguir redirects (301/302 son comunes en páginas de FB)
      redirect: 'follow',
    });
    clearTimeout(timer);

    // Si redirige a login, el HTML no tendrá datos útiles — lo descartamos
    if (!res.ok) return null;
    const finalUrl = res.url ?? '';
    if (finalUrl.includes('/login') || finalUrl.includes('checkpoint')) return null;

    const html = await res.text();

    // Si la respuesta pide login, no habrá datos de página
    if (html.includes('id="login_form"') || html.includes('"loginRequired"')) return null;

    for (const pat of PAGE_ID_PATTERNS) {
      const m = html.match(pat);
      if (m?.[1]) return m[1];
    }
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Arma el link exacto a la Ad Library con view_all_page_id.
 * Este formato lleva DIRECTO a los anuncios de esa página.
 */
export function buildAdLibraryUrl(pageId: string): string {
  return (
    'https://www.facebook.com/ads/library/' +
    '?active_status=active' +
    '&ad_type=all' +
    '&country=ALL' +
    '&is_targeted_country=false' +
    '&media_type=all' +
    '&search_type=page' +
    '&sort_data[direction]=desc' +
    '&sort_data[mode]=total_impressions' +
    `&view_all_page_id=${pageId}`
  );
}

/**
 * Entrada principal: intenta resolver el page ID.
 * Si falla, adLibraryUrl queda null y el frontend no muestra la sección.
 */
export async function detectMetaAds(
  empresa: string,
  rawUrl: string,
  facebookPageSlug?: string
): Promise<AdDetectionResult> {
  // searchTerm solo para logs/debug
  const searchTerm = empresa?.trim() || rawUrl;

  if (!facebookPageSlug) {
    return { searchTerm, adLibraryUrl: null, facebookPageSlug };
  }

  const pageId = await resolvePageId(facebookPageSlug).catch(() => null) ?? undefined;

  const adLibraryUrl = pageId ? buildAdLibraryUrl(pageId) : null;

  return {
    searchTerm,
    adLibraryUrl,
    pageId,
    facebookPageSlug,
  };
}

/**
 * Formatea el contexto de ads para el prompt de Claude.
 * Solo se llama si hay pageId; de lo contrario el análisis omite Meta.
 */
export function buildAdsContext(ads: AdDetectionResult): string {
  if (ads.pageId) {
    return `- Publicidad en Meta: se encontró la página facebook.com/${ads.facebookPageSlug ?? ''} (ID ${ads.pageId}). El link directo a sus anuncios fue generado.`;
  }
  if (ads.facebookPageSlug) {
    return `- Publicidad en Meta: se detectó el link a facebook.com/${ads.facebookPageSlug} en el sitio, pero no se pudo resolver el ID numérico para generar un link directo.`;
  }
  return `- Publicidad en Meta: no se encontró ningún link a Facebook en el sitio.`;
}
