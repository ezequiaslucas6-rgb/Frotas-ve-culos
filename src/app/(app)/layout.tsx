import { AppShell } from '@/components/layout/app-shell';
import { PAPEL_LABEL, requireSession } from '@/lib/auth';
import { formatFilial } from '@/lib/format';
import { signedUrlMap } from '@/lib/storage';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, supabase } = await requireSession({ motorista: true });
  const avatar = profile.avatar_url ? await signedUrlMap(supabase, 'perfis', [profile.avatar_url]) : {};
  return (
    <AppShell
      nome={profile.nome}
      papel={PAPEL_LABEL[profile.role]}
      role={profile.role}
      filialLabel={profile.filiais ? formatFilial(profile.filiais) : null}
      avatarUrl={profile.avatar_url ? (avatar[profile.avatar_url] ?? null) : null}
    >
      {children}
    </AppShell>
  );
}
