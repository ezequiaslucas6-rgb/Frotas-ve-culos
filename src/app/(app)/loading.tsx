/**
 * Esqueleto exibido na hora em que se troca de tela (já vem pré-carregado com os
 * links do menu): a estrutura aparece instantaneamente enquanto os dados chegam.
 */
function Bloco({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-card motion-reduce:animate-none ${className}`} />;
}

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Carregando">
      <div className="flex flex-col gap-2 pt-1">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-card motion-reduce:animate-none" />
        <div className="h-4 w-32 animate-pulse rounded-md bg-card/70 motion-reduce:animate-none" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Bloco className="h-24" />
        <Bloco className="h-24" />
        <Bloco className="h-24" />
        <Bloco className="h-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Bloco className="h-56" />
        <Bloco className="h-56" />
      </div>
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
