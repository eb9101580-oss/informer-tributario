export const TAX_POLICY_VERSION = 'consultoria-empresarial-v2';
export const DETAILED_ANALYSIS_VERSION = 'detailed-v3';
export const EDITORIAL_EXCLUSION_SUMMARY = 'Exclusoes editoriais obrigatorias: nao publicar decisoes monocraticas no feed geral. Solucoes DISIT/SRRF sem vinculacao expressa a Solucao COSIT ou de Divergencia ficam fora; atos COSIT vinculantes continuam elegiveis quando trouxerem fato novo e efeito empresarial.';

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2012-\u2015]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PRIORITY_ONE_TOPICS = [
  ['reforma-ibs-cbs', /\bibs\b|\bcbs\b|imposto seletivo|reforma tributaria|lc\s*(?:n[ºo]\.?\s*)?(?:214\/2025|227\/2026)|cgibs|split payment|apuracao assistida|aliquota de referencia|regime(?:s)? (?:diferenciado|especifico)|transicao (?:do? )?(?:pis|cofins|icms|iss)|documentos? fiscais? (?:do? )?(?:ibs|cbs)/],
  ['pis-cofins-creditos', /pis.{0,30}cofins|cofins.{0,30}pis|efd.?contribuicoes|conceito de insumo|credito(?:s)? extemporane|credito(?:s)? presumid|tese do seculo|tema\s*69\b|lei\s*(?:n[ºo]\.?\s*)?(?:10\.637|10\.833|9\.718)|in\s*rfb\s*(?:n[ºo]\.?\s*)?2\.121/],
  ['recuperacao-perdcomp', /per\/?dcomp|pedido de (?:restituicao|ressarcimento)|declaracao de compensacao|compensacao tributaria|credito judicial|credito administrativo|pagamento (?:indevido|a maior)|habilitacao de credito|nao homologacao|despacho decisorio|manifestacao de inconformidade|saldo negativo (?:de )?(?:irpj|csll)|art\.?\s*170-a|in\s*rfb\s*(?:n[ºo]\.?\s*)?2\.055|recuperacao de creditos? tributarios?/],
  ['irpj-csll-jcp', /\birpj\b|\bcsll\b|lucro real|lucro presumido|prejuizo fiscal|base negativa|limite de compensacao de 30|subvenc|\bagio\b|ganho de capital|juros sobre capital proprio|\bjcp\b|despesas? (?:in)?dedutiveis?|adicoes? e exclusoes?/],
  ['dividendos-irrf', /dividendo|distribuicao de lucro|lucros distribuidos|lei\s*(?:n[ºo]\.?\s*)?15\.270\/2025|tributacao minima de altas rendas|distribuicao desproporcional|dividendos (?:intermediarios|intercalares)|retencao na fonte/],
  ['retencoes', /\birrf\b|pis\/?pasep retid|cofins retid|csll retid|inss retid|retenc(?:ao|oes) (?:tributaria|sobre servicos)|servicos profissionais|servicos tecnicos|pagamentos? ao exterior|aproveitamento d[ae]s retencoes/],
  ['obrigacoes-sped', /efd.?contribuicoes|efd.?icms|\becf\b|\becd\b|efd.?reinf|dctfweb|\bmit\b|\besocial\b|\bnf-e\b|\bnfc-e\b|\bnfs-e\b|\bct-e\b|\bsped\b|regra de validacao|\bpva\b|guia pratico|bloco m|\bm200\b|\bm210\b|\bm600\b|\bm605\b|\bm610\b|registro\s*(?:1100|1300|1500|1700)|malha fiscal|documento fiscal eletronico|leiaute (?:fiscal|da? efd|da? nf)|layout (?:fiscal|da? efd|da? nf)/],
  ['icms-empresarial', /\bicms\b|icms-st|\bdifal\b|substituicao tributaria|transferencia de creditos?|transferencia entre estabelecimentos|\bciap\b|convenio icms|ajuste sinief|protocolo icms|ato cotepe/],
  ['ipi-aduaneiro', /\bipi\b|industrializacao|equiparado a industrial|desembaraco aduaneiro|\bduimp\b|siscomex|classificacao fiscal|\bncm\b|valoracao aduaneira|drawback|\brecof(?:-sped)?\b|reintegra|regime aduaneiro|nacionalizacao de mercadoria/],
];

