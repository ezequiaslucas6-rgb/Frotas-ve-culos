/**
 * Tipos do banco no formato de `supabase gen types typescript`.
 * Mantidos à mão para refletir supabase/migrations/*.sql.
 * Após mudanças no schema, você pode regenerá-los com:
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type UserRole = 'admin' | 'supervisor' | 'motorista';
type MotoristaStatus = 'ativo' | 'inativo' | 'afastado' | 'ferias';
type ChecklistStatus = 'ok' | 'atencao' | 'critico';
type ManutencaoTipo = 'preventiva' | 'corretiva';
type AlertaStatus = 'ok' | 'proximo' | 'vencido';
type Combustivel = 'gasolina' | 'gasolina_aditivada' | 'etanol' | 'diesel_s10' | 'diesel_s500' | 'gnv';
type ChecklistTipo = 'diario' | 'semanal' | 'mensal';
type ManutencaoSituacao = 'aberta' | 'concluida';

type FilialRow = { id: string; nome_cidade: string; uf: string; created_at: string };
type ProfileRow = {
  id: string;
  nome: string;
  role: UserRole;
  filial_id: string | null;
  avatar_url: string | null;
  created_at: string;
};
type MotoristaRow = {
  id: string;
  filial_id: string;
  nome: string;
  cpf: string;
  email: string;
  whatsapp: string;
  cnh: string;
  status: MotoristaStatus;
  created_at: string;
  user_id: string | null;
  cnh_categoria: string | null;
  cnh_validade: string | null;
  cnh_primeira_habilitacao: string | null;
  cnh_emissao: string | null;
  cnh_uf: string | null;
  cnh_ear: boolean;
  cnh_observacoes: string | null;
  cnh_frente_url: string | null;
  cnh_verso_url: string | null;
};
type VeiculoRow = {
  id: string;
  filial_id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  documento_url: string | null;
  foto_geral_url: string | null;
  km_atual: number;
  intervalo_revisao_km: number;
  intervalo_revisao_dias: number;
  proxima_revisao_km: number | null;
  proxima_revisao_data: string | null;
  created_at: string;
  motorista_id: string | null;
};
type ChecklistRow = {
  id: string;
  veiculo_id: string;
  motorista_id: string;
  filial_id: string;
  supervisor_id: string | null;
  data_envio: string;
  observacoes_gerais: string | null;
  status: ChecklistStatus;
  km_registro: number | null;
  tipo: ChecklistTipo;
  /** respostas Sim/Não dos itens condicionais, ex.: { vazamento_avaria: false } */
  respostas: Json;
};
type ChecklistItemRow = {
  codigo: string;
  nome: string;
  grupo: string;
  instrucao: string | null;
  pergunta: string | null;
  ordem: number;
  condicional: boolean;
  ativo: boolean;
};
type ChecklistModeloRow = { tipo: ChecklistTipo; item: string };
type ChecklistFotoRow = {
  id: string;
  checklist_id: string;
  categoria_foto: string;
  foto_url: string;
  observacao: string | null;
  severidade: ChecklistStatus;
  marcadores: Json;
  created_at: string;
};
type ManutencaoRow = {
  id: string;
  veiculo_id: string;
  filial_id: string;
  tipo: ManutencaoTipo;
  custo: number;
  descricao: string;
  km_registro: number;
  data_manutencao: string;
  status_alerta: AlertaStatus;
  proxima_revisao_km: number | null;
  proxima_revisao_data: string | null;
  fornecedor: string | null;
  created_by: string | null;
  created_at: string;
  /** aberta = conserto pendente (ex.: aberta por avaria crítica no checklist) */
  situacao: ManutencaoSituacao;
  checklist_id: string | null;
  concluida_em: string | null;
  concluida_por: string | null;
};
type VeiculoBloqueioRow = {
  id: string;
  veiculo_id: string;
  filial_id: string;
  checklist_id: string | null;
  manutencao_id: string | null;
  motivo: string;
  bloqueado_em: string;
  liberado_em: string | null;
  liberado_por: string | null;
  liberacao: 'conserto' | 'responsavel' | null;
  liberacao_obs: string | null;
};
type VeiculoPainelRow = {
  id: string;
  filial_id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  km_atual: number;
  foto_geral_url: string | null;
  documento_url: string | null;
  intervalo_revisao_km: number;
  intervalo_revisao_dias: number;
  proxima_revisao_km: number | null;
  proxima_revisao_data: string | null;
  created_at: string;
  nome_cidade: string;
  uf: string;
  ultimo_checklist_id: string | null;
  ultimo_checklist_status: ChecklistStatus | null;
  ultimo_checklist_em: string | null;
  ultima_corretiva_em: string | null;
  ultima_preventiva_id: string | null;
  motorista_id: string | null;
  motorista_nome: string | null;
  /** bloqueio aberto = veículo "não liberado" */
  bloqueio_id: string | null;
  bloqueado_em: string | null;
  bloqueio_motivo: string | null;
  bloqueio_checklist_id: string | null;
  bloqueio_manutencao_id: string | null;
  ultima_liberacao_em: string | null;
  manutencoes_abertas: number;
};
type AbastecimentoRow = {
  id: string;
  veiculo_id: string;
  filial_id: string;
  motorista_id: string | null;
  registrado_por: string | null;
  data_abastecimento: string;
  km: number;
  litros: number;
  valor_total: number;
  preco_litro: number;
  combustivel: Combustivel;
  tanque_cheio: boolean;
  posto: string | null;
  comprovante_url: string | null;
  observacao: string | null;
  created_at: string;
};

