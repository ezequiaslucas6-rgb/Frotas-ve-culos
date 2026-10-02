import { z } from 'zod';
import { isValidCnh, isValidCpf, isValidPlaca, normalizePlaca, normalizeWhatsapp, onlyDigits } from '@/lib/validators/documentos';
import { CHECKLIST_ETAPAS } from '@/lib/checklist/etapas';

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
});

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

const marcadorSchema = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });

export const checklistSchema = z.object({
  checklistId: uuid,
  veiculoId: uuid,
  motoristaId: uuid,
  kmAtual: z.number().int().min(0).max(2_000_000_000),
  observacoesGerais: z.string().trim().max(2000).optional(),
  itens: z
    .array(
      z.object({
        categoria: z.enum(CHECKLIST_ETAPAS.map((e) => e.categoria) as [string, ...string[]]),
        fotoPath: z.string().min(5).max(300),
        severidade: z.enum(['ok', 'atencao', 'critico']),
        observacao: z.string().trim().max(1000).optional(),
        marcadores: z.array(marcadorSchema).max(20),
      }),
    )
    .length(CHECKLIST_ETAPAS.length, `O checklist exige as ${CHECKLIST_ETAPAS.length} fotos obrigatórias.`),
});

export type ChecklistInput = z.infer<typeof checklistSchema>;