const PRIORITY_TWO_TOPICS = [
  ['planejamento-reorganizacao', /planejamento tributario|elisao fiscal|evasao|abuso de direito|proposito negocial|substancia economica|simulacao|negocio juridico indireto|reorganizacao societaria|\bholding\b|incorporacao|\bcisao\b|\bfusao\b|reducao de capital|partes relacionadas|goodwill|responsabilidade tributaria/],
  ['contencioso-administrativo', /\bcarf\b|\bcsrf\b|voto de qualidade|sumula carf|resolucao de divergencia|processo administrativo tributario|decreto\s*(?:n[ºo]\.?\s*)?70\.235|multa de oficio|multa isolada|denuncia espontanea|responsabilidade de socios|responsabilidade de administradores/],
  ['transacao-regularizacao', /transacao tributaria|\bpgfn\b|autorregularizacao incentivada|parcelamento especial|programa de conformidade|edital de transacao|negociacao de debitos|regularizacao fiscal|descontos? (?:sobre|de) (?:multa|juros|debitos?)/],
  ['tributacao-internacional', /precos de transferencia|lei\s*(?:n[ºo]\.?\s*)?14\.596\/2023|\bocde\b|pilar\s*2|tributacao minima global|tratado.{0,30}dupla tributacao|lucros no exterior|controladas? e coligadas?|\broyalties\b|importacao de servicos|pagamentos? ao exterior|operacoes? internacionais?/],
];

const NORMATIVE_EVENT = /\b(?:publica(?:do|da|ram|cao)?|editou|edita|altera(?:do|da|ram|cao)?|institui(?:u|do|cao)?|regulamenta(?:do|da|ram|cao)?|revoga(?:do|da|ram|cao)?|prorroga(?:do|da|ram|cao)?|aprova(?:do|da|ram|cao)?|fixa(?:do|da|ram|cao)?|estabelece(?:u|cido|cida)?|disciplina(?:do|da)?|entra em vigor|nova versao|novo leiaute|novo layout|nota tecnica\s*(?:n[ºo]\.?\s*)?\d+)\b/;
const NUMBERED_OFFICIAL_ACT = /\b(?:lei complementar|lei|lc|decreto|instrucao normativa|in\s*rfb|portaria|resolucao|solucao de consulta|solucao de divergencia|parecer normativo|ato declaratorio(?: interpretativo| executivo)?|convenio icms|ajuste sinief|ato cotepe)\s*(?:n[ºo]\.?\s*)?\d[\d./-]*/;
const JUDICIAL_EVENT = /\b(?:julgou|julgaram|julga|julgamento (?:de merito|concluido|iniciado)|decidiu|decidiram|decide|valida|validou|afasta|afastou|derruba|derrubou|nega provimento|negou provimento|da provimento|deu provimento|acordao publicado|sentenca proferida|liminar (?:deferida|indeferida|concedida)|tese (?:fixada|alterada|complementada)|fixou (?:a )?tese|fixa (?:a )?tese|modulacao|modulou|afetacao|afetou (?:o )?recurso|afeta (?:o )?recurso|repercussao geral (?:reconhecida|admitida)|transito em julgado|sessao de julgamento|turma.{0,40}decide|turma.{0,40}julga)\b/;
const ADMINISTRATIVE_EVENT = /\b(?:novo edital|edital\s*(?:n[ºo]\.?\s*)?\d+|solucao de consulta\s*(?:cosit\s*)?(?:n[ºo]\.?\s*)?\d+|sumula\s*(?:carf\s*)?(?:n[ºo]\.?\s*)?\d+|manual|guia pratico)\b.{0,80}\b(?:publica|aprova|altera|atualiza|nova versao|versao\s*\d+)/;
const LEGISLATIVE_PROGRESS = /\b(?:aprovou|aprovado|votacao (?:iniciada|concluida)|incluido em pauta|relatorio aprovado|parecer aprovado|avancou na comissao|aprovado na comissao|aprovado no plenario|enviado a sancao|sancionado|promulgado)\b/;
const STATUS_EVENT = /\b(?:recurso afetado|julgamento iniciado|regulamentacao pendente|incluido em pauta|publicacao do acordao|embargos? (?:acolhidos|julgados)|modulacao|mudanca de entendimento|alterou (?:a )?tese)\b/;