/** Insert: campos obrigatórios (K) + demais opcionais. */
type Ins<R, K extends keyof R> = Pick<R, K> & Partial<Omit<R, K>>;

export type Database = {
  __InternalSupabase: { PostgrestVersion: '13.0.5' };
  public: {
    Tables: {
      filiais: {
        Row: FilialRow;
        Insert: Ins<FilialRow, 'nome_cidade' | 'uf'>;
        Update: Partial<FilialRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: Ins<ProfileRow, 'id' | 'nome'>;
        Update: Partial<ProfileRow>;
        Relationships: [
          {
            foreignKeyName: 'profiles_filial_id_fkey';
            columns: ['filial_id'];
            isOneToOne: false;
            referencedRelation: 'filiais';
            referencedColumns: ['id'];
          },
        ];
      };
      motoristas: {
        Row: MotoristaRow;
        Insert: Ins<MotoristaRow, 'filial_id' | 'nome' | 'cpf' | 'email' | 'whatsapp' | 'cnh'>;
        Update: Partial<MotoristaRow>;
        Relationships: [
          {
            foreignKeyName: 'motoristas_filial_id_fkey';
            columns: ['filial_id'];
            isOneToOne: false;
            referencedRelation: 'filiais';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'motoristas_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      veiculos: {
        Row: VeiculoRow;
        Insert: Ins<VeiculoRow, 'filial_id' | 'placa'>;
        Update: Partial<VeiculoRow>;
        Relationships: [
          {
            foreignKeyName: 'veiculos_filial_id_fkey';
            columns: ['filial_id'];
            isOneToOne: false;
            referencedRelation: 'filiais';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'veiculos_motorista_fk';
            columns: ['motorista_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'motoristas';
            referencedColumns: ['id', 'filial_id'];
          },
        ];
      };
      checklists: {
        Row: ChecklistRow;
        Insert: Ins<ChecklistRow, 'veiculo_id' | 'motorista_id' | 'filial_id'>;
        Update: Partial<ChecklistRow>;
        Relationships: [
          {
            foreignKeyName: 'checklists_filial_fk';
            columns: ['filial_id'];
            isOneToOne: false;
            referencedRelation: 'filiais';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklists_veiculo_fk';
            columns: ['veiculo_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'veiculos';
            referencedColumns: ['id', 'filial_id'];
          },
          {
            foreignKeyName: 'checklists_motorista_fk';
            columns: ['motorista_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'motoristas';
            referencedColumns: ['id', 'filial_id'];
          },
          {
            foreignKeyName: 'checklists_supervisor_id_fkey';
            columns: ['supervisor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_fotos: {
        Row: ChecklistFotoRow;
        Insert: Ins<ChecklistFotoRow, 'checklist_id' | 'categoria_foto' | 'foto_url'>;
        Update: Partial<ChecklistFotoRow>;
        Relationships: [
          {
            foreignKeyName: 'checklist_fotos_checklist_id_fkey';
            columns: ['checklist_id'];
            isOneToOne: false;
            referencedRelation: 'checklists';
            referencedColumns: ['id'];
          },
        ];
      };
      manutencoes: {
        Row: ManutencaoRow;
        Insert: Ins<ManutencaoRow, 'veiculo_id' | 'filial_id' | 'tipo' | 'descricao' | 'km_registro'>;
        Update: Partial<ManutencaoRow>;
        Relationships: [
          {
            foreignKeyName: 'manutencoes_filial_fk';
            columns: ['filial_id'];
            isOneToOne: false;
            referencedRelation: 'filiais';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'manutencoes_veiculo_fk';
            columns: ['veiculo_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'veiculos';
            referencedColumns: ['id', 'filial_id'];
          },
        ];
      };
      veiculo_bloqueios: {
        Row: VeiculoBloqueioRow;
        Insert: Ins<VeiculoBloqueioRow, 'veiculo_id' | 'filial_id' | 'motivo'>;
        Update: Partial<VeiculoBloqueioRow>;
        Relationships: [
          {
            foreignKeyName: 'veiculo_bloqueios_veiculo_fk';
            columns: ['veiculo_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'veiculos';
            referencedColumns: ['id', 'filial_id'];
          },
          {
            foreignKeyName: 'veiculo_bloqueios_checklist_id_fkey';
            columns: ['checklist_id'];
            isOneToOne: false;
            referencedRelation: 'checklists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'veiculo_bloqueios_liberado_por_fkey';
            columns: ['liberado_por'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_itens: {
        Row: ChecklistItemRow;
        Insert: Ins<ChecklistItemRow, 'codigo' | 'nome' | 'grupo' | 'ordem'>;
        Update: Partial<ChecklistItemRow>;
        Relationships: [];
      };
      checklist_modelo: {
        Row: ChecklistModeloRow;
        Insert: ChecklistModeloRow;
        Update: Partial<ChecklistModeloRow>;
        Relationships: [
          {
            foreignKeyName: 'checklist_modelo_item_fkey';
            columns: ['item'];
            isOneToOne: false;
            referencedRelation: 'checklist_itens';
            referencedColumns: ['codigo'];
          },
        ];
      };
      abastecimentos: {
        Row: AbastecimentoRow;
        Insert: Ins<AbastecimentoRow, 'veiculo_id' | 'filial_id' | 'km' | 'litros' | 'valor_total' | 'combustivel'>;
        Update: Partial<Omit<AbastecimentoRow, 'preco_litro'>>;
        Relationships: [
          {
            foreignKeyName: 'abastecimentos_filial_fk';
            columns: ['filial_id'];
            isOneToOne: false;
            referencedRelation: 'filiais';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'abastecimentos_veiculo_fk';
            columns: ['veiculo_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'veiculos';
            referencedColumns: ['id', 'filial_id'];
          },
          {
            foreignKeyName: 'abastecimentos_motorista_fk';
            columns: ['motorista_id', 'filial_id'];
            isOneToOne: false;
            referencedRelation: 'motoristas';
            referencedColumns: ['id', 'filial_id'];
          },
          {
            foreignKeyName: 'abastecimentos_registrado_por_fkey';
            columns: ['registrado_por'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      vw_veiculos_painel: { Row: VeiculoPainelRow; Relationships: [] };
    };
    Functions: {
      salvar_checklist: {
        Args: {
          p_id: string;
          p_tipo: ChecklistTipo;
          p_veiculo_id: string;
          p_motorista_id: string;
          p_observacoes: string | null;
          p_km: number | null;
          p_fotos: Json;
          p_respostas?: Json;
        };
        Returns: string;
      };
      definir_modelo_checklist: {
        Args: { p_tipo: ChecklistTipo; p_itens: string[] };
        Returns: undefined;
      };
      liberar_veiculo: {
        Args: { p_veiculo_id: string; p_motivo: string };
        Returns: undefined;
      };
      atualizar_meu_perfil: {
        Args: { p_nome: string | null; p_avatar_url: string | null };
        Returns: undefined;
      };
    };
    Enums: {
      user_role: UserRole;
      motorista_status: MotoristaStatus;
      checklist_status: ChecklistStatus;
      manutencao_tipo: ManutencaoTipo;
      alerta_status: AlertaStatus;
      checklist_tipo: ChecklistTipo;
      combustivel: Combustivel;
      manutencao_situacao: ManutencaoSituacao;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
