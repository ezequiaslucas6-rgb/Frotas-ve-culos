import type { Metadata } from 'next';
import { Building2, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { CnhCard } from '@/components/motoristas/cnh-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { PAPEL_LABEL, requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import { formatFilial } from '@/lib/format';
import { signedUrlMap } from '@/lib/storage';
import { formatCpf, formatWhatsapp } from '@/lib/validators/documentos';
import { PerfilForm, SenhaForm } from './perfil-forms';

export const metadata: Metadata = { title: 'Meu perfil' };

export default async function PerfilPage() {
  const { supabase, profile, user, isMotorista } = await requireSession({ motorista: true });

  const { data: cadastro } = isMotorista ? await supabase.from('motoristas').select('*').maybeSingle() : { data: null };
  const [avatar, urlsCnh] = await Promise.all([
    signedUrlMap(supabase, 'perfis', [profile.avatar_url]),
    signedUrlMap(supabase, 'motoristas', [cadastro?.cnh_frente_url, cadastro?.cnh_verso_url]),
  ]);
  const avatarUrl = profile.avatar_url ? (avatar[profile.avatar_url] ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title="Meu perfil" />

      <Card className="flex-row items-center gap-4 px-5">
        <Avatar nome={profile.nome} url={avatarUrl} className="size-16 rounded-2xl text-xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{profile.nome}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={profile.role === 'admin' ? 'default' : 'secondary'}>
              <ShieldCheck /> {PAPEL_LABEL[profile.role]}
            </Badge>
            <span className="flex items-center gap-1">
              <Building2 className="size-3.5" /> {profile.filiais ? formatFilial(profile.filiais) : 'Todas as filiais'}
            </span>
            <span className="flex min-w-0 items-center gap-1">
              <Mail className="size-3.5 shrink-0" /> <span className="truncate">{user.email}</span>
            </span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4 text-primary" /> Dados de exibição
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PerfilForm
              userId={user.id}
              nome={profile.nome}
              nomeEditavel={!isMotorista}
              avatarPath={profile.avatar_url}
              avatarUrl={avatarUrl}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" /> Senha
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SenhaForm email={user.email ?? ''} />
          </CardContent>
        </Card>
      </div>

      {cadastro ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <CnhCard motorista={cadastro} urls={urlsCnh} hoje={toISODate()} />
          <Card>
            <CardHeader>
              <CardTitle>Meu cadastro</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">CPF</dt>
                  <dd className="font-semibold">{formatCpf(cadastro.cpf)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">WhatsApp</dt>
                  <dd className="font-semibold">{formatWhatsapp(cadastro.whatsapp)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">E-mail</dt>
                  <dd className="font-semibold break-all">{cadastro.email}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">Algum dado errado? Fale com o seu supervisor para corrigir.</p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
