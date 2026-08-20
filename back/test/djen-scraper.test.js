import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runPythonProbe(proxyFails) {
  const code = `
import json
import sys
sys.path.insert(0, r"back/scraper")
import djen_caderno as djen

djen.METADATA_PROXY_URL = "https://proxy.example/api/djen/caderno-metadata"
calls = []

def fake_request(url, retry_offset=0, attempts=3, empty_on_404=True):
    calls.append({"url": url, "attempts": attempts, "emptyOn404": empty_on_404})
    if ${proxyFails ? 'True' : 'False'} and "proxy.example" in url:
        raise OSError("proxy indisponivel")
    return {"url": "https://archive.example/caderno.zip", "origin": "proxy" if "proxy.example" in url else "official"}

djen.request_json = fake_request
result = djen.fetch_metadata("TRF2", "2026-08-19")
print(json.dumps({"calls": calls, "result": result}))
`;
  const execution = spawnSync(process.env.PYTHON_COMMAND || 'python', ['-c', code], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(execution.status, 0, execution.stderr);
  return JSON.parse(execution.stdout);
}

test('scraper usa o proxy de metadados antes do endpoint oficial', () => {
  const probe = runPythonProbe(false);
  assert.equal(probe.calls.length, 1);
  assert.match(probe.calls[0].url, /proxy\.example\/api\/djen\/caderno-metadata\/TRF2\/2026-08-19$/);
  assert.equal(probe.calls[0].attempts, 1);
  assert.equal(probe.calls[0].emptyOn404, false);
  assert.equal(probe.result.origin, 'proxy');
});

test('scraper recorre ao endpoint oficial quando o proxy falha', () => {
  const probe = runPythonProbe(true);
  assert.equal(probe.calls.length, 2);
  assert.match(probe.calls[0].url, /proxy\.example/);
  assert.equal(probe.calls[0].attempts, 1);
  assert.equal(probe.calls[1].url, 'https://comunicaapi.pje.jus.br/api/v1/caderno/TRF2/2026-08-19/D');
  assert.equal(probe.result.origin, 'official');
});

test('filtro do caderno reconhece a taxonomia tributária ampliada sem aceitar atos não decisórios', () => {
  const code = `
import json
import sys
sys.path.insert(0, r"back/scraper")
import djen_caderno as djen

terms = [
    "IRRF", "IRPF", "IPTU", "IPVA", "ITBI", "PASEP", "CIDE", "FUNRURAL", "AFRMM",
    "direito aduaneiro", "tributação da importação", "incentivo à exportação",
    "imunidade", "isenção", "repetição de indébito", "taxa", "empréstimo compulsório",
]
matches = {term: bool(djen.TAX_PATTERN.search(djen.normalized(term))) for term in terms}
decision = djen.selected_item({
    "id": 1,
    "data_disponibilizacao": "2026-08-19",
    "tipoDocumento": "Decisão",
    "tipoComunicacao": "Intimação",
    "texto": "Reconhecida a imunidade tributária.",
}, "TRF1", "2026-08-19")
non_decision = djen.selected_item({
    "id": 2,
    "data_disponibilizacao": "2026-08-19",
    "tipoDocumento": "Ato ordinatório",
    "tipoComunicacao": "Intimação",
    "texto": "Discussão sobre IRRF.",
}, "TRF1", "2026-08-19")
print(json.dumps({"matches": matches, "decision": decision is not None, "nonDecision": non_decision is not None}))
`;
  const execution = spawnSync(process.env.PYTHON_COMMAND || 'python', ['-c', code], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.deepEqual(Object.values(result.matches), Array(Object.keys(result.matches).length).fill(true));
  assert.equal(result.decision, true);
  assert.equal(result.nonDecision, false);
});

test('streaming do ZIP limita, deduplica e diversifica decisões preservando telemetria', () => {
  const code = `
import io
import json
import sys
import zipfile
sys.path.insert(0, r"back/scraper")
import djen_caderno as djen

djen.MAX_CANDIDATES = 2
djen.CANDIDATE_POOL_SIZE = 8
high = {
    "id": 1, "data_disponibilizacao": "2026-08-19", "tipoDocumento": "Decisão",
    "tipoComunicacao": "Intimação", "numero_processo": "111",
    "texto": "Tema 123 de recurso repetitivo sobre IRRF. Dou provimento ao recurso.",
}
items = [
    high,
    {**high, "id": 2},
    {**high, "id": 3, "texto": "Decisão rotineira em execução fiscal e dívida ativa."},
    {**high, "id": 4, "numero_processo": "222", "tipoDocumento": "Sentença Tipo A", "texto": "Julgo procedente o pedido relativo ao IPVA."},
    {**high, "id": 5, "numero_processo": "333", "tipoDocumento": "Ato ordinatório", "texto": "Intimação sobre IRPJ."},
    {**high, "id": 6, "numero_processo": "444", "texto": "Decisão sobre responsabilidade civil."},
    {**high, "id": 7, "numero_processo": "555", "data_disponibilizacao": "2026-08-18", "texto": "Decisão sobre ICMS."},
]
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as output:
    output.writestr("pagina.json", json.dumps({"items": items}))
buffer.seek(0)
with zipfile.ZipFile(buffer) as archive:
    selected, telemetry = djen.select_archive_candidates(archive, "TRF1", "2026-08-19", 33731)

class FakeArchive:
    def infolist(self):
        return [type("Entry", (), {"filename": "grande.json", "file_size": djen.MAX_ENTRY_BYTES + 1})()]

oversize_rejected = False
try:
    djen.archive_json_entries(FakeArchive())
except ValueError:
    oversize_rejected = True

print(json.dumps({
    "selectedProcesses": [item["numero_processo"] for item in selected],
    "firstText": selected[0]["texto"],
    "telemetry": telemetry,
    "oversizeRejected": oversize_rejected,
}))
`;
  const execution = spawnSync(process.env.PYTHON_COMMAND || 'python', ['-c', code], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout);
  assert.deepEqual(result.selectedProcesses.sort(), ['111', '222']);
  assert.match(result.firstText, /recurso repetitivo/i);
  assert.deepEqual(result.telemetry, {
    totalCommunications: 33731,
    entries: 1,
    processed: 7,
    dateMatched: 6,
    decisionMatched: 5,
    taxMatched: 4,
    deduplicated: 3,
    duplicates: 1,
    selected: 2,
    cap: 2,
  });
  assert.equal(result.oversizeRejected, true);
});