const BUSINESS_EFFECT = /carga tributaria|base de calculo|aliquota|incidencia|nao incidencia|credito tributario|apropriacao de credito|estorno de credito|ressarcimento|compensacao|recuperacao de credito|dedutibilidade|obrigacao acessoria|prazo de entrega|penalidade|multa|\berp\b|sistema interno|leiaute|layout|documento fiscal|fluxo de caixa|risco fiscal|planejamento tributario|reorganizacao|dividendo|\bjcp\b|retencao|importacao|exportacao|ativo imobilizado|saldo credor|prescricao|decadencia|responsabilidade tributaria|precos de transferencia|tributacao minima global|negociacao de debitos|desconto (?:de|sobre) (?:multa|juros)|procedimento fiscal/;
const REFORM_STRUCTURAL = /reforma tributaria|\bibs\b|\bcbs\b|imposto seletivo|lc\s*(?:n[ºo]\.?\s*)?(?:214\/2025|227\/2026)|cgibs|mudanca estrutural|regime diferenciado|periodo de transicao|split payment/;
const CORPORATE_CONTEXT = /empresa|empresarial|pessoa juridica|contribuinte|industria|comercio|prestador|grupo economico|grupo empresarial|socio|dividendo|lucro|\bjcp\b|alta renda|operacao societaria|reorganizacao|exterior|retencao|frota empresarial|imovel empresarial|impacto nacional/;

const PROMOTIONAL_OR_EVENT = /\b(?:curso(?: online)?|webinar|seminario|workshop|palestra|inscricoes? abertas?|evento (?:online|presencial|gratuito|pago)|congresso (?:tributario|de direito tributario|fiscal))\b/;
const SPONSORED = /\b(?:patrocinado|publieditorial|conteudo pago|oferecimento de|inscreva-se|garanta sua vaga)\b/;
const EDUCATIONAL = /\b(?:saiba como|entenda o que e|guia introdutorio|cartilha basica|conteudo educacional|conceitos basicos|perguntas e respostas introdutorias)\b/;
const POLITICAL_SPECULATION = /\b(?:declaracao de parlamentar|parlamentar (?:afirma|defende|promete|sugere)|governo estuda|pode propor|deve propor|pretende apresentar|debate politico|expectativa de mudanca|cogita alterar)\b/;
const OPINION_WITHOUT_EVENT = /\b(?:artigo de opiniao|opiniao de escritorio|analise academica|artigo academico|especialista comenta|advogado comenta)\b/;
const OLD_REPUBLICATION = /\b(?:relembra|republica|republicado|decisao antiga|julgado antigo|entendimento ja conhecido|retrospectiva)\b/;
const REVENUE_WITHOUT_EFFECT = /\b(?:arrecadacao (?:bate recorde|recorde|cresce|aumenta|caiu|recua)|resultado da arrecadacao|dados de arrecadacao)\b/;
const MACRO_WITHOUT_EFFECT = /\b(?:cenario macroeconomico|projecao do pib|mercado financeiro|politica monetaria)\b/;
const GENERIC_INDEX = /\b(?:indice oficial|pagina de consulta|atualizacao diaria do indice|lista de publicacoes)\b/;
// Decisões monocráticas podem ser úteis no acompanhamento de um processo,
// mas não representam a curadoria do feed geral.
const MONOCRATIC_DECISION = /\b(?:decis(?:ao|oes) monocratica(?:s)?|decis(?:ao|oes) singular(?:es)?|decis(?:ao|oes) unipessoal(?:is)?|despacho monocratico|decis(?:ao|oes) terminativa(?:s)?)\b/;
// Uma solução DISIT/SRRF só tem alcance nacional quando a própria publicação
// informa vinculação expressa a uma solução COSIT ou de divergência.
const DISIT_LOCAL_CONSULTATION = /\b(?:solucao de consulta|solucao de divergencia)\b.{0,140}\bdisit(?:\/srrf\d{2})?\b|\bdisit(?:\/srrf\d{2})?\b.{0,140}\b(?:solucao de consulta|solucao de divergencia)\b/;
const DISIT_BINDING = /\bsolucao de consulta vinculad[ao]\b|\bvincula(?:-se)?\b.{0,100}\b(?:solucao de consulta|solucao de divergencia|cosit)\b|\bvincul(?:acao|ada|ado)\b.{0,100}\b(?:solucao de consulta|solucao de divergencia|cosit)\b/;

