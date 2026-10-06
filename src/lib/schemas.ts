import { z } from 'zod';
import { isValidCnh, isValidCpf, isValidPlaca, normalizePlaca, normalizeWhatsapp, onlyDigits } from '@/lib/validators/documentos';
import { COMBUSTIVEIS, parseDecimalBR } from '@/lib/abastecimento/consumo';
import { toISODate } from '@/lib/dates';
import { CNH_CATEGORIAS } from '@/lib/motoristas/cnh';

/** FormData -> objeto simples (strings vazias viram undefined). */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('$ACTION')) continue; // campos internos do React/Next
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}

export const flattenErrors = (error: z.ZodError) => z.flattenError(error).fieldErrors as Record<string, string[]>;

const uuid = z.string().uuid('Identificador inválido.');
const optionalText = z.string().trim().max(500).optional();
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const optionalInt = (min: number, max = 2_000_000_000) =>
  z.preprocess(emptyToUndefined, z.coerce.number('Informe um número.').int('Use um número inteiro.').min(min).max(max).optional());
const requiredInt = (min: number, label: string, max = 2_000_000_000) =>
  z.coerce.number(`${label}: informe um número.`).int(`${label}: use um número inteiro.`).min(min, `${label}: mínimo ${min}.`).max(max);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const optionalDate = z.preprocess(emptyToUndefined, isoDate.optional());
/** checkbox HTML: presente ("on") = true */
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
const decimal = (label: string, min: number, max: number) =>
  z.preprocess(
    parseDecimalBR,
    z
      .number(`Informe ${label}.`)
      .refine(Number.isFinite, `${label[0]!.toUpperCase()}${label.slice(1)} inválido.`)
      .refine((n) => n >= min, `${label[0]!.toUpperCase()}${label.slice(1)} deve ser maior que zero.`)
      .refine((n) => n <= max, `Confira ${label}: valor alto demais.`),
  );
const senha = z.string('Informe a senha.').min(8, 'A senha deve ter ao menos 8 caracteres.').max(72, 'Senha longa demais.');

/* ----------------------------------------------------------------------------- */

export const filialSchema = z.object({
  id: uuid.optional(),
  nome_cidade: z.string().trim().min(2, 'Informe a cidade.').max(80),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'UF inválida (use 2 letras).'),
});

export const supervisorSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120),
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.')),
  senha: z.string().min(8, 'A senha deve ter ao menos 8 caracteres.').max(72),
  filial_id: uuid,
});

export const motoristaSchema = z.object({
  id: uuid.optional(),
  filial_id: uuid.optional(),
  nome: z.string().trim().min(2, 'Informe o nome completo.').max(120),
  cpf: z
    .string('Informe o CPF.')
    .refine(isValidCpf, 'CPF inválido.')
    .transform(onlyDigits),
  email: z.string('Informe o e-mail.').trim().toLowerCase().pipe(z.email('E-mail inválido.')),
  whatsapp: z
    .string('Informe o WhatsApp.')
    .transform((v, ctx) => {
      const normalized = normalizeWhatsapp(v);
      if (!normalized) ctx.issues.push({ code: 'custom', message: 'WhatsApp inválido. Use DDD + número.', input: v });
      return normalized ?? '';
    }),
  cnh: z.string('Informe a CNH.').refine(isValidCnh, 'CNH inválida.').transform(onlyDigits),
  status: z.enum(['ativo', 'inativo', 'afastado', 'ferias']).default('ativo'),
  // CNH
  cnh_categoria: z.enum(CNH_CATEGORIAS, 'Selecione a categoria.'),
  cnh_validade: z.string('Informe a validade.').regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
  cnh_primeira_habilitacao: optionalDate,
  cnh_emissao: optionalDate,
  cnh_uf: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() || undefined : v),
    z.string().regex(/^[A-Z]{2}$/, 'UF inválida.').optional(),
  ),
  cnh_ear: checkbox,
  cnh_observacoes: optionalText,
  cnh_frente_path: optionalText,
  cnh_verso_path: optionalText,
})
  .superRefine((m, ctx) => {
    const hoje = toISODate();
    if (m.cnh_emissao && m.cnh_validade && m.cnh_validade <= m.cnh_emissao) {
      ctx.addIssue({ code: 'custom', path: ['cnh_validade'], message: 'A validade deve ser posterior à emissão.' });
    }
    if (m.cnh_emissao && m.cnh_emissao > hoje) {
      ctx.addIssue({ code: 'custom', path: ['cnh_emissao'], message: 'A emissão não pode ser no futuro.' });
    }
    if (m.cnh_primeira_habilitacao && m.cnh_primeira_habilitacao > (m.cnh_emissao ?? hoje)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cnh_primeira_habilitacao'],
        message: 'A 1ª habilitação não pode ser posterior à emissão.',
      });
    }
  });

/** Login do motorista no app: o e-mail é o do cadastro; a senha provisória é definida aqui. */
export const acessoMotoristaSchema = z.object({ motorista_id: uuid, senha });

