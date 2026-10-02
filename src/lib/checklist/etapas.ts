import type { Enums } from '@/types/database';

export type CategoriaFoto = Enums<'categoria_foto'>;
export type Severidade = Enums<'checklist_status'>;

export interface EtapaChecklist {
  categoria: CategoriaFoto;
  titulo: string;
  dica: string;
}

/** As 14 etapas obrigatórias, na ordem de execução do wizard. */
export const CHECKLIST_ETAPAS: readonly EtapaChecklist[] = [
  { categoria: 'lateral_direita', titulo: 'Lateral direita', dica: 'Enquadre o veículo inteiro, do para-choque dianteiro ao traseiro.' },
  { categoria: 'lateral_esquerda', titulo: 'Lateral esquerda', dica: 'Enquadre o veículo inteiro, do para-choque dianteiro ao traseiro.' },
  { categoria: 'frente', titulo: 'Frente', dica: 'Fotografe de frente, mostrando para-choque, capô e faróis.' },
  { categoria: 'traseira', titulo: 'Parte de trás', dica: 'Fotografe de trás, mostrando para-choque, placa e lanternas.' },
  { categoria: 'carroceria_portamalas', titulo: 'Carroceria ou porta-malas', dica: 'Abra o porta-malas/carroceria e mostre limpeza, estepe e carga.' },
  { categoria: 'interior', titulo: 'Interior do veículo', dica: 'Mostre bancos, forro e limpeza da cabine.' },
  { categoria: 'painel', titulo: 'Painel (hodômetro / combustível)', dica: 'Com o veículo ligado: hodômetro, nível de combustível e luzes de alerta legíveis.' },
  { categoria: 'rodas', titulo: '4 rodas (pneus e aros)', dica: 'Mostre o estado de pneus e aros. Se não couber em uma foto, enquadre o conjunto.' },
  { categoria: 'nivel_oleo', titulo: 'Nível de óleo', dica: 'Mostre a vareta de óleo retirada, com o nível visível.' },
  { categoria: 'nivel_agua', titulo: 'Nível de água / arrefecimento', dica: 'Mostre o reservatório de arrefecimento com as marcas de nível.' },
  { categoria: 'motor', titulo: 'Motor', dica: 'Capô aberto, enquadrando o compartimento do motor.' },
  { categoria: 'retrovisores', titulo: 'Retrovisores', dica: 'Mostre os dois retrovisores (espelho e carcaça).' },
  { categoria: 'para_brisa', titulo: 'Para-brisa', dica: 'Mostre o para-brisa e as palhetas; atenção a trincas e lascas.' },
  { categoria: 'luzes_sinalizacao', titulo: 'Luzes / sinalização', dica: 'Faróis, setas e lanternas acesos (use o ajudante para conferir).' },
] as const;

export const TOTAL_ETAPAS = CHECKLIST_ETAPAS.length;

export const ETAPA_POR_CATEGORIA = Object.fromEntries(
  CHECKLIST_ETAPAS.map((e) => [e.categoria, e]),
) as Record<CategoriaFoto, EtapaChecklist>;

export const SEVERIDADE_LABEL: Record<Severidade, string> = {
  ok: 'Conforme',
  atencao: 'Atenção',
  critico: 'Avaria',
};

const PESO: Record<Severidade, number> = { ok: 0, atencao: 1, critico: 2 };

/** Status geral do checklist: a pior severidade entre os itens (mesma regra da RPC salvar_checklist). */
export function calcularStatusChecklist(severidades: Iterable<Severidade>): Severidade {
  let pior: Severidade = 'ok';
  for (const s of severidades) if (PESO[s] > PESO[pior]) pior = s;
  return pior;
}

export function contarSeveridades(severidades: Iterable<Severidade>): Record<Severidade, number> {
  const total: Record<Severidade, number> = { ok: 0, atencao: 0, critico: 0 };
  for (const s of severidades) total[s]++;
  return total;
}

/** Caminho no bucket "checklists": <filial>/<checklist>/<categoria>.jpg */
export const caminhoFotoChecklist = (filialId: string, checklistId: string, categoria: CategoriaFoto) =>
  `${filialId}/${checklistId}/${categoria}.jpg`;

/** Pin de avaria sobre a foto, em % da imagem (0–100). */
export interface MarcadorAvaria {
  x: number;
  y: number;
}
