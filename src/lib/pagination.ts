export const PAGE_SIZE = 20;

export function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export const pageRange = (page: number, size = PAGE_SIZE) => ({ from: (page - 1) * size, to: page * size - 1 });

/** Remove caracteres que têm significado na sintaxe de filtros do PostgREST (or/ilike). */
export const sanitizeSearch = (raw: string | string[] | undefined) =>
  (Array.isArray(raw) ? raw[0] : raw)?.replace(/[,()*%\\:]/g, ' ').trim().slice(0, 60) || '';

export type SearchParams = Record<string, string | string[] | undefined>;

/** filial efetiva: supervisor => a própria; admin => ?filial= (ou todas). */
export function resolveFilialFilter(
  session: { isAdmin: boolean; profile: { filial_id: string | null } },
  sp: SearchParams,
): string | null {
  if (!session.isAdmin) return session.profile.filial_id;
  const f = Array.isArray(sp.filial) ? sp.filial[0] : sp.filial;
  return f && /^[0-9a-f-]{36}$/i.test(f) ? f : null;
}