const STF_ALERT = /repercussao geral (?:reconhecida|admitida)|julgamento de merito|julgou (?:o )?merito|modulacao|modulou|tese (?:fixada|alterada)|fixou (?:a )?tese|mudanca de entendimento|alterou (?:o )?entendimento|embargos? .{0,80}(?:alterar|modular|revisar|tese)/;
const STJ_ALERT = /tema repetitivo|recurso repetitivo|afetacao|afetou (?:o )?recurso|primeira secao|1ª secao|1a secao|primeira turma|1ª turma|1a turma|segunda turma|2ª turma|2a turma|tese (?:fixada|alterada|complementada)|alterou (?:a )?tese|complementou (?:a )?tese|embargos? de divergencia.{0,80}(?:mudanca|tese|entendimento)|decisao colegiada|julgamento conjunto|resp\b|aresp\b/;
const CARF_INSTITUTIONAL_ALERT = /camara superior|\bcsrf\b|sumula|resolucao (?:de divergencia)?|voto de qualidade/;
const CARF_NOVELTY_ALERT = /mudanca de entendimento|alterou (?:o )?entendimento|divergencia (?:entre|jurisprudencial|de turmas)|tese (?:nova|reiterada)|entendimento reiterado|decisoes? convergentes? em (?:diferentes|varias) turmas/;
const CARF_PRIORITY_SUBJECT = /\bjcp\b|juros sobre capital proprio|\bagio\b|planejamento tributario|creditos? (?:de )?(?:pis|cofins|ipi)|retenc(?:ao|oes)|\birpj\b|\bcsll\b|reorganizacao societaria/;
const TRF_DIRECT_ALERT = /tese nova|potencial de precedente|firmou entendimento inedito|divergencia jurisprudencial|materia (?:ainda )?nao enfrentada (?:pelo )?(?:stf|stj)|impacto financeiro (?:empresarial )?(?:significativo|relevante)|mudanca de entendimento/;
const TRF_NEW_LAW_INJUNCTION = /(?:liminar|tutela (?:de urgencia|provisoria)).{0,160}(?:legislacao nova|lei complementar\s*(?:n[ºo]\.?\s*)?(?:214|227)|\bibs\b|\bcbs\b)|(?:legislacao nova|lei complementar\s*(?:n[ºo]\.?\s*)?(?:214|227)|\bibs\b|\bcbs\b).{0,160}(?:liminar|tutela (?:de urgencia|provisoria))/;

const PRIMARY_SOURCE_IDS = new Set([
  'diario-oficial', 'receita-federal', 'receita-cosit', 'receita-in', 'receita-notas', 'reforma-cgibs',
  'pgfn-pareceres', 'pgfn-noticias', 'carf', 'carf-noticias', 'stf', 'stj', 'stj-noticias', 'stj-informativos', 'stf-informativos', 'confaz-ajustes',
  'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'sped-ecd', 'sped-ecf', 'sped-efd-contribuicoes',
  'sped-efd-icms-ipi', 'sped-efd-reinf', 'sped-e-financeira', 'sped-esocial', 'sped-dere',
  'camara', 'senado', 'trf1', 'trf2', 'trf3', 'trf4', 'trf5', 'trf6',
]);

const GENERIC_ANALYSIS = /entrou no feed|deve ser conferid|pode afetar (?:o |este )?tema|tema indicado|verifique (?:a |o )?fonte|alcance deve ser conferido|publicacao foi identificada|item pode afetar/;
const MISSING_ANALYSIS = /^(?:informacao nao identificada(?: no documento)?|nao identificado|nao se aplica)\.?$/;
const ANALYSIS_STOP_WORDS = new Set('a o as os um uma de do da dos das e em no na nos nas por para com sem que se ao aos à às como ou isso este esta esse essa foi sao ser sobre entre após apos contra até ate pela pelo pelas pelos mais menos muito nova novo apenas ainda quando onde qual quais'.split(' '));

function analysisTokens(value) {
  return new Set(normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !ANALYSIS_STOP_WORDS.has(token)));
}

function tokenOverlap(left, right) {
  const leftTokens = analysisTokens(left);
  const rightTokens = analysisTokens(right);
  if (leftTokens.size < 5 || rightTokens.size < 5) return 0;
  let shared = 0;
  leftTokens.forEach((token) => { if (rightTokens.has(token)) shared += 1; });
  return shared / Math.min(leftTokens.size, rightTokens.size);
}

function matchedTopics(text, definitions) {
  return definitions.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
}

