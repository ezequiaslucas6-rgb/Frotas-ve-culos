'use server';

import { revalidatePath } from 'next/cache';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { requireSession } from '@/lib/auth';
import { sincronizarAlertas } from '@/lib/maintenance/sync';

/** Recalcula agora os alertas de revisão da(s) filial(is) que o usuário enxerga (RLS). */
export async function atualizarAlertas(): Promise<ActionState> {
  const { supabase } = await requireSession();
  try {
    const r = await sincronizarAlertas(supabase);
    revalidatePath('/dashboard');
    revalidatePath('/manutencoes');
    return ok(`Alertas atualizados: ${r.vencidos} vencido(s), ${r.proximos} próximo(s) em ${r.veiculos} veículo(s).`);
  } catch (error) {
    console.error('[alertas]', error);
    return fail('Não foi possível atualizar os alertas.');
  }
}
