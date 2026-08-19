import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '../../scraper/collector.py');
const discoveryScriptPath = resolve(here, '../../scraper/discover.py');
const stfJurisprudenceScriptPath = resolve(here, '../../scraper/stf_jurisprudence.py');
const djenCadernoScriptPath = resolve(here, '../../scraper/djen_caderno.py');

const allowedDomains = [
  'stf.jus.br', 'stj.jus.br', 'gov.br', 'receita.economia.gov.br', 'pgfn.gov.br',
  'carf.economia.gov.br', 'fazenda.gov.br', 'confaz.fazenda.gov.br', 'in.gov.br',
  'normas.receita.fazenda.gov.br', 'normasinternet2.receita.fazenda.gov.br', 'nfe.fazenda.gov.br', 'www.nfe.fazenda.gov.br', 'sped.rfb.gov.br',
  'scon.stj.jus.br', 'portal.stf.jus.br',
  'camara.leg.br', 'senado.leg.br', 'sefaz.pr.gov.br', 'trf1.jus.br', 'trf2.jus.br',
  'trf3.jus.br', 'trf4.jus.br', 'trf5.jus.br', 'trf6.jus.br',
  'jota.info', 'reformatributaria.com', 'cgibs.gov.br', 'folha.uol.com.br', 'valor.globo.com',
];

export function validateOfficialUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new Error('A URL informada é inválida.'); }
  if (parsed.protocol !== 'https:') throw new Error('Somente endereços HTTPS são aceitos.');
  const hostname = parsed.hostname.toLowerCase();
  if (!allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    throw new Error('A fonte não pertence à lista de domínios oficiais permitidos.');
  }
  return parsed.toString();
}

export async function collectOfficialPage(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runPython(scriptPath, url, 60000, 'A coleta excedeu o limite de 60 segundos.');
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1200));
    }
  }
  throw lastError;
}

function runPython(script, input, timeoutMs, timeoutMessage) {
  return new Promise((resolvePromise, reject) => {
    const args = Array.isArray(input) ? input : [input];
    const child = spawn(config.pythonCommand, [script, ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Scrapling não está disponível. Instale as dependências do coletor.'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout);
        if (code !== 0 || result.error) throw new Error(result.error || stderr || 'Falha na coleta.');
        resolvePromise(result);
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error(`Resposta inválida do coletor: ${stderr || 'sem detalhes'}`) : error);
      }
    });
  });
}

export function discoverOfficialLinks(url) {
  return runPython(discoveryScriptPath, validateOfficialUrl(url), 60000, 'A descoberta de links excedeu 60 segundos.');
}

export function discoverStfJurisprudence(targetDate = '', lookbackDays = 7) {
  return runPython(stfJurisprudenceScriptPath, [targetDate || '', String(lookbackDays)], 150000, 'A pesquisa de jurisprudência do STF excedeu 150 segundos.');
}

export function discoverDjenCaderno(tribunal, targetDate) {
  return runPython(djenCadernoScriptPath, [tribunal, targetDate], 240000, 'A leitura do caderno completo do DJEN excedeu 240 segundos.');
}

export const officialDomains = allowedDomains;
