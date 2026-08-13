import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { EmBreve } from '@/pages/EmBreve';
import { Configuracoes } from '@/pages/Configuracoes';
import { Leads } from '@/pages/Leads';
import { Importar } from '@/pages/Importar';
import { Campanhas } from '@/pages/Campanhas';
import { CampanhaDetalhe } from '@/pages/CampanhaDetalhe';
import { Tarefas } from '@/pages/Tarefas';
import { Notificacoes } from '@/pages/Notificacoes';
import { useUsuario } from '@/hooks/useAuth';
import { useEvents } from '@/hooks/useEvents';

function Carregando() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-[var(--color-texto-suave)]">
      Carregando…
    </div>
  );
}

function AppAutenticado({
  usuario,
}: {
  usuario: { id: string; email: string; nome: string };
}) {
  // Uma unica conexao SSE para o app inteiro.
  const { status: statusSSE } = useEvents(true);

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar usuario={usuario} statusSSE={statusSSE} />
          <main className="flex-1 overflow-y-auto p-5 lg:p-6">
            <div className="mx-auto max-w-[1400px]">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/importar" element={<Importar />} />
                <Route
                  path="/conversas"
                  element={
                    <EmBreve
                      titulo="Conversas"
                      fase="Fase 6"
                      descricao="Caixa de conversas com histórico completo por lead."
                    />
                  }
                />
                <Route path="/campanhas" element={<Campanhas />} />
                <Route path="/campanhas/:id" element={<CampanhaDetalhe />} />
                <Route path="/tarefas" element={<Tarefas />} />
                <Route path="/notificacoes" element={<Notificacoes />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
                <Route
                  path="*"
                  element={
                    <EmBreve
                      titulo="Página não encontrada"
                      fase="—"
                      descricao="Este endereço não existe."
                    />
                  }
                />
              </Routes>
            </div>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export function App() {
  const { data, isLoading } = useUsuario();

  if (isLoading) return <Carregando />;
  if (!data?.usuario) return <Login />;

  return <AppAutenticado usuario={data.usuario} />;
}
