import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assessAlertAnalysisQuality,
  assessPublishedAlert,
  TAX_POLICY_VERSION,
} from '../src/services/taxIntelligencePolicy.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath = resolve(scriptDirectory, '../data/database.json');
const database = JSON.parse(await readFile(databasePath, 'utf8'));
let marked = 0;

database.alerts = (database.alerts || []).map((alert) => {
  if (alert.kind === 'Movimentação processual' || alert.policyVersion === TAX_POLICY_VERSION) return alert;
  const assessment = assessPublishedAlert(alert);
  const quality = assessAlertAnalysisQuality({ ...alert, policyVersion: TAX_POLICY_VERSION });
  const genericAnalysis = quality.reasons.some((reason) => /genérico|sem análise específica|repetem/i.test(reason));
  const rejected = !assessment.eligible || Boolean(assessment.exclusionReason) || genericAnalysis;
  if (!rejected) return alert;
  marked += 1;
  return {
    ...alert,
    policyVersion: TAX_POLICY_VERSION,
    provenance: {
      ...(alert.provenance || {}),
      policyVersion: TAX_POLICY_VERSION,
      policyMigration: 'legacy-rejected',
      policyRejectionReason: assessment.exclusionReason || assessment.eligibilityReason || quality.reasons.join(' '),
    },
  };
});

await writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ marked, policyVersion: TAX_POLICY_VERSION }));
