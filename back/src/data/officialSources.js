export const officialSources = [
  {
    id: 'receita-federal', name: 'Receita Federal do Brasil', acronym: 'RFB', category: 'Administração tributária',
    description: 'Normas, soluções de consulta, orientações e atos da administração tributária federal.',
    url: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/legislacao-e-jurisprudencia/',
    discoveryUrl: 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias',
    focus: ['Soluções de consulta', 'Atos normativos', 'Obrigações acessórias'], monitoring: 'A cada 6 horas', priority: 1, color: 'blue', adapter: 'links',
  },
  {
    id: 'diario-oficial', name: 'Diário Oficial da União', acronym: 'DOU', category: 'Publicação normativa',
    description: 'Leis, decretos, portarias, instruções normativas e demais atos federais publicados oficialmente.',
    url: 'https://www.in.gov.br/consulta', discoveryUrl: 'https://www.in.gov.br/web/dou',
    focus: ['Leis e decretos', 'Atos normativos', 'Vigência'], monitoring: 'A cada 6 horas', priority: 2, color: 'gold', adapter: 'links',
  },
  {
    id: 'camara', name: 'Câmara dos Deputados', acronym: 'CD', category: 'Processo legislativo',
    description: 'Proposições legislativas federais, ementas e tramitação obtidas pela API oficial de dados abertos.',
    url: 'https://dadosabertos.camara.leg.br/swagger/api.html',
    focus: ['Projetos de lei', 'Emendas', 'Reforma tributária'], monitoring: 'A cada 6 horas', priority: 3, color: 'teal', adapter: 'camara-api',
  },
  {
    id: 'senado', name: 'Senado Federal', acronym: 'SF', category: 'Processo legislativo',
    description: 'Matérias e movimentações legislativas obtidas do serviço oficial de dados abertos do Senado.',
    url: 'https://legis.senado.leg.br/dadosabertos/api-docs/swagger-ui/index.html',
    focus: ['Matérias legislativas', 'Comissões', 'Plenário'], monitoring: 'A cada 6 horas', priority: 4, color: 'teal', adapter: 'senado-api',
  },
  {
    id: 'stf', name: 'Supremo Tribunal Federal', acronym: 'STF', category: 'Jurisprudência constitucional',
    description: 'Acórdãos, decisões monocráticas, repercussão geral e controle concentrado em matéria tributária.',
    url: 'https://jurisprudencia.stf.jus.br/pages/search', discoveryUrl: 'https://portal.stf.jus.br/jurisprudenciaRepercussao/',
    focus: ['Acórdãos', 'Repercussão geral', 'Modulação de efeitos'], monitoring: 'A cada 6 horas', priority: 5, color: 'red', adapter: 'links',
  },
  {
    id: 'stj', name: 'Superior Tribunal de Justiça', acronym: 'STJ', category: 'Jurisprudência federal',
    description: 'Decisões, acórdãos, recursos repetitivos e precedentes qualificados sobre legislação tributária federal.',
    url: 'https://dadosabertos.web.stj.jus.br/', discoveryUrl: 'https://processo.stj.jus.br/repetitivos/temas_repetitivos/?pesquisaAvancada=true',
    focus: ['Acórdãos', 'Recursos repetitivos', 'Primeira Seção'], monitoring: 'A cada 6 horas', priority: 6, color: 'red', adapter: 'stj-open-data',
  },
  {
    id: 'carf', name: 'Conselho Administrativo de Recursos Fiscais', acronym: 'CARF', category: 'Contencioso administrativo',
    description: 'Acórdãos e decisões do contencioso administrativo tributário federal.',
    url: 'https://www.gov.br/carf/pt-br/jurisprudencia/acordaos-carf', discoveryUrl: 'https://www.gov.br/carf/pt-br/jurisprudencia/acordaos-carf',
    focus: ['Acórdãos', 'Súmulas', 'Resoluções'], monitoring: 'A cada 6 horas', priority: 7, color: 'gold', adapter: 'links',
  },
  ...[
    ['trf1', 'Tribunal Regional Federal da 1ª Região', 'TRF1', 'https://www.trf1.jus.br/trf1/carta-servicos/jurisprudencia'],
    ['trf2', 'Tribunal Regional Federal da 2ª Região', 'TRF2', 'https://www.trf2.jus.br/trf2/consultas-e-servicos/jurisprudencia'],
    ['trf3', 'Tribunal Regional Federal da 3ª Região', 'TRF3', 'https://web.trf3.jus.br/jurisprudencia/home/index/1'],
    ['trf4', 'Tribunal Regional Federal da 4ª Região', 'TRF4', 'https://www.trf4.jus.br/trf4/controlador.php?acao=pagina_visualizar&id_pagina=2801'],
    ['trf5', 'Tribunal Regional Federal da 5ª Região', 'TRF5', 'https://jurisprudencia.trf5.jus.br/jurisprudencia/pesquisa.wsp'],
    ['trf6', 'Tribunal Regional Federal da 6ª Região', 'TRF6', 'https://portal.trf6.jus.br/'],
  ].map(([id, name, acronym, url], index) => ({
    id, name, acronym, category: 'Jurisprudência federal regional',
    description: 'Decisões, acórdãos, precedentes e informativos oficiais da Justiça Federal regional.',
    url, discoveryUrl: url, focus: ['Acórdãos', 'Decisões', 'Precedentes'], monitoring: 'A cada 6 horas', priority: 8 + index, color: 'blue', adapter: 'links',
  })),
];

export const complementarySources = [
  {
    id: 'jota', name: 'JOTA', acronym: 'JOTA', category: 'Imprensa jurídica especializada', sourceType: 'journalistic',
    description: 'Notícias e análises sobre direito tributário, tribunais, CARF, Congresso e reforma tributária.',
    url: 'https://www.jota.info/', discoveryUrl: 'https://portal.jota.info/feed',
    focus: ['Direito tributário', 'STF e STJ', 'CARF e reforma tributária'], monitoring: 'A cada 10 minutos', priority: 14, color: 'purple', adapter: 'rss',
  },
];

export const monitoredSources = [...officialSources, ...complementarySources];
