import { Activity, Bell, Bookmark, ClipboardList, Gavel, Landmark, LayoutDashboard, LogOut, MessageSquareText, Scale, Settings, X, Zap } from 'lucide-react';

const userItems = [
  { icon: LayoutDashboard, label: 'Visão geral', id: 'overview' },
  { icon: Gavel, label: 'Ações acompanhadas', id: 'actions' },
  { icon: Zap, label: 'Reforma tributária', id: 'reforma' },
  { icon: ClipboardList, label: 'Obrigações acessórias', id: 'obrigacoes' },
  { icon: Bell, label: 'Alertas', id: 'alerts' },
  { icon: Bookmark, label: 'Oportunidades', id: 'opportunities' },
  { icon: MessageSquareText, label: 'Feedback', id: 'feedback' },
];

const adminItems = [
  ...userItems.slice(0, 1),
  { icon: Activity, label: 'Varredura automática', id: 'monitor' },
  ...userItems.slice(1, -1),
  { icon: Landmark, label: 'Fontes monitoradas', id: 'sources' },
  userItems[userItems.length - 1],
];

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'US';
}

export function Sidebar({ active, onChange, open, onClose, user, onLogout }) {
  const isAdmin = String(user?.role || '').split(',').includes('admin');
  const items = isAdmin ? adminItems : userItems;
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
        {isAdmin && <button className="nav__item" onClick={() => { onChange('settings'); onClose(); }}><Settings size={19} /><span>Configurações</span></button>}
        <div className="profile"><span className="profile__avatar">{initials(user?.name)}</span><span><strong>{user?.name || user?.email}</strong><small>{isAdmin ? 'Administradora' : 'Usuário'}</small></span><button className="icon-button profile__logout" onClick={onLogout} aria-label="Sair" title="Sair"><LogOut size={17} /></button></div>
      </div>
    </aside>
  );
}
