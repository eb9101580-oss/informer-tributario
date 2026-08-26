import { BookOpenText, CalendarClock, Gavel, Landmark, Newspaper, Scale, Sparkles } from 'lucide-react';

const PRODUCT_ORDER = [
  ['Matinal', Newspaper, 'Fatos novos publicados no dia'],
  ['Direto da Corte', Scale, 'Decisões e movimentos de STF, STJ e TRFs'],
  ['Direto do CARF', Gavel, 'Julgamentos administrativos com efeito empresarial'],
  ['Direto do Legislativo', Landmark, 'Congresso, reforma e tramitação tributária'],
  ['Apostas da Semana', Sparkles, 'Agendas e cenários sustentados por fatos'],
  ['Relatório especial', BookOpenText, 'Mudanças amplas que exigem contexto'],
];

export function EditorialBriefing({ alerts = [], onOpen }) {
  const groups = PRODUCT_ORDER.map(([name, Icon, description]) => ({
    name,
    Icon,
    description,
    items: alerts.filter((alert) => (alert.editorialFormat || 'Monitoramento') === name).slice(0, 2),
  })).filter((group) => group.items.length);

  if (!groups.length) return null;

  return (
    <section className="editorial-briefing panel">
      <div className="panel__heading"><div><h2>Briefing tributário</h2><p>Curadoria por formato editorial, com contexto e próximos passos.</p></div><span><CalendarClock size={17} /></span></div>
      <div className="editorial-briefing__grid">
        {groups.map(({ name, Icon, description, items }) => <article key={name} className="editorial-product">
          <div className="editorial-product__heading"><span><Icon size={17} /></span><div><strong>{name}</strong><small>{description}</small></div></div>
          {items.map((alert) => <button key={alert.id} onClick={() => onOpen(alert)}><b>{alert.title}</b><span>{alert.summary}</span></button>)}
        </article>)}
      </div>
    </section>
  );
}
