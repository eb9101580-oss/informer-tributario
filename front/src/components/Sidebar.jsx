import { Activity, Bell, Bookmark, Bot, Gavel, Landmark, LayoutDashboard, MessageSquareText, Radar, Scale, Settings, X } from 'lucide-react';

const items = [
  { icon: LayoutDashboard, label: 'Visão geral', id: 'overview' },
  { icon: Radar, label: 'Radar diário', id: 'radar' },
  { icon: Activity, label: 'Varredura automática', id: 'monitor' },
  { icon: Gavel, label: 'Ações acompanhadas', id: 'actions' },
  { icon: Bell, label: 'Alertas', id: 'alerts' },
  { icon: Bookmark, label: 'Oportunidades', id: 'opportunities' },
  { icon: Bot, label: 'Coletor IA', id: 'collector' },
  { icon: Landmark, label: 'Fontes monitoradas', id: 'sources' },
  { icon: MessageSquareText, label: 'Feedbacks', id: 'feedback' },
];

export function Sidebar({ active, onChange, open, onClose }) {
  return (
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
      <div className="brand">
        <span className="brand__mark"><Scale size={22} /></span>
        <span><strong>informer</strong><small>inteligência tributária</small></span>
        <button className="icon-button sidebar__close" onClick={onClose} aria-label="Fechar menu"><X size={20} /></button>
      </div>
      <nav className="nav" aria-label="Navegação principal">
        <p className="nav__eyebrow">Monitoramento</p>
        {items.map(({ icon: Icon, label, id, badge }) => (
          <button key={id} className={`nav__item ${active === id ? 'nav__item--active' : ''}`} onClick={() => { onChange(id); onClose(); }}>
            <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{badge && <em>{badge}</em>}
          </button>
        ))}
      </nav>
      <div className="sidebar__bottom">
        <button className="nav__item"><Settings size={19} /><span>Configurações</span></button>
        <div className="profile"><span className="profile__avatar">JM</span><span><strong>Julia Martins</strong><small>Administradora</small></span></div>
      </div>
    </aside>
  );
}
