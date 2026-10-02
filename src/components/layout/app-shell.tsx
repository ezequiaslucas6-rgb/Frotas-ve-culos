'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Menu, Truck, X } from 'lucide-react';
import { signOut } from '@/actions/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { BOTTOM_NAV_HREFS, NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

interface AppShellProps {
  nome: string;
  papel: string;
  filialLabel: string | null;
  isAdmin: boolean;
  children: React.ReactNode;
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Truck className="size-4.5" />
      </span>
      Gestão de Frotas
    </Link>
  );
}

function UserBlock({ nome, papel, filialLabel }: Pick<AppShellProps, 'nome' | 'papel' | 'filialLabel'>) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{nome}</p>
        <p className="truncate text-xs text-muted-foreground">
          {papel}
          {filialLabel ? ` · ${filialLabel}` : ''}
        </p>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sair">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}

export function AppShell({ nome, papel, filialLabel, isAdmin, children }: AppShellProps) {
  const pathname = usePathname();
  // o menu guarda em qual rota foi aberto: navegar para outra rota o fecha (sem effect)
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const setMenuOpen = (open: boolean) => setMenuPath(open ? pathname : null);
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
  const bottomItems = items.filter((i) => BOTTOM_NAV_HREFS.includes(i.href));

  // o wizard de checklist ocupa a tela toda no celular (sem barra inferior)
  const immersive = pathname.startsWith('/checklists/novo');

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-card p-4 md:flex">
        <Brand />
        <nav className="flex flex-1 flex-col gap-1" aria-label="Principal">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive(pathname, href) && 'bg-accent text-accent-foreground',
              )}
            >
              <Icon className="size-4.5" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-3 border-t pt-4">
          <UserBlock nome={nome} papel={papel} filialLabel={filialLabel} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            Tema <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Barra superior (celular) */}
        <header className={cn('sticky top-0 z-30 flex items-center justify-between border-b bg-card/95 px-4 pt-safe backdrop-blur md:hidden', immersive && 'hidden')}>
          <div className="flex h-14 w-full items-center justify-between">
            <Brand />
            <div className="flex items-center">
              <ThemeToggle />
              <Button variant="ghost" size="icon" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>
                <Menu />
              </Button>
            </div>
          </div>
        </header>

        <main className={cn('mx-auto w-full max-w-6xl flex-1 p-4 md:p-8', !immersive && 'pb-28 md:pb-8')}>{children}</main>
      </div>

      {/* Barra inferior (celular) */}
      {!immersive ? (
        <nav
          aria-label="Navegação rápida"
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card/95 pb-safe backdrop-blur md:hidden"
        >
          {bottomItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cn(
                'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground',
                isActive(pathname, href) && 'text-primary',
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground"
          >
            <Menu className="size-5" />
            Menu
          </button>
        </nav>
      ) : null}

      {/* Drawer (celular) */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85%] flex-col gap-4 bg-card p-4 pt-safe pb-safe shadow-xl animate-in slide-in-from-right">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Menu</span>
              <Button variant="ghost" size="icon" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}>
                <X />
              </Button>
            </div>
            <nav className="flex flex-1 flex-col gap-1">
              {items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium',
                    isActive(pathname, href) ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-5" />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="border-t pt-4">
              <UserBlock nome={nome} papel={papel} filialLabel={filialLabel} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
