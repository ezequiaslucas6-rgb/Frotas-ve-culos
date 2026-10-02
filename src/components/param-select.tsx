'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/input';

/** Filtro simples por parâmetro da URL (?<param>=valor); volta à 1ª página ao mudar. */
export function ParamSelect({
  param,
  label,
  opcoes,
  todos,
  padrao = '',
}: {
  param: string;
  label: string;
  opcoes: Array<{ value: string; label: string }>;
  /** rótulo da opção "sem filtro" (omitido: não há essa opção) */
  todos?: string;
  /** valor exibido quando o parâmetro não está na URL */
  padrao?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Select
      aria-label={label}
      className="w-full sm:w-52"
      value={params.get(param) ?? padrao}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(param, e.target.value);
        else next.delete(param);
        next.delete('page');
        next.delete('registrado');
        router.replace(next.size ? `${pathname}?${next}` : pathname);
      }}
    >
      {todos !== undefined ? <option value="">{todos}</option> : null}
      {opcoes.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
