import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex h-64 items-center justify-center text-muted-foreground" role="status" aria-label="Carregando">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}