function detectEventType(text, documentKind = '') {
  const combined = `${documentKind} ${text}`;
  if (/\bmodulacao|modulou\b/.test(combined)) return 'MODULACAO';
  if (/repercussao geral (?:reconhecida|admitida)/.test(combined)) return 'REPERCUSSAO_GERAL';
  if (/\b(?:tema repetitivo|recurso repetitivo|afetacao|afetou (?:o )?recurso)\b/.test(combined)) return 'REPETITIVO_AFETADO';

  if (/\b(?:tese fixada|fixou (?:a )?tese|tese alterada|alterou (?:a )?tese)\b/.test(combined)) return 'TESE_FIXADA_OU_ALTERADA';
  if (LEGISLATIVE_PROGRESS.test(combined)) return 'PROJETO_AVANCADO';
  if (/\b(?:nova versao|novo leiaute|novo layout|nota tecnica|guia pratico|manual)\b/.test(combined)
    && /\b(?:publica|aprova|altera|atualiza|versao\s*\d+)\b/.test(combined)) return 'MANUAL_LAYOUT_ALTERADO';
  if (JUDICIAL_EVENT.test(combined) || /\b(?:acordao|sentenca|decisao judicial)\b/.test(documentKind)) return 'DECISAO_OU_JULGAMENTO';
  if (NORMATIVE_EVENT.test(combined) || NUMBERED_OFFICIAL_ACT.test(combined) || ADMINISTRATIVE_EVENT.test(combined)) return 'ATO_NORMATIVO_OU_ADMINISTRATIVO';
  if (STATUS_EVENT.test(combined)) return 'STATUS_JURIDICO_RELEVANTE';
  return null;
}

function courtGateFor(sourceId, text) {
  if (sourceId === 'stf' || sourceId === 'stf-informativos') {
    const passed = STF_ALERT.test(text);
    return { court: 'STF', required: true, passed, reason: passed ? null : 'Decisão do STF sem repercussão geral, mérito, modulação, tese ou mudança relevante.' };
  }
  if (sourceId === 'stj' || sourceId === 'stj-noticias' || sourceId === 'stj-informativos') {
    const passed = STJ_ALERT.test(text);
    return { court: 'STJ', required: true, passed, reason: passed ? null : 'Decisão do STJ sem repercussão colegiada, repetitivo, afetação, tese ou Turma de Direito Público relevante.' };
  }
  if (sourceId === 'carf' || sourceId === 'carf-noticias') {
    const passed = CARF_INSTITUTIONAL_ALERT.test(text)
      || (CARF_PRIORITY_SUBJECT.test(text) && CARF_NOVELTY_ALERT.test(text));
    return { court: 'CARF', required: true, passed, reason: passed ? null : 'Acórdão isolado do CARF sem sinal institucional ou mudança de tese prioritária.' };
  }
  if (/^trf[1-6]$/.test(sourceId)) {
    const passed = TRF_DIRECT_ALERT.test(text) || TRF_NEW_LAW_INJUNCTION.test(text);
    return { court: sourceId.toUpperCase(), required: true, passed, reason: passed ? null : 'Decisão de TRF sem tese nova, precedente, divergência, liminar sobre lei nova ou impacto significativo.' };
  }
  return { court: null, required: false, passed: true, reason: null };
}

