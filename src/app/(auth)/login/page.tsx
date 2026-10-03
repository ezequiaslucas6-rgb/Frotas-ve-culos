import type { Metadata } from 'next';
import { Truck } from 'lucide-react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid grid-cols-1 min-h-dvh md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-rail p-12 text-white md:flex">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-rail">
          <Truck className="size-6" strokeWidth={2.4} />
        </span>
        <div className="relative z-10 max-w-sm">
          <h1 className="text-4xl leading-tight font-bold tracking-tight">Sua frota, em dia.</h1>
          <p className="mt-4 text-white/75">Checklist fotográfico, revisões por KM e por prazo e custo por filial — no celular e no escritório.</p>
        </div>
        <p className="relative z-10 text-sm text-white/60">Gestão de Frotas</p>
        {/* desenho de fundo: anéis concêntricos discretos */}
        <svg aria-hidden className="absolute -right-40 -bottom-40 size-[520px] text-white/10" viewBox="0 0 200 200" fill="none" stroke="currentColor">
          <circle cx="100" cy="100" r="98" />
          <circle cx="100" cy="100" r="74" />
          <circle cx="100" cy="100" r="50" />
        </svg>
      </section>
      <section className="flex items-center justify-center p-6 pt-safe pb-safe">
        <LoginForm next={next} />
      </section>
    </main>
  );
}
