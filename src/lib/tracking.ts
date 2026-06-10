/**
 * Detección de tracking del lado del cliente.
 *
 * IMPORTANTE: Todo lo que detectamos acá es basado en el HTML/JS cargado en el browser.
 * Implementaciones server-side (CAPI de Meta, GTM server-side, etc.) son completamente
 * invisibles para este análisis. NUNCA afirmar que un sitio "no tiene tracking".
 */

export interface TrackingSignals {
  metaPixel: boolean;
  gtm: boolean;
  ga4: boolean;
  googleAds: boolean;
  hotjar: boolean;
  clarity: boolean;
  consentMode: boolean;
  /** Herramientas detectadas en el HTML */
  detected: string[];
  /** Herramientas no detectadas del lado del cliente (pueden existir server-side) */
  notDetectedClientSide: string[];
}

const ALL_TOOLS = [
  'Meta Pixel',
  'Google Tag Manager',
  'Google Analytics 4',
  'Google Ads Conversions',
  'Hotjar',
  'Microsoft Clarity',
];

export function detectTracking(html: string): TrackingSignals {
  const detected: string[] = [];

  // ── Meta Pixel ─────────────────────────────────────────────────────────────
  // Firmas: dominio del script y llamada al pixel
  const metaPixel = html.includes('connect.facebook.net') || html.includes('fbq(');
  if (metaPixel) detected.push('Meta Pixel');

  // ── Google Tag Manager ─────────────────────────────────────────────────────
  // Firmas: URL del contenedor y el prefijo estándar GTM-
  const gtm = html.includes('googletagmanager.com/gtm.js') || html.includes('GTM-');
  if (gtm) detected.push('Google Tag Manager');

  // ── Google Analytics 4 ─────────────────────────────────────────────────────
  // GA4 usa IDs que empiezan con G- (a diferencia de UA- de Universal Analytics)
  const ga4 =
    html.includes("gtag('config','G-") ||
    html.includes('gtag("config","G-') ||
    html.includes("gtag('config', 'G-") ||
    html.includes('gtag("config", "G-');
  if (ga4) detected.push('Google Analytics 4');

  // ── Google Ads Conversions ─────────────────────────────────────────────────
  // Los IDs de Ads empiezan con AW-
  const googleAds = html.includes('AW-');
  if (googleAds) detected.push('Google Ads Conversions');

  // ── Hotjar ─────────────────────────────────────────────────────────────────
  const hotjar = html.includes('static.hotjar.com');
  if (hotjar) detected.push('Hotjar');

  // ── Microsoft Clarity ─────────────────────────────────────────────────────
  const clarity = html.includes('clarity.ms');
  if (clarity) detected.push('Microsoft Clarity');

  // ── Google Consent Mode ────────────────────────────────────────────────────
  // Señal de que manejan consentimiento correctamente
  const consentMode =
    html.includes("gtag('consent'") || html.includes('gtag("consent"');

  const notDetectedClientSide = ALL_TOOLS.filter(t => !detected.includes(t));

  return {
    metaPixel,
    gtm,
    ga4,
    googleAds,
    hotjar,
    clarity,
    consentMode,
    detected,
    notDetectedClientSide,
  };
}

/** Genera el bloque de texto de tracking para pasarle a Claude */
export function buildTrackingContext(t: TrackingSignals): string {
  const lines: string[] = [];

  if (t.detected.length > 0) {
    lines.push(`Detectado en HTML del cliente: ${t.detected.join(', ')}.`);
  } else {
    lines.push('No se detectó ningún tracking del lado del cliente en el HTML.');
  }

  if (t.notDetectedClientSide.length > 0) {
    lines.push(
      `No detectado del lado del cliente (puede existir implementación server-side invisible para este análisis): ${t.notDetectedClientSide.join(', ')}.`
    );
  }

  if (t.consentMode) {
    lines.push('Google Consent Mode está implementado (buena señal para compliance y Smart Bidding).');
  }

  return lines.join('\n');
}
