export const taxSections = [
  {
    id: 'reforma',
    label: 'Reforma tributária',
    title: 'Reforma tributária do consumo',
    description: 'IBS, CBS, Imposto Seletivo, transição, documentos fiscais, regulamentação e impactos operacionais.',
    focus: ['IBS e CBS', 'CGIBS', 'Regulamentação', 'Documentos fiscais', 'Transição'],
    sourceIds: ['reforma-portal', 'reforma-cgibs', 'reforma-folha', 'reforma-valor', 'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'sped-dere', 'camara', 'senado', 'receita-in', 'diario-oficial'],
    color: 'gold',
  },
  {
    id: 'obrigacoes',
    label: 'Obrigações acessórias',
    title: 'Obrigações acessórias e escriturações digitais',
    description: 'Ajustes SINIEF, notas técnicas, manuais, leiautes, tabelas e versões que alteram a forma de informar dados fiscais, contábeis e trabalhistas.',
    focus: ['Ajustes SINIEF', 'NF-e', 'SPED', 'Manuais', 'Leiautes'],
    sourceIds: ['confaz-ajustes', 'nfe-notas-tecnicas', 'sped-notas-tecnicas', 'sped-ecd', 'sped-ecf', 'sped-efd-contribuicoes', 'sped-efd-icms-ipi', 'sped-efd-reinf', 'sped-e-financeira', 'sped-esocial', 'sped-central-balancos', 'sped-dere', 'receita-in'],
    color: 'teal',
  },
];

export function sectionIdsForSource(sourceId) {
  return taxSections.filter((section) => section.sourceIds.includes(sourceId)).map((section) => section.id);
}

export function getTaxSection(id) {
  return taxSections.find((section) => section.id === id) || null;
}
