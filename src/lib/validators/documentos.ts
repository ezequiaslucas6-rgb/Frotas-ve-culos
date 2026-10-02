/** Validadores e normalizadores de documentos brasileiros (sem dependências). */

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

const allSameDigit = (digits: string) => /^(\d)\1+$/.test(digits);

/** CPF: 11 dígitos + dois dígitos verificadores (módulo 11). */
export function isValidCpf(input: string): boolean {
  const cpf = onlyDigits(input);
  if (cpf.length !== 11 || allSameDigit(cpf)) return false;

  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** CNH: 11 dígitos + dois dígitos verificadores (algoritmo do DENATRAN). */
export function isValidCnh(input: string): boolean {
  const cnh = onlyDigits(input);
  if (cnh.length !== 11 || allSameDigit(cnh)) return false;

  let sum1 = 0;
  for (let i = 0, weight = 9; i < 9; i++, weight--) sum1 += Number(cnh[i]) * weight;
  let dv1 = sum1 % 11;
  let discount = 0;
  if (dv1 >= 10) {
    dv1 = 0;
    discount = 2;
  }

  let sum2 = 0;
  for (let i = 0, weight = 1; i < 9; i++, weight++) sum2 += Number(cnh[i]) * weight;
  let dv2 = (sum2 % 11) - discount;
  if (dv2 < 0) dv2 += 11;
  if (dv2 >= 10) dv2 = 0;

  return dv1 === Number(cnh[9]) && dv2 === Number(cnh[10]);
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). */
export const PLACA_REGEX = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export const normalizePlaca = (input: string) => input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
export const isValidPlaca = (input: string) => PLACA_REGEX.test(normalizePlaca(input));

export function formatPlaca(input: string): string {
  const placa = normalizePlaca(input);
  return /^[A-Z]{3}[0-9]{4}$/.test(placa) ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa;
}

/**
 * WhatsApp brasileiro. Aceita "(11) 99999-0001", "+55 11 99999-0001", "11999990001"...
 * Retorna o número normalizado "55" + DDD + número, ou null se for inválido.
 * Celular: 9 dígitos começando em 9. Também aceita celular legado de 8 dígitos (6–9).
 */
export function normalizeWhatsapp(input: string): string | null {
  let digits = onlyDigits(input);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length !== 10 && digits.length !== 11) return null;

  const ddd = digits.slice(0, 2);
  const local = digits.slice(2);
  if (!/^[1-9][1-9]$/.test(ddd)) return null;
  if (local.length === 9 && !local.startsWith('9')) return null;
  if (local.length === 8 && !/^[6-9]/.test(local)) return null;
  return `55${digits}`;
}

/** Link de contato rápido: https://wa.me/<numero>?text=<mensagem> */
export function whatsappLink(whatsapp: string, message?: string): string {
  const base = `https://wa.me/${onlyDigits(whatsapp)}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function formatCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export function formatWhatsapp(input: string): string {
  let d = onlyDigits(input);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const formatCnh = (input: string) => onlyDigits(input).slice(0, 11);
