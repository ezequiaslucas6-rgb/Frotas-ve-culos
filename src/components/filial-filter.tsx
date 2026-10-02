'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useNavegacao } from '@/components/navegacao';
import { Select } from '@/components/ui/input';

/** Filtro de filial para o Admin (?filial=<id>). Supervisores não veem este filtro. */
export function FilialFilter({ filiais }: { filiais: Array<{ id: string; nome_cidade: string; uf: string }> }) {
  const { navegar } = useNavegacao();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get('filial') ?? '';

  return (
    <Select
      aria-label="Filtrar por filial"
      className="w-full sm:w-56"
      value={current}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set('filial', e.target.value);
        else next.delete('filial');
        next.delete('page');
        navegar(next.size ? `${pathname}?${next}` : pathname, { substituir: true, manterRolagem: true });
      }}
    >
      <option value="">Todas as filiais</option>
      {filiais.map((f) => (
        <option key={f.id} value={f.id}>
          {f.nome_cidade}/{f.uf}
        </option>
      ))}
    </Select>
  );
}
