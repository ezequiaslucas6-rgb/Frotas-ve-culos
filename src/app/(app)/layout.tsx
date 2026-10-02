import { AppShell } from '@/components/layout/app-shell';
import { requireSession } from '@/lib/auth';
import { formatFilial } from '@/lib/format';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, isAdmin } = await requireSession();
  return (
    <AppShell
      nome={profile.nome}
      papel={isAdmin ? 'Administrador Geral' : 'Supervisor'}
      filialLabel={profile.filiais ? formatFilial(profile.filiais) : null}
      isAdmin={isAdmin}
    >
      {children}
    </AppShell>
  );
}
