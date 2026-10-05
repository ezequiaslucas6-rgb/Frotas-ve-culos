import type { Metadata } from 'next';
import { RegistrarServiceWorker } from '@/components/offline/registrar-sw';
import { cn } from '@/lib/utils';
import { LoginForm } from './login-form';
import { OndaSuave } from './onda-suave';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh grid-cols-1 grid-rows-[auto_1fr] md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:grid-rows-1">
      {/* Marca: no celular é o topo da tela; no computador, o painel da esquerda */}
      <section className="relative isolate flex flex-col overflow-hidden px-6 pt-safe pb-14 text-white md:justify-center md:p-12">
        <OndaSuave className="absolute inset-0 -z-10 size-full" />

        <div className="relative w-full pt-10 md:max-w-sm md:pt-0">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-3 text-2xl font-bold tracking-tight md:text-3xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marca/volante.png" alt="" width={256} height={256} className="size-12 drop-shadow-sm md:size-16" />
              Rodar
            </p>
            {/* celular: o logo N vai na linha da marca. Montado como o volante (imagem simples,
                sem filtro, transform ou position): o Safari do iPhone não pintava o N com a sombra
                + posição relativa ao lado dos anéis deslocados por transform. */}
            <span aria-hidden className="relative shrink-0 md:hidden">
              <svg className="absolute -inset-[80%] -z-10 text-white/15" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="0.6">
                <circle cx="100" cy="100" r="98" />
                <circle cx="100" cy="100" r="76" />
                <circle cx="100" cy="100" r="54" />
              </svg>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marca/logo-n.png" alt="" width={472} height={497} className="block size-14 object-contain" />
            </span>
          </div>
          <h1 className="mt-4 text-3xl leading-tight font-bold tracking-tight md:mt-5 md:text-[2.75rem]">Sua frota, em dia.</h1>
        </div>

        <p className="absolute bottom-12 left-12 hidden text-sm text-white/75 md:block">Gestão de Frotas</p>

        {/* computador: logo N com anéis no canto de baixo à direita */}
        <LogoN className="absolute right-8 bottom-8 hidden size-36 md:block lg:size-52" />

        {/* celular: a borda de baixo também é uma onda, encaixando no formulário */}
        <svg aria-hidden className="absolute inset-x-0 -bottom-px h-8 w-full text-background md:hidden" viewBox="0 0 400 32" preserveAspectRatio="none">
          <path d="M0 18 C 70 2, 140 2, 210 14 S 340 34, 400 12 L 400 32 L 0 32 Z" fill="currentColor" />
        </svg>
      </section>

      <section className="flex items-start justify-center px-6 pt-4 pb-safe md:items-center md:p-6">
        {/* saiu da conta: a tela do checklist guardada para uso offline era de quem saiu */}
        <RegistrarServiceWorker limpar />
        <LoginForm next={next} />
      </section>
    </main>
  );
}

/** Logo N com anéis concêntricos discretos em volta. */
function LogoN({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('relative shrink-0', className)}>
      <svg className="absolute top-1/2 left-1/2 size-[260%] -translate-x-1/2 -translate-y-1/2 text-white/15" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="0.6">
        <circle cx="100" cy="100" r="98" />
        <circle cx="100" cy="100" r="76" />
        <circle cx="100" cy="100" r="54" />
      </svg>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/marca/logo-n.png" alt="" width={472} height={497} className="relative size-full object-contain drop-shadow-md" />
    </div>
  );
}