function negativeAssessment({ title, text, concreteEvent, businessEffect }) {
  if (MONOCRATIC_DECISION.test(text)) {
    return { category: 'DECISAO_MONOCRATICA', reason: 'Decisão monocrática excluída do feed geral; permanece disponível apenas no acompanhamento processual.', exceptionApplied: null };
  }
  if (DISIT_LOCAL_CONSULTATION.test(text) && !DISIT_BINDING.test(text)) {
    return { category: 'CONSULTA_DISIT_SEM_VINCULACAO', reason: 'Solução DISIT/SRRF sem vinculação expressa a solução COSIT ou de divergência.', exceptionApplied: null };
  }
  if (PROMOTIONAL_OR_EVENT.test(title) || SPONSORED.test(text) || EDUCATIONAL.test(title)) {
    return { category: 'PROMOCIONAL_OU_EDUCACIONAL', reason: 'Conteúdo educacional, promocional, curso ou evento.', exceptionApplied: null };
  }
  if (POLITICAL_SPECULATION.test(text) && !LEGISLATIVE_PROGRESS.test(text)) {
    return { category: 'POLITICA_OU_ESPECULACAO', reason: 'Declaração política ou especulação sem avanço legislativo concreto.', exceptionApplied: null };
  }
  if (OPINION_WITHOUT_EVENT.test(text) && !concreteEvent) {
    return { category: 'OPINIAO_SEM_FATO_NOVO', reason: 'Opinião ou análise sem fato normativo ou jurídico novo.', exceptionApplied: null };
  }
  if (OLD_REPUBLICATION.test(text) && !STATUS_EVENT.test(text)) {
    return { category: 'REPUBLICACAO_ANTIGA', reason: 'Julgado ou entendimento antigo republicado sem mudança de status.', exceptionApplied: null };
  }
  if (REVENUE_WITHOUT_EFFECT.test(text) && !businessEffect) {
    return { category: 'ARRECADACAO_SEM_EFEITO', reason: 'Notícia de arrecadação sem consequência jurídica ou empresarial.', exceptionApplied: null };
  }
  if (MACRO_WITHOUT_EFFECT.test(text) && !businessEffect) {
    return { category: 'MACRO_SEM_EFEITO', reason: 'Conteúdo macroeconômico sem efeito tributário concreto.', exceptionApplied: null };
  }
  if (GENERIC_INDEX.test(title) && !NUMBERED_OFFICIAL_ACT.test(text)) {
    return { category: 'INDICE_SEM_NOVIDADE', reason: 'Índice ou página de consulta sem publicação nova identificada.', exceptionApplied: null };
  }
  if (/\bsimples[\s-]+nacional\b/.test(text)) {
    if (REFORM_STRUCTURAL.test(text) && concreteEvent) {
      return { category: null, reason: null, exceptionApplied: 'SIMPLES_ESTRUTURAL_REFORMA' };
    }
    return { category: 'SIMPLES_NACIONAL', reason: 'Simples Nacional sem mudança estrutural ligada à Reforma Tributária.', exceptionApplied: null };
  }
  if (/\b(?:mei|microempreendedor individual)\b/.test(text)) {
    return { category: 'MEI', reason: 'Tema de MEI fora do foco empresarial.', exceptionApplied: null };
  }
  if (/\birpf\b|imposto de renda da pessoa fisica/.test(text) && !CORPORATE_CONTEXT.test(text)) {
    return { category: 'PESSOA_FISICA', reason: 'IRPF sem relação empresarial.', exceptionApplied: null };
  }
  if (/\b(?:iptu|ipva)\b/.test(text) && !(CORPORATE_CONTEXT.test(text) && businessEffect)) {
    return { category: 'TRIBUTO_PATRIMONIAL_SEM_NEXO', reason: 'IPTU ou IPVA sem impacto empresarial concreto.', exceptionApplied: null };
  }
  if (/\bitcmd\b/.test(text) && /heranca|doacao|familia|sucessao familiar/.test(text)
    && !(CORPORATE_CONTEXT.test(text) && businessEffect)) {
    return { category: 'ITCMD_FAMILIAR', reason: 'ITCMD de natureza estritamente familiar.', exceptionApplied: null };
  }
  if (/taxa municipal/.test(text) && !(CORPORATE_CONTEXT.test(text) && businessEffect)) {
    return { category: 'TAXA_MUNICIPAL_SEM_NEXO', reason: 'Taxa municipal sem relevância empresarial.', exceptionApplied: null };
  }
  return { category: null, reason: null, exceptionApplied: null };
}

function policyPriority({ eligible, topicTier, eventType, businessEffect }) {
  if (!eligible) return null;
  if (['REPERCUSSAO_GERAL', 'REPETITIVO_AFETADO', 'PROJETO_AVANCADO', 'STATUS_JURIDICO_RELEVANTE'].includes(eventType)) return 'Acompanhamento';
  if (topicTier === 1 && businessEffect) return 'Alta';
  return 'Média';
}

