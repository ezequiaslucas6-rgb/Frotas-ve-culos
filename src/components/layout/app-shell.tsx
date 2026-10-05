'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { signOut } from '@/actions/auth';
import { Volante } from '@/components/marca/volante';
import { AreaConteudo, NavegacaoProvider } from '@/components/navegacao';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ACAO_PRINCIPAL, BARRA_INFERIOR, itensDoPapel } from '@/lib/nav';
import { cn } from '@/lib/utils';
import type { Tables } from '@/types/database';

interface AppShellProps {
  nome: string;
  papel: string;
  role: Tables<'profiles'>['role'];
  filialLabel: string | null;
  avatarUrl: string | null;
  children: React.ReactNode;
}

/** Na tela da ação principal (ex.: /checklists/novo) só o botão de destaque fica ativo. */
const isActive = (pathname: string, href: string, acaoHref: string) =>
  !pathname.startsWith(acaoHref) && (pathname === href || pathname.startsWith(`${href}/`));

/** Marca Rodar: volante no quadrado arredondado. */
function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-10 items-center justify-center rounded-xl bg-white/95 text-icone', className)}>
      <Volante className="size-[70%]" titulo="Rodar" />
    </span>
  );
}

export function AppShell({ nome, papel, role, filialLabel, avatarUrl, children }: AppShellProps) {
  const pathname = usePathname();
  // o menu guarda em qual rota foi aberto: navegar para outra rota o fecha
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const items = itensDoPapel(role);
  const bottomItems = BARRA_INFERIOR[role].flatMap((href) => items.filter((i) => i.href === href));
  const acao = ACAO_PRINCIPAL[role];
  const AcaoIcon = acao.icon;
  const home = items[0]?.href ?? '/';
  const ativo = (href: string) => isActive(pathname, href, acao.href);
  const immersive = pathname.startsWith('/checklists/novo');

  return (
    <NavegacaoProvider>
    <div className="min-h-dvh md:pl-[88px]">
      {/* Trilho lateral (desktop): só ícones, item ativo "encaixa" no conteúdo */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[88px] flex-col items-center gap-8 bg-rail py-6 md:flex">
        <Link href={home} aria-label="Início">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-2" aria-label="Principal">
          {items.map(({ href, label, icon: Icon }) => {
            const atual = ativo(href);
            return (
              <Link
                key={href}
                href={href}
                // telas principais pré-carregadas COM os dados (válidos por 30 s): o clique abre na hora
                prefetch
                aria-label={label}
                aria-current={atual ? 'page' : undefined}
                className={cn(
                  'group relative flex size-12 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/10 hover:text-white',
                  atual && 'bg-white/15 text-white',
                )}
              >
                <Icon className="size-[22px]" />
                {atual ? (
                  <span aria-hidden className="absolute -right-[26px] size-4 rotate-45 rounded-[3px] bg-background" />
                ) : null}
                <span className="pointer-events-none absolute left-full ml-5 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-background opacity-0 transition-opacity group-hover:opacity-100">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>
        <Link
          href={acao.href}
          aria-label={acao.label}
          title={acao.label}
          className="flex size-12 items-center justify-center rounded-full bg-white text-icone transition-transform hover:scale-105"
        >
          <AcaoIcon className="size-5" strokeWidth={2.4} />
        </Link>
      </aside>

      {/* Barra superior */}
      <header
        className={cn(
          'sticky top-0 z-30 mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3 bg-background/90 px-4 pt-safe backdrop-blur md:px-8',
          immersive && 'hidden md:flex',
        )}
      >
        <div className="flex h-16 items-center gap-3">
          <Link href={home} className="md:hidden" aria-label="Início">
            <Logo className="size-9 bg-icone text-white" />
          </Link>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{filialLabel ?? 'Todas as filiais'}</p>
            <p className="text-sm font-semibold">{papel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <div className="ml-1 hidden items-center gap-1 rounded-xl bg-card py-1.5 pr-1.5 pl-3 md:flex">
            <Link href="/perfil" className="flex items-center gap-3 rounded-lg pr-1 hover:text-primary" title="Meu perfil">
              <span className="text-sm font-medium">{nome}</span>
              <Avatar nome={nome} url={avatarUrl} className="size-8 rounded-lg text-xs" />
            </Link>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="icon" className="size-8" aria-label="Sair" title="Sair">
                <LogOut className="size-4" />
              </Button>
            </form>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu" onClick={() => setMenuPath(pathname)}>
            <Menu />
          </Button>
        </div>
      </header>

      <AreaConteudo className={cn('mx-auto w-full max-w-[1280px] px-4 pt-2 pb-8 md:px-8', !immersive && 'pb-32 md:pb-10')}>
        {children}
      </AreaConteudo>

      {/* Barra inferior (celular) com câmera ao centro */}
      {!immersive ? (
        <nav aria-label="Navegação rápida" className="fixed inset-x-3 bottom-3 z-30 md:hidden">
          <div className="grid grid-cols-5 items-center rounded-2xl bg-card px-1 pb-safe shadow-[0_8px_30px_rgb(0_0_0/0.35)]">
            {bottomItems.slice(0, 2).map(({ href, label, curto, icon: Icon }) => (
              <BottomLink key={href} href={href} label={curto ?? label} ativo={ativo(href)} icon={<Icon className="size-5" />} />
            ))}
            <Link
              href={acao.href}
              aria-label={acao.label}
              className="mx-auto -mt-7 flex size-14 items-center justify-center rounded-full bg-icone text-white ring-4 ring-background"
            >
              <AcaoIcon className="size-6" />
            </Link>
            {bottomItems.slice(2).map(({ href, label, curto, icon: Icon }) => (
              <BottomLink key={href} href={href} label={curto ?? label} ativo={ativo(href)} icon={<Icon className="size-5" />} />
            ))}
            <button
              type="button"
              onClick={() => setMenuPath(pathname)}
              className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
            >
              <Menu className="size-5" />
              Menu
            </button>
          </div>
        </nav>
      ) : null}

      {/* Menu (celular) */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-black/60" onClick={() => setMenuPath(null)} />
          <div className="absolute inset-y-0 right-0 flex w-[300px] max-w-[86%] flex-col gap-5 bg-card p-5 pt-safe pb-safe animate-in slide-in-from-right">
            <div className="flex items-center justify-between pt-3">
              <Link href="/perfil" className="flex items-center gap-3">
                <Avatar nome={nome} url={avatarUrl} className="size-10 rounded-xl text-sm" />
                <div className="leading-tight">
                  <p className="font-semibold">{nome}</p>
                  <p className="text-xs text-muted-foreground">{papel} · ver perfil</p>
                </div>
              </Link>
              <Button variant="ghost" size="icon" aria-label="Fechar menu" onClick={() => setMenuPath(null)}>
                <X />
              </Button>
            </div>
            <nav className="flex flex-1 flex-col gap-1">
              {[...items, ...(role === 'motorista' ? [] : [{ href: '/perfil', label: 'Meu perfil', icon: UserRound }])].map(
                ({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    prefetch
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium',
                      ativo(href) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-raised',
                    )}
                  >
                    <Icon className="size-5" />
                    {label}
                  </Link>
                ),
              )}
            </nav>
            <form action={signOut}>
              <Button type="submit" variant="secondary" className="w-full">
                <LogOut /> Sair
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
    </NavegacaoProvider>
  );
}

function BottomLink({ href, label, ativo, icon }: { href: string; label: string; ativo: boolean; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={ativo ? 'page' : undefined}
      className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground', ativo && 'text-primary [&_svg]:text-icone')}
    >
      {icon}
      {label}
    </Link>
  );
}
