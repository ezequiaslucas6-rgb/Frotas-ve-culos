'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Camera, LogOut, Menu, Truck, X } from 'lucide-react';
import { signOut } from '@/actions/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  nome: string;
  papel: string;
  filialLabel: string | null;
  isAdmin: boolean;
  children: React.ReactNode;
}

const isActive = (pathname: string, href: string) =>
  href === '/checklists' ? pathname === href || (pathname.startsWith('/checklists/') && !pathname.startsWith('/checklists/novo')) : pathname === href || pathname.startsWith(`${href}/`);

const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-10 items-center justify-center rounded-xl bg-white/95 text-rail', className)}>
      <Truck className="size-5" strokeWidth={2.4} />
    </span>
  );
}

export function AppShell({ nome, papel, filialLabel, isAdmin, children }: AppShellProps) {
  const pathname = usePathname();
  // o menu guarda em qual rota foi aberto: navegar para outra rota o fecha
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
  const bottomItems = items.filter((i) => ['/dashboard', '/veiculos', '/manutencoes'].includes(i.href));
  const immersive = pathname.startsWith('/checklists/novo');

  return (
    <div className="min-h-dvh md:pl-[88px]">
      {/* Trilho lateral (desktop): só ícones, item ativo "encaixa" no conteúdo */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[88px] flex-col items-center gap-8 bg-rail py-6 md:flex">
        <Link href="/dashboard" aria-label="Início">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-2" aria-label="Principal">
          {items.map(({ href, label, icon: Icon }) => {
            const ativo = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'group relative flex size-12 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/10 hover:text-white',
                  ativo && 'bg-white/15 text-white',
                )}
              >
                <Icon className="size-[22px]" />
                {ativo ? (
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
          href="/checklists/novo"
          aria-label="Novo checklist"
          title="Novo checklist"
          className="flex size-12 items-center justify-center rounded-full bg-white text-rail transition-transform hover:scale-105"
        >
          <Camera className="size-5" strokeWidth={2.4} />
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
          <Link href="/dashboard" className="md:hidden" aria-label="Início">
            <Logo className="size-9 bg-rail text-white" />
          </Link>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{filialLabel ?? 'Todas as filiais'}</p>
            <p className="text-sm font-semibold">{papel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <div className="ml-1 hidden items-center gap-3 rounded-xl bg-card py-1.5 pr-1.5 pl-3 md:flex">
            <span className="text-sm font-medium">{nome}</span>
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/20 text-xs font-bold text-primary">{iniciais(nome)}</span>
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

      <main className={cn('mx-auto w-full max-w-[1280px] px-4 pt-2 pb-8 md:px-8', !immersive && 'pb-32 md:pb-10')}>{children}</main>

      {/* Barra inferior (celular) com câmera ao centro */}
      {!immersive ? (
        <nav aria-label="Navegação rápida" className="fixed inset-x-3 bottom-3 z-30 md:hidden">
          <div className="grid grid-cols-5 items-center rounded-2xl bg-card px-1 pb-safe shadow-[0_8px_30px_rgb(0_0_0/0.35)]">
            {bottomItems.slice(0, 2).map(({ href, label, icon: Icon }) => (
              <BottomLink key={href} href={href} label={label} ativo={isActive(pathname, href)} icon={<Icon className="size-5" />} />
            ))}
            <Link
              href="/checklists/novo"
              aria-label="Novo checklist"
              className="mx-auto -mt-7 flex size-14 items-center justify-center rounded-full bg-rail text-white ring-4 ring-background"
            >
              <Camera className="size-6" />
            </Link>
            {bottomItems.slice(2).map(({ href, label, icon: Icon }) => (
              <BottomLink key={href} href={href} label={label} ativo={isActive(pathname, href)} icon={<Icon className="size-5" />} />
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
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/20 text-sm font-bold text-primary">{iniciais(nome)}</span>
                <div className="leading-tight">
                  <p className="font-semibold">{nome}</p>
                  <p className="text-xs text-muted-foreground">{papel}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Fechar menu" onClick={() => setMenuPath(null)}>
                <X />
              </Button>
            </div>
            <nav className="flex flex-1 flex-col gap-1">
              {items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium',
                    isActive(pathname, href) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-raised',
                  )}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              ))}
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
  );
}

function BottomLink({ href, label, ativo, icon }: { href: string; label: string; ativo: boolean; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? 'page' : undefined}
      className={cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground', ativo && 'text-primary')}
    >
      {icon}
      {label}
    </Link>
  );
}