export function assessTaxIntelligenceCandidate(candidate = {}) {
  const title = normalize(candidate.title);
  const content = normalize(candidate.content || candidate.text || '');
  const documentKind = normalize(candidate.documentKind);
  const sourceId = normalize(candidate.sourceId);
  const text = `${title} ${documentKind} ${content}`.slice(0, 70000);
  const priorityOneTopics = matchedTopics(text, PRIORITY_ONE_TOPICS);
  const priorityTwoTopics = matchedTopics(text, PRIORITY_TWO_TOPICS);
  const topicTier = priorityOneTopics.length ? 1 : priorityTwoTopics.length ? 2 : null;
  const eventType = detectEventType(text, documentKind);
  const concreteEvent = Boolean(eventType);
  const businessEffect = BUSINESS_EFFECT.test(text);
  const negative = negativeAssessment({ title, text, concreteEvent, businessEffect });
  const courtGate = courtGateFor(sourceId, text);
  const exclusionReason = negative.reason || courtGate.reason;
  const primarySource = candidate.sourceType === 'official' || PRIMARY_SOURCE_IDS.has(sourceId);
  const preferredRegion = /\b(?:parana|santa catarina|sao paulo|rio grande do sul|trf4)\b/.test(text) || sourceId === 'trf4';
  const topicGatePassed = topicTier === 1 ? concreteEvent : topicTier === 2 && concreteEvent && businessEffect;
  const eligible = !exclusionReason && courtGate.passed && topicGatePassed;
  const signals = [];
  if (topicTier === 1) signals.push('prioridade-1');
  if (topicTier === 2) signals.push('prioridade-2');
  if (concreteEvent) signals.push('fato-novo-concreto');
  if (businessEffect) signals.push('efeito-empresarial');
  if (primarySource) signals.push('fonte-primaria');
  if (courtGate.required && courtGate.passed) signals.push('gate-jurisprudencial');
  if (preferredRegion) signals.push('regiao-prioritaria');
  if (negative.exceptionApplied) signals.push('excecao-editorial');

  let score = 0;
  if (topicTier === 1) score += 35;
  else if (topicTier === 2) score += 22;
  if (concreteEvent) score += 20;
  if (businessEffect) score += 18;
  if (primarySource) score += 12;
  if (courtGate.required && courtGate.passed) score += 10;
  if (preferredRegion) score += 5;
  if (!topicTier) score -= 25;
  if (!concreteEvent) score -= 20;
  if (topicTier === 2 && !businessEffect) score -= 18;
  if (exclusionReason) score = 0;

  return {
    version: TAX_POLICY_VERSION,
    eligible,
    eligibilityReason: eligible ? null
      : exclusionReason || (!topicTier ? 'Tema fora da matriz tributária empresarial.'
        : !concreteEvent ? 'Tema citado sem fato, ato ou mudança concreta.'
          : topicTier === 2 && !businessEffect ? 'Tema de prioridade 2 sem efeito empresarial concreto.'
            : 'Candidato fora da política editorial.'),
    exclusionReason,
    negativeCategory: negative.category,
    exceptionApplied: negative.exceptionApplied,
    score: Math.max(0, Math.min(100, score)),
    topicTier,
    priorityOneTopics,
    priorityTwoTopics,
    eventType,
    concreteEvent,
    businessEffect,
    primarySource,
    preferredRegion,
    courtGate,
    priority: policyPriority({ eligible, topicTier, eventType, businessEffect }),
    signals,
  };
}

export function candidatePassesHardPolicy(candidate = {}) {
  return !assessTaxIntelligenceCandidate(candidate).exclusionReason;
}

export function assessPublishedAlert(alert = {}) {
  return assessTaxIntelligenceCandidate({
    sourceId: alert.provenance?.sourceId,
    sourceType: alert.provenance?.sourceType,
    title: alert.title,
    documentKind: alert.kind || alert.provenance?.documentKind,
    content: [
      alert.summary, alert.whatChanged, alert.practicalImpact, alert.officeAction, alert.issueOrSubject,
      alert.rulingOrRule, alert.legalReasoning, alert.effectiveDateOrDeadline, alert.contextAndHistory,
      alert.actorsAndInterests, alert.nextSteps, alert.watchpoints, alert.theme,
      alert.contentNature, alert.noveltyType, alert.priority, ...(alert.relevanceReasons || []),
      ...(alert.taxes || []), ...(alert.legalBasis || []),
    ].filter(Boolean).join(' '),
  });
}

