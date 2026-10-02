/**
 * Tipos do banco no formato de `supabase gen types typescript`.
 * Mantidos à mão para refletir supabase/migrations/20260101000000_init.sql.
 * Após mudanças no schema, você pode regenerá-los com:
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type UserRole = 'admin' | 'supervisor';
type MotoristaStatus = 'ativo' | 'inativo' | 'afastado' | 'ferias';
type ChecklistStatus = 'ok' | 'atencao' | 'critico';
type ManutencaoTipo = 'preventiva' | 'corretiva';
type AlertaStatus = 'ok' | 'proximo' | 'vencido';
type CategoriaFoto =
  | 'lateral_direita'
  | 'lateral_esquerda'
  | 'frente'
  | 'traseira'
  | 'carroceria_portamalas'
  | 'interior'
  | 'painel'
  | 'rodas'
  | 'nivel_oleo'
  | 'nivel_agua'
  | 'motor'
  | 'retrovisores'
  | 'para_brisa'
  | 'luzes_sinalizacao';

type FilialRow = { id: string; nome_cidade: string; uf: string; created_at: string };
type ProfileRow = { id: string; nome: string; role: UserRole; filial_id: string | null; created_at: string };
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
};
type ChecklistRow = {
  id: string;
  veiculo_id: string;
  motorista_id: string;
  filial_id: string;
  supervisor_id: string;
  data_envio: string;
  observacoes_gerais: string | null;
  status: ChecklistStatus;
  km_registro: number | null;
};
type ChecklistFotoRow = {
  id: string;
  checklist_id: string;
  categoria_foto: CategoriaFoto;
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
    };
    Views: {
      vw_veiculos_painel: { Row: VeiculoPainelRow; Relationships: [] };
    };
    Functions: {
      salvar_checklist: {
        Args: {
          p_id: string;
          p_veiculo_id: string;
          p_motorista_id: string;
          p_observacoes: string | null;
          p_km: number | null;
          p_fotos: Json;
        };
        Returns: string;
      };
    };
    Enums: {
      user_role: UserRole;
      motorista_status: MotoristaStatus;
      checklist_status: ChecklistStatus;
      manutencao_tipo: ManutencaoTipo;
      alerta_status: AlertaStatus;
      categoria_foto: CategoriaFoto;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
