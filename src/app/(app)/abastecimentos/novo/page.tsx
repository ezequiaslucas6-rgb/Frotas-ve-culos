import type { Metadata } from 'next';
import { CarFront } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import type { Combustivel } from '@/lib/abastecimento/consumo';
import { requireSession } from '@/lib/auth';
import { toISODate } from '@/lib/dates';
import type { SearchParams } from '@/lib/pagination';
import { AbastecimentoForm } from './abastecimento-form';

export const metadata: Metadata = { title: 'Registrar abastecimento' };

export default async function NovoAbastecimentoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { supabase, isMotorista } = await requireSession({ motorista: true });

  // A RLS decide a lista: motorista -> só os veículos dele; supervisor -> filial; admin -> todos.
  const [{ data: veiculos }, { data: motoristas }, { data: ultimo }] = await Promise.all([
    supabase.from('veiculos').select('id, placa, marca, modelo, km_atual, filial_id, motorista_id').order('placa'),
    isMotorista
      ? Promise.resolve({ data: null })
      : supabase.from('motoristas').select('id, nome, filial_id').neq('status', 'inativo').order('nome'),
    supabase.from('abastecimentos').select('combustivel').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const lista = veiculos ?? [];
  const pedido = typeof sp.veiculo === 'string' ? sp.veiculo : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Registrar abastecimento"
        description={isMotorista ? 'Lance logo após abastecer, com a foto do cupom.' : undefined}
      />
      {lista.length === 0 ? (
        <EmptyState
          icon={<CarFront />}
          title={isMotorista ? 'Nenhum veículo sob sua responsabilidade' : 'Nenhum veículo cadastrado'}
          description={isMotorista ? 'Peça ao seu supervisor para vincular o veículo ao seu cadastro.' : undefined}
        />
      ) : (
        <AbastecimentoForm
          veiculos={lista}
          motoristas={motoristas}
          veiculoInicial={pedido && lista.some((v) => v.id === pedido) ? pedido : null}
          combustivelInicial={(ultimo?.combustivel as Combustivel | undefined) ?? 'diesel_s10'}
          hoje={toISODate()}
        />
      )}
    </div>
  );
}
