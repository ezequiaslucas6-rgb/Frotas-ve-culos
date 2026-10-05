'use client';

import { useActionState, useState } from 'react';
import { salvarModelosChecklist } from '@/actions/checklists';
import { Card, CardContent } from '@/components/ui/card';
import { FormMessage, SubmitButton } from '@/components/ui/form-feedback';
import { idle } from '@/lib/action-state';
import { TIPOS_CHECKLIST, type ItemChecklist } from '@/lib/checklist/etapas';

const chave = (tipo: string, codigo: string) => `${tipo}:${codigo}`;

/** Matriz item × tipo (Diário / Semanal / Mensal), agrupada como no assistente. */
export function ModelosForm({
  grupos,
  inicial,
}: {
  grupos: Array<{ grupo: string; itens: ItemChecklist[] }>;
  inicial: Partial<Record<string, string[]>>;
}) {
  const [state, action, pending] = useActionState(salvarModelosChecklist, idle);
  const [marcados, setMarcados] = useState(
    () => new Set(TIPOS_CHECKLIST.flatMap((t) => (inicial[t.value] ?? []).map((codigo) => chave(t.value, codigo)))),
  );
  const itens = grupos.flatMap((g) => g.itens);
  const fotos = (tipo: string) => itens.filter((i) => !i.condicional && marcados.has(chave(tipo, i.codigo))).length;

  function alternar(tipo: string, codigo: string) {
    setMarcados((prev) => {
      const next = new Set(prev);
      const k = chave(tipo, codigo);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const colunas = (
    <div className="flex shrink-0 gap-1" aria-hidden>
      {TIPOS_CHECKLIST.map((t) => (
        <span key={t.value} className="w-14 text-center text-[11px] font-medium text-muted-foreground">
          {t.label}
        </span>
      ))}
    </div>
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <ul className="grid grid-cols-3 gap-2" aria-label="Fotos por tipo">
        {TIPOS_CHECKLIST.map((t) => (
          <li key={t.value} className="rounded-xl border bg-card px-2 py-2.5 text-center">
            <p className="text-sm font-semibold">{t.label}</p>
            <p className="text-xs text-muted-foreground">{fotos(t.value)} fotos</p>
          </li>
        ))}
      </ul>

      {grupos.map((g) => (
        <Card key={g.grupo} className="gap-0 py-0">
          <CardContent className="px-4">
            <div className="flex items-center justify-between gap-2 border-b py-3">
              <h2 className="min-w-0 font-semibold">{g.grupo}</h2>
              {colunas}
            </div>
            <ul className="divide-y">
              {g.itens.map((item) => (
                <li key={item.codigo} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.nome}</p>
                    {item.condicional ? (
                      <p className="text-xs text-muted-foreground">Pergunta Sim/Não: a foto só é pedida no &quot;Sim&quot;.</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {TIPOS_CHECKLIST.map((t) => (
                      <label key={t.value} className="flex h-11 w-14 cursor-pointer items-center justify-center rounded-lg hover:bg-raised/60">
                        <input
                          type="checkbox"
                          name={t.value}
                          value={item.codigo}
                          checked={marcados.has(chave(t.value, item.codigo))}
                          onChange={() => alternar(t.value, item.codigo)}
                          className="size-5 accent-primary"
                          aria-label={`${item.nome} no checklist ${t.label.toLowerCase()}`}
                        />
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <FormMessage state={state} />
      <SubmitButton pending={pending} size="lg" className="sm:w-fit">
        Salvar modelos
      </SubmitButton>
    </form>
  );
}
