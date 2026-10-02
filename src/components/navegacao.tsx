'use client';

import { createContext, use, useCallback, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface Navegacao {
  /** há uma navegação de filtro/busca/paginação em andamento */
  pendente: boolean;
  navegar: (href: string, opcoes?: { substituir?: boolean; manterRolagem?: boolean }) => void;
}

const Contexto = createContext<Navegacao>({ pendente: false, navegar: () => undefined });

/**
 * Filtros, busca e paginação mudam só a URL da MESMA tela: sem isto o Next mantém a
 * tela antiga sem nenhum sinal até a nova chegar (parece travado). Aqui a troca roda
 * numa transição: barra de progresso no topo + conteúdo esmaecido enquanto carrega.
 */
export function NavegacaoProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const navegar = useCallback<Navegacao['navegar']>(
    (href, { substituir = false, manterRolagem = false } = {}) =>
      iniciar(() => (substituir ? router.replace : router.push)(href, { scroll: !manterRolagem })),
    [router],
  );
  return (
    <Contexto value={{ pendente, navegar }}>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-primary transition-opacity duration-200',
          pendente ? 'animate-progresso opacity-100 motion-reduce:animate-none' : 'opacity-0',
        )}
      />
      {children}
    </Contexto>
  );
}

export const useNavegacao = () => use(Contexto);

/** <main> que esmaece enquanto a navegação da mesma tela carrega. */
export function AreaConteudo({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pendente } = useNavegacao();
  return (
    <main aria-busy={pendente} className={cn(className, 'transition-opacity duration-150', pendente && 'opacity-60')}>
      {children}
    </main>
  );
}

/**
 * Formulário de filtros (GET) sem recarregar a página inteira: monta a URL com os
 * campos preenchidos e navega no cliente (o <form> comum faria um reload completo).
 */
export function FormFiltros({ className, children }: { className?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { navegar } = useNavegacao();
  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const params = new URLSearchParams();
        for (const [k, v] of new FormData(e.currentTarget)) if (typeof v === 'string' && v.trim()) params.set(k, v.trim());
        navegar(params.size ? `${pathname}?${params}` : pathname, { manterRolagem: true });
      }}
    >
      {children}
    </form>
  );
}

/** Link da paginação que participa da transição (barra de progresso + conteúdo esmaecido). */
export function LinkNavegacao({ href, className, children, ...props }: React.ComponentProps<'a'> & { href: string }) {
  const { navegar } = useNavegacao();
  return (
    <a
      {...props}
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // nova aba etc.
        e.preventDefault();
        navegar(href);
      }}
    >
      {children}
    </a>
  );
}
