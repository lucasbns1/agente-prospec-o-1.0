import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  MessagesSquare,
  Rocket,
  Download,
  CheckSquare,
  Bell,
  Settings,
  Radar,
  QrCode,
  KanbanSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAVEGACAO = [
  { para: '/', rotulo: 'Dashboard', icone: LayoutDashboard, exato: true },
  { para: '/leads', rotulo: 'Leads', icone: Users },
  { para: '/importar', rotulo: 'Importar', icone: Download },
  { para: '/campanhas', rotulo: 'Campanhas', icone: Rocket },
  { para: '/estado', rotulo: 'Estado das campanhas', icone: KanbanSquare },
  { para: '/conversas', rotulo: 'Conversas', icone: MessagesSquare },
  { para: '/tarefas', rotulo: 'Tarefas', icone: CheckSquare },
  { para: '/notificacoes', rotulo: 'Notificações', icone: Bell },
  { para: '/canal', rotulo: 'WhatsApp', icone: QrCode },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--color-borda)] bg-white md:flex">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-marca)]">
          <Radar className="h-4 w-4 text-white" aria-hidden="true" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Prospector</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Navegação principal">
        {NAVEGACAO.map(({ para, rotulo, icone: Icone, exato }) => (
          <NavLink
            key={para}
            to={para}
            end={exato}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-[var(--color-fundo)] font-medium text-[var(--color-texto)]'
                  : 'text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)] hover:text-[var(--color-texto)]'
              )
            }
          >
            <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
            {rotulo}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--color-borda)] px-3 py-2">
        <NavLink
          to="/configuracoes"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-[var(--color-fundo)] font-medium text-[var(--color-texto)]'
                : 'text-[var(--color-texto-suave)] hover:bg-[var(--color-fundo)] hover:text-[var(--color-texto)]'
            )
          }
        >
          <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
          Configurações
        </NavLink>
      </div>
    </aside>
  );
}
