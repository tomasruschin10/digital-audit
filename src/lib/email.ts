import 'dotenv/config';
import { Resend } from 'resend';
import type { Lead } from './leads.js';

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL    = process.env.NOTIFY_EMAIL;   // tu email destino
const FROM_EMAIL      = process.env.FROM_EMAIL;     // ej: notificaciones@tudominio.com

/**
 * Manda un email de notificación por cada lead nuevo.
 * Si falta configuración o falla el envío, loguea y retorna sin tirar.
 */
export async function notifyNewLead(lead: Lead): Promise<void> {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL || !FROM_EMAIL) {
    // Configuración incompleta — silencioso para no romper el flujo
    if (!RESEND_API_KEY) console.warn('[email] RESEND_API_KEY no definida — notificaciones desactivadas.');
    return;
  }

  const resend = new Resend(RESEND_API_KEY);

  const scoreEmoji =
    lead.growthScore >= 71 ? '🟢' :
    lead.growthScore >= 41 ? '🟡' : '🔴';

  const oportunidades = (lead.analysis.oportunidades ?? [])
    .map((op, i) => `${i + 1}. ${op.titulo} — ${op.detalle}`)
    .join('\n');

  const text = `
Nuevo lead en Growth Audit
──────────────────────────
Nombre:    ${lead.nombre}
Email:     ${lead.email}
Empresa:   ${lead.empresa}
URL:       ${lead.url}
Score:     ${scoreEmoji} ${lead.growthScore}/100
Fecha:     ${new Date(lead.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}

Desglose:
  SEO:          ${lead.analysis.scores.seo}/20
  Publicidad:   ${lead.analysis.scores.paidReadiness}/20
  Conversión:   ${lead.analysis.scores.cro}/20
  Medición:     ${lead.analysis.scores.tracking}/20
  Mensaje:      ${lead.analysis.scores.mensaje}/20

Oportunidades detectadas:
${oportunidades}
`.trim();

  const html = `
<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a;">
  <h2 style="margin:0 0 4px;font-size:20px;">🎯 Nuevo lead — Growth Audit</h2>
  <p style="margin:0 0 20px;color:#64748b;font-size:14px;">${new Date(lead.timestamp).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</p>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
    <tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">Nombre</td><td style="padding:6px 0;font-weight:600;">${esc(lead.nombre)}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:6px 12px 6px 0;color:#64748b;">Email</td><td style="padding:6px 0;"><a href="mailto:${esc(lead.email)}" style="color:#6366f1;">${esc(lead.email)}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Empresa</td><td style="padding:6px 0;font-weight:600;">${esc(lead.empresa)}</td></tr>
    <tr style="background:#f8fafc;"><td style="padding:6px 12px 6px 0;color:#64748b;">URL</td><td style="padding:6px 0;"><a href="${esc(lead.url.startsWith('http') ? lead.url : 'https://' + lead.url)}" style="color:#6366f1;">${esc(lead.url)}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#64748b;">Growth Score</td><td style="padding:6px 0;font-size:18px;font-weight:800;">${scoreEmoji} ${lead.growthScore}<span style="font-size:13px;font-weight:400;color:#94a3b8;">/100</span></td></tr>
  </table>

  <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">Desglose por área</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
    ${[
      ['SEO', lead.analysis.scores.seo],
      ['Publicidad', lead.analysis.scores.paidReadiness],
      ['Conversión', lead.analysis.scores.cro],
      ['Medición', lead.analysis.scores.tracking],
      ['Mensaje', lead.analysis.scores.mensaje],
    ].map(([label, score], i) => `
      <tr ${i % 2 ? 'style="background:#f8fafc;"' : ''}>
        <td style="padding:5px 12px 5px 0;color:#475569;">${label}</td>
        <td style="padding:5px 0;font-weight:600;">${score}<span style="color:#94a3b8;font-weight:400;">/20</span></td>
      </tr>
    `).join('')}
  </table>

  <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">Oportunidades detectadas</h3>
  ${(lead.analysis.oportunidades ?? []).map((op, i) => `
    <div style="margin-bottom:12px;padding:12px;background:#f8fafc;border-left:3px solid #f97316;border-radius:0 6px 6px 0;">
      <div style="font-weight:700;margin-bottom:4px;">${i + 1}. ${esc(op.titulo)}</div>
      <div style="font-size:13px;color:#475569;">${esc(op.detalle)}</div>
    </div>
  `).join('')}
</div>
`;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to:   NOTIFY_EMAIL,
      subject: `🎯 Nuevo lead: ${lead.empresa} · Score ${lead.growthScore}/100`,
      text,
      html,
    });

    if (error) {
      console.error('[email] Resend devolvió error:', error);
    } else {
      console.log(`[email] Notificación enviada a ${NOTIFY_EMAIL} — ${lead.empresa} (${lead.growthScore}/100)`);
    }
  } catch (err) {
    console.error('[email] Error inesperado al enviar notificación:', err);
  }
}

function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
