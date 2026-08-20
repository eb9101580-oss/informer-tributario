import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicSourceUrl, discoverPublicSourceLinks, inferSourceType, isPrivateAddress, normalizeCustomSourceUrl } from '../src/services/sourceSafety.js';

test('bloqueia redes privadas, metadados e credenciais em fontes personalizadas', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true);
  }
  assert.throws(() => normalizeCustomSourceUrl('https://user:pass@example.com'), /sem credenciais/);
  assert.throws(() => normalizeCustomSourceUrl('https://metadata.google.internal/'), /não pode/);
  await assert.rejects(
    () => assertPublicSourceUrl('https://fonte.example/', { resolver: async () => [{ address: '127.0.0.1', family: 4 }] }),
    /rede privada/,
  );
});

test('normaliza fonte HTTPS pública e remove fragmento', async () => {
  const normalized = await assertPublicSourceUrl('https://Example.com/tributos#topo', { resolver: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(normalized, 'https://example.com/tributos');
});

test('reconhece portais governamentais e judiciais como fontes oficiais', () => {
  assert.equal(inferSourceType('https://normas.receita.fazenda.gov.br/consulta'), 'official');
  assert.equal(inferSourceType('https://www.stj.jus.br/noticias'), 'official');
  assert.equal(inferSourceType('https://www.camara.leg.br/noticias'), 'official');
  assert.equal(inferSourceType('https://www.jota.info/tributos'), 'journalistic');
});

test('descobre somente links HTTPS do mesmo domínio em fonte aprovada', async () => {
  const html = '<a href="/tributario/decisao-1">Decisão sobre ICMS em 20/08/2026</a><a href="https://interno.invalid/segredo">Ignorar</a>';
  const headers = new Headers({ 'content-type': 'text/html' });
  const result = await discoverPublicSourceLinks('https://fonte.example/noticias', {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(html, { status: 200, headers }),
  });
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].url, 'https://fonte.example/tributario/decisao-1');
  assert.equal(result.links[0].publishedAt, '2026-08-20');
});

test('associa ao link a data publicada no cartão ao redor do título', async () => {
  const html = '<article><time datetime="2026-08-19T09:30:00-03:00">19/08/2026</time><a href="/tributario/decisao-2">Nova tese sobre créditos de ICMS</a></article>';
  const result = await discoverPublicSourceLinks('https://fonte.example/noticias', {
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(html, { status: 200, headers: new Headers({ 'content-type': 'text/html' }) }),
  });
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].publishedAt, '2026-08-19');
});