export const veiculoSchema = z.object({
  id: uuid.optional(),
  filial_id: uuid.optional(),
  placa: z
    .string('Informe a placa.')
    .refine(isValidPlaca, 'Placa inválida (ex.: ABC1D23 ou ABC-1234).')
    .transform(normalizePlaca),
  marca: optionalText,
  modelo: optionalText,
  ano: optionalInt(1950, 2100),
  km_atual: requiredInt(0, 'KM atual'),
  intervalo_revisao_km: requiredInt(1, 'Intervalo (KM)'),
  intervalo_revisao_dias: requiredInt(1, 'Intervalo (dias)'),
  proxima_revisao_km: optionalInt(0),
  proxima_revisao_data: z.preprocess(emptyToUndefined, isoDate.optional()),
  documento_path: optionalText,
  foto_geral_path: optionalText,
  motorista_id: z.preprocess(emptyToUndefined, uuid.optional()),
});

export const manutencaoSchema = z.object({
  veiculo_id: uuid,
  tipo: z.enum(['preventiva', 'corretiva']),
  descricao: z.string().trim().min(3, 'Descreva o serviço realizado.').max(1000),
  custo: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/\./g, '').replace(',', '.') : v),
    z.coerce.number('Informe o custo.').min(0, 'O custo não pode ser negativo.').max(99_999_999),
  ),
  km_registro: requiredInt(0, 'KM'),
  data_manutencao: isoDate,
  fornecedor: optionalText,
});

/** Conclusão de uma manutenção aberta (ex.: conserto da avaria do checklist): libera o veículo. */
export const concluirManutencaoSchema = manutencaoSchema.omit({ veiculo_id: true, tipo: true }).extend({ id: uuid });

/** Liberação do veículo pelo responsável (supervisor/admin), com o motivo. */
export const liberarVeiculoSchema = z.object({
  veiculo_id: uuid,
  motivo: z.string('Informe o motivo da liberação.').trim().min(5, 'Informe o motivo da liberação (mínimo 5 caracteres).').max(500),
});

const marcadorSchema = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });

const codigoItem = z.string().regex(/^[a-z0-9_]{2,40}$/, 'Item de checklist inválido.');

/** Itens exigidos dependem do tipo (checklist_modelo): conferidos na action e de novo na RPC. */
export const checklistSchema = z.object({
  checklistId: uuid,
  tipo: z.enum(['diario', 'semanal', 'mensal'], 'Escolha o tipo de checklist.'),
  veiculoId: uuid,
  motoristaId: uuid,
  kmAtual: z.number().int().min(0).max(2_000_000_000),
  observacoesGerais: z.string().trim().max(2000).optional(),
  /** perguntas Sim/Não (ex.: vazamento ou avaria) */
  respostas: z.record(codigoItem, z.boolean()).default({}),
  itens: z
    .array(
      z.object({
        categoria: codigoItem,
        fotoPath: z.string().min(5).max(300),
        severidade: z.enum(['ok', 'atencao', 'critico']),
        observacao: z.string().trim().max(1000).optional(),
        marcadores: z.array(marcadorSchema).max(20),
      }),
    )
    .min(1, 'O checklist precisa de fotos.')
    .max(60),
});

export type ChecklistInput = z.infer<typeof checklistSchema>;

export const abastecimentoSchema = z
  .object({
    veiculo_id: uuid,
    /** escolhido pelo supervisor/admin; para o motorista o servidor usa o próprio cadastro */
    motorista_id: z.preprocess(emptyToUndefined, uuid.optional()),
    data_abastecimento: isoDate,
    km: requiredInt(0, 'KM'),
    litros: decimal('a quantidade', 0.01, 5000),
    /** valor total do combustível no cupom (antes do desconto); o líquido é calculado no servidor */
    valor_bruto: decimal('o valor total', 0.01, 99_999_999),
    desconto: z.preprocess(
      (v) => (v === '' || v == null ? 0 : parseDecimalBR(v)),
      z.number('Desconto inválido.').refine(Number.isFinite, 'Desconto inválido.').min(0, 'O desconto não pode ser negativo.'),
    ),
    /** JSON com o que a leitura da foto encontrou (só para conferência) */
    leitura_cupom: z.string().max(8000).optional(),
    combustivel: z.enum(COMBUSTIVEIS.map((c) => c.value) as [string, ...string[]], 'Selecione o combustível.'),
    tanque_cheio: checkbox,
    posto: z.string().trim().max(120).optional(),
    observacao: z.string().trim().max(1000).optional(),
    comprovante_path: optionalText,
  })
  .refine((a) => a.data_abastecimento <= toISODate(), {
    path: ['data_abastecimento'],
    message: 'A data não pode ser no futuro.',
  })
  .refine((a) => a.desconto < a.valor_bruto, {
    path: ['desconto'],
    message: 'O desconto precisa ser menor que o valor total.',
  });

export const perfilSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(120).optional(),
  avatar_path: optionalText,
});

export const trocarSenhaSchema = z
  .object({ senha_atual: z.string('Informe a senha atual.').min(1, 'Informe a senha atual.'), nova_senha: senha, confirmar: z.string().optional() })
  .refine((s) => s.nova_senha === s.confirmar, { path: ['confirmar'], message: 'As senhas não conferem.' })
  .refine((s) => s.nova_senha !== s.senha_atual, { path: ['nova_senha'], message: 'Use uma senha diferente da atual.' });