export function assessAlertAnalysisQuality(alert = {}) {
  const currentPolicy = alert.policyVersion === TAX_POLICY_VERSION || alert.provenance?.policyVersion === TAX_POLICY_VERSION;
  if (!currentPolicy) return { required: false, passed: true, reasons: [] };

  const reasons = [];
  const fields = [
    ['summary', alert.summary, 35],
    ['whatChanged', alert.whatChanged, 25],
    ['practicalImpact', alert.practicalImpact, 25],
  ];
  for (const [name, value, minimumLength] of fields) {
    const normalized = normalize(value);
    if (normalized.length < minimumLength || MISSING_ANALYSIS.test(normalized)) reasons.push(`${name} sem análise específica.`);
    else if (GENERIC_ANALYSIS.test(normalized)) reasons.push(`${name} contém texto genérico.`);
  }
  const legalBasis = Array.isArray(alert.legalBasis)
    ? alert.legalBasis.map(normalize).filter((value) => value && !MISSING_ANALYSIS.test(value))
    : [];
  if (!legalBasis.length) reasons.push('Base jurídica não informada.');
  if (normalize(alert.summary) === normalize(alert.whatChanged)) reasons.push('O que aconteceu e o que mudou repetem o mesmo texto.');
  const detailed = alert.analysisVersion === DETAILED_ANALYSIS_VERSION || alert.provenance?.analysisVersion === DETAILED_ANALYSIS_VERSION;
  if (detailed) {
    const detailFields = [
      ['issueOrSubject', alert.issueOrSubject, 25],
      ['rulingOrRule', alert.rulingOrRule, 35],
      ['legalReasoning', alert.legalReasoning, 35],
      ['contextAndHistory', alert.contextAndHistory, 35],
      ['actorsAndInterests', alert.actorsAndInterests, 25],
      ['nextSteps', alert.nextSteps, 35],
      ['watchpoints', alert.watchpoints, 25],
    ];
    for (const [name, value, minimumLength] of detailFields) {
      const normalized = normalize(value);
      if (normalized.length < minimumLength || MISSING_ANALYSIS.test(normalized)) reasons.push(`${name} sem conteúdo específico.`);
      else if (GENERIC_ANALYSIS.test(normalized)) reasons.push(`${name} contém texto genérico.`);
    }
    const narratives = [
      ['summary', alert.summary], ['whatChanged', alert.whatChanged], ['practicalImpact', alert.practicalImpact],
      ['issueOrSubject', alert.issueOrSubject], ['rulingOrRule', alert.rulingOrRule], ['legalReasoning', alert.legalReasoning],
      ['contextAndHistory', alert.contextAndHistory], ['actorsAndInterests', alert.actorsAndInterests],
      ['nextSteps', alert.nextSteps], ['watchpoints', alert.watchpoints],
    ];
    for (let index = 0; index < narratives.length; index += 1) {
      for (let next = index + 1; next < narratives.length; next += 1) {
        const overlap = tokenOverlap(narratives[index][1], narratives[next][1]);
        if (overlap >= 0.82) reasons.push(`${narratives[index][0]} e ${narratives[next][0]} são repetitivos.`);
      }
    }
  }
  return { required: true, passed: reasons.length === 0, reasons };
}

export function alertPassesTaxIntelligencePolicy(alert = {}) {
  if (alert.kind === 'Movimentação processual') return true;
  const assessment = assessPublishedAlert(alert);
  const currentPolicy = alert.policyVersion === TAX_POLICY_VERSION || alert.provenance?.policyVersion === TAX_POLICY_VERSION;
  const quality = assessAlertAnalysisQuality(alert);
  return assessment.eligible
    && assessment.concreteEvent
    && (assessment.topicTier !== 2 || assessment.businessEffect)
    && !assessment.exclusionReason
    && (!currentPolicy || quality.passed);
}

export function primarySourceUrlForAlert(alert = {}) {
  if (/^https:\/\/[^\s]+$/i.test(alert.primarySourceUrl || '')) return alert.primarySourceUrl;
  if (alert.provenance?.sourceType !== 'journalistic' && /^https:\/\/[^\s]+$/i.test(alert.officialUrl || '')) return alert.officialUrl;
  return null;
}

export function policyPromptSummary() {
  return `Política ${TAX_POLICY_VERSION}: só marque como relevante um fato novo concreto de consultoria tributária empresarial. Citar um tributo ou uma tese sem novo ato, decisão, mudança ou avanço não basta. Prioridade 1: Reforma IBS/CBS/Imposto Seletivo; PIS/Cofins e créditos; PER/DCOMP e recuperação; IRPJ/CSLL/JCP; dividendos/IRRF; retenções; SPED e obrigações acessórias; ICMS empresarial; IPI e aduaneiro. Prioridade 2, sempre condicionada a efeito empresarial concreto: planejamento e reorganizações; CARF e contencioso; transação/PGFN; tributação internacional. STF: somente repercussão geral, mérito, modulação, tese ou mudança de entendimento. STJ: repetitivos, afetação, tese ou Primeira Seção relevante. CARF: CSRF, súmula, resolução, voto de qualidade ou mudança/reiteração comprovada de tese prioritária; descarte acórdão isolado. TRF: somente tese nova, precedente, divergência, liminar sobre legislação nova, matéria inédita ou impacto financeiro significativo. Descarte política/especulação sem avanço concreto, opinião sem fato novo, republicação antiga, arrecadação ou macroeconomia sem consequência jurídica, conteúdo educacional/promocional, IRPF/MEI/tributo patrimonial sem nexo empresarial e conteúdo patrocinado. Simples Nacional só passa quando o documento trouxer mudança estrutural concreta ligada à Reforma Tributária.`;
}
