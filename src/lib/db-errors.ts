import type { PostgrestError } from '@supabase/supabase-js';

const UNIQUE_MESSAGES: Record<string, string> = {
  veiculos_placa_key: 'Já existe um veículo cadastrado com esta placa.',
  motoristas_filial_id_cpf_key: 'Já existe um motorista com este CPF nesta filial.',
  filiais_nome_cidade_uf_key: 'Esta filial já está cadastrada.',
};

/** Traduz erros do Postgres/PostgREST em mensagens amigáveis (sem vazar detalhes internos). */
export function friendlyDbError(error: Pick<PostgrestError, 'code' | 'message' | 'details'>): string {
  switch (error.code) {
    case '23505': {
      const hit = Object.entries(UNIQUE_MESSAGES).find(([constraint]) =>
        `${error.message} ${error.details ?? ''}`.includes(constraint),
      );
      return hit?.[1] ?? 'Já existe um registro com estes dados.';
    }
    case '23503':
      return 'Não é possível concluir: há registros vinculados (histórico) ou a referência é inválida.';
    case '23514':
      // as regras das funções do banco (raise exception) já vêm escritas para o usuário;
      // só a violação de CHECK traz texto técnico
      return /check constraint|violates|viola/i.test(error.message) ? 'Algum dos valores informados não é aceito.' : error.message;
    case '42501':
      return 'Você não tem permissão para realizar esta operação.';
    default:
      if (/row-level security/i.test(error.message)) return 'Você não tem permissão para realizar esta operação.';
      console.error('[db]', error.code, error.message);
      return 'Não foi possível concluir a operação. Tente novamente.';
  }
}
