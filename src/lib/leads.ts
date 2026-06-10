import fs from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisResult } from './claude.js';
import { notifyNewLead } from './email.js';

// Ruta al archivo de leads — relativa al CWD del proceso Node
const LEADS_FILE = path.join(process.cwd(), 'leads.json');

export interface Lead {
  timestamp: string;
  url: string;
  nombre: string;
  email: string;
  empresa: string;
  growthScore: number;
  analysis: AnalysisResult;
}

/**
 * Appendea el lead al archivo leads.json y lo loguea por consola.
 *
 * TODO: Conectar a CRM o Google Sheets cuando tengamos volumen.
 * Opciones sugeridas:
 *   - HubSpot: POST https://api.hubapi.com/crm/v3/objects/contacts
 *   - Pipedrive: POST https://api.pipedrive.com/v1/persons
 *   - Google Sheets: googleapis npm + Sheets API v4
 *   - Make/Zapier: webhook POST a trigger URL de cada plataforma
 */
export async function saveLead(lead: Lead): Promise<void> {
  let leads: Lead[] = [];

  try {
    const raw = await fs.readFile(LEADS_FILE, 'utf-8');
    leads = JSON.parse(raw);
    if (!Array.isArray(leads)) leads = [];
  } catch {
    // Archivo no existe todavía — arrancamos con array vacío
    leads = [];
  }

  leads.push(lead);

  await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf-8');

  // Log estructurado para monitoring básico
  console.log(
    `[LEAD] ${lead.timestamp} | Score: ${lead.growthScore}/100 | ${lead.empresa} (${lead.email}) → ${lead.url}`
  );

  // Notificación por email — falla silenciosamente para no afectar al usuario
  notifyNewLead(lead).catch(err =>
    console.error('[email] Error en notificación (no crítico):', err)
  );
}
