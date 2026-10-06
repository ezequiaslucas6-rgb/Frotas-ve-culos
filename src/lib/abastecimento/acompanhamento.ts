/**
 * Acompanhamento de abastecimentos (supervisor/admin): cada lançamento com todos os detalhes
 * e os totais por veículo, motorista e posto. Funções puras: a página e a exportação (CSV)
 * usam as mesmas contas.
 *
 * Consumo (km/l) e anomalias são calculados com o histórico do veículo (tanque cheio a tanque
 * cheio, só com o KM dos abastecimentos); por isso os registros trazem também os lançamentos
 * de antes do período, marcados como contexto.
 */
import { calcularCupom, conferirPlaca, registroLeituraSchema } from './cupom';
import { calcularConsumo, ciclosConsumo, detectarConsumoAnormal, type AnomaliaConsumo, type Combustivel } from './consumo';

export interface RegistroAbastecimento {
  id: string;
  veiculo_id: string;
  motorista_id: string | null;
  data_abastecimento: string;
  created_at: string;
  km: number;
  litros: number;
  valor_bruto: number | null;
  desconto: number | null;
  valor_total: number;
  preco_litro: number;
  combustivel: Combustivel;
  tanque_cheio: boolean;
  posto: string | null;
  comprovante_url: string | null;
  observacao: string | null;
  leitura_cupom: unknown;
  veiculos: { placa: string; modelo: string | null } | null;
  motoristas: { nome: string } | null;
}

export type SituacaoFiltro = 'todos' | 'consumo' | 'cupom' | 'sem_comprovante' | 'manual';

export const SITUACOES: Array<{ value: SituacaoFiltro; label: string }> = [
  { value: 'todos', label: 'Todos os lançamentos' },
  { value: 'consumo', label: 'Consumo fora do padrão' },
  { value: 'cupom', label: 'Cupom a conferir' },
  { value: 'sem_comprovante', label: 'Sem foto do cupom' },
  { value: 'manual', label: 'Digitados à mão' },
];

/** Como os valores do lançamento chegaram: leitura da foto (e se conferiu) ou digitação. */
export interface ConferenciaCupom {
  origem: 'leitura' | 'manual';
  modelo: string | null;
  /** a leitura bateu nas próprias contas do cupom */
  conferido: boolean;
  /** a leitura precisou de correção de um dígito */
  corrigido: boolean;
  /** os valores gravados são diferentes dos que a leitura calculou (alguém mudou à mão) */
  editado: boolean;
  /** placa impressa no cupom confere com o veículo (null = sem placa no cupom) */
  placaConfere: boolean | null;
  /** KM impresso no cupom (o frentista digita) */
  kmCupom: number | null;
  avisos: string[];
}

export interface LinhaAcompanhamento {
  id: string;
  data: string;
  registradoEm: string;
  veiculoId: string;
  placa: string;
  modelo: string | null;
  motoristaId: string | null;
  motorista: string | null;
  combustivel: Combustivel;
  km: number;
  /** km desde o abastecimento anterior do veículo (qualquer um) */
  kmDesdeAnterior: number | null;
  litros: number;
  valorBruto: number;
  desconto: number;
  valorPago: number;
  /** preço da bomba (sem desconto) */
  precoBomba: number | null;
  /** preço por litro com desconto */
  unitario: number;
  kml: number | null;
  anomalia: AnomaliaConsumo | null;
  tanqueCheio: boolean;
  posto: string | null;
  comprovante: string | null;
  observacao: string | null;
  cupom: ConferenciaCupom;
}

export interface Totais {
  quantidade: number;
  litros: number;
  valorBruto: number;
  desconto: number;
  valorPago: number;
  /** preço médio por litro com desconto (só combustíveis líquidos) */
  precoMedio: number | null;
  /** preço médio da bomba, sem desconto */
  precoBombaMedio: number | null;
  /** km dos ciclos tanque cheio → tanque cheio fechados no período */
  kmRodados: number;
  kml: number | null;
  /** R$ por km = preço médio por litro ÷ km/l */
  custoKm: number | null;
}

export interface Agrupado extends Totais {
  chave: string;
  nome: string;
  detalhe?: string | null;
  anomalias: number;
}

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Como os valores chegaram e se conferem com a leitura da foto. */
export function conferenciaDoCupom(r: RegistroAbastecimento): ConferenciaCupom {
  const reg = registroLeituraSchema.safeParse(r.leitura_cupom);
  if (!reg.success) {
    return { origem: 'manual', modelo: null, conferido: false, corrigido: false, editado: false, placaConfere: null, kmCupom: null, avisos: [] };
  }
  const c = calcularCupom(reg.data.leitura);
  const placa = r.veiculos ? conferirPlaca(reg.data.leitura.placa, r.veiculos.placa) : null;
  const diferente = (gravado: number, lido: number | null, tolerancia: number) => lido != null && Math.abs(gravado - lido) > tolerancia;
  const editado =
    diferente(num(r.litros), c.litros, 0.005) || diferente(num(r.valor_bruto ?? r.valor_total), c.valorBruto, 0.009) || diferente(num(r.desconto), c.desconto, 0.009);
  return {
    origem: 'leitura',
    modelo: reg.data.modelo,
    conferido: c.confiavel,
    corrigido: c.correcoes.length > 0,
    editado,
    placaConfere: placa ? placa.ok : null,
    kmCupom: reg.data.leitura.km,
    avisos: c.avisos,
  };
}

/** Lançamento que merece um olhar na conferência do cupom. */
export const cupomAConferir = (c: ConferenciaCupom) => c.origem === 'leitura' && (!c.conferido || c.editado || c.placaConfere === false);

function totais(linhas: LinhaAcompanhamento[], ciclos: Array<{ distancia: number; litros: number }>): Totais {
  const liquidos = linhas.filter((l) => l.combustivel !== 'gnv');
  const litrosLiq = soma(liquidos.map((l) => l.litros));
  const precoMedio = litrosLiq > 0 ? soma(liquidos.map((l) => l.valorPago)) / litrosLiq : null;
  const precoBombaMedio = litrosLiq > 0 ? soma(liquidos.map((l) => l.valorBruto)) / litrosLiq : null;
  const kmRodados = soma(ciclos.map((c) => c.distancia));
  const litrosCiclos = soma(ciclos.map((c) => c.litros));
  const kml = litrosCiclos > 0 ? kmRodados / litrosCiclos : null;
  return {
    quantidade: linhas.length,
    litros: soma(linhas.map((l) => l.litros)),
    valorBruto: soma(linhas.map((l) => l.valorBruto)),
    desconto: soma(linhas.map((l) => l.desconto)),
    valorPago: soma(linhas.map((l) => l.valorPago)),
    precoMedio,
    precoBombaMedio,
    kmRodados,
    kml,
    custoKm: precoMedio != null && kml ? precoMedio / kml : null,
  };
}

/** Nome do posto para agrupar ("Auto Posto Pimenta Bueno Ltda" e "AUTO POSTO PIMENTA BUENO" juntos). */
export const chavePosto = (posto: string | null) =>
  (posto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\/?A)\b\.?/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'POSTO NAO INFORMADO';

export interface FiltrosLinhas {
  /** período (YYYY-MM-DD), inclusivo */
  de: string;
  ate: string;
  combustivel?: Combustivel | null;
  posto?: string | null;
  situacao?: SituacaoFiltro;
  /** só os lançamentos deste motorista (o km/l continua usando o histórico do veículo inteiro) */
  motoristaId?: string | null;
}

/**
 * Monta o acompanhamento. `registros` = lançamentos do período + histórico anterior dos
 * mesmos veículos (para o km/l); só os do período entram nas linhas e nos totais.
 */
export function montarAcompanhamento(registros: RegistroAbastecimento[], f: FiltrosLinhas) {
  const porVeiculo = Map.groupBy(registros, (r) => r.veiculo_id);
  const kmlPorId: Record<string, number> = {};
  const anomaliaPorId: Record<string, AnomaliaConsumo> = {};
  const anteriorPorId: Record<string, number> = {};
  /** ciclos que fecham dentro do período, por veículo e por lançamento (para os totais) */
  const ciclosNoPeriodo: Array<{ id: string; veiculoId: string; distancia: number; litros: number }> = [];

  for (const [veiculoId, lista] of porVeiculo) {
    Object.assign(kmlPorId, calcularConsumo(lista).porLancamento);
    Object.assign(anomaliaPorId, detectarConsumoAnormal(lista).porLancamento);
    for (const c of ciclosConsumo(lista)) {
      if (c.data >= f.de && c.data <= f.ate) ciclosNoPeriodo.push({ id: c.id, veiculoId, distancia: c.distancia, litros: c.litros });
    }
    const ordenados = lista.toSorted((a, b) => a.km - b.km || a.data_abastecimento.localeCompare(b.data_abastecimento));
    ordenados.forEach((r, i) => {
      if (i > 0) anteriorPorId[r.id] = r.km - ordenados[i - 1]!.km;
    });
  }

  const postoFiltro = f.posto ? chavePosto(f.posto) : null;
  const linhas: LinhaAcompanhamento[] = registros
    .filter((r) => r.data_abastecimento >= f.de && r.data_abastecimento <= f.ate)
    .filter((r) => !f.combustivel || r.combustivel === f.combustivel)
    .filter((r) => !f.motoristaId || r.motorista_id === f.motoristaId)
    .filter((r) => !postoFiltro || chavePosto(r.posto).includes(postoFiltro))
    .map((r) => {
      const litros = num(r.litros);
      const valorPago = num(r.valor_total);
      const desconto = num(r.desconto);
      const valorBruto = r.valor_bruto != null ? num(r.valor_bruto) : valorPago + desconto;
      return {
        id: r.id,
        data: r.data_abastecimento,
        registradoEm: r.created_at,
        veiculoId: r.veiculo_id,
        placa: r.veiculos?.placa ?? '—',
        modelo: r.veiculos?.modelo ?? null,
        motoristaId: r.motorista_id,
        motorista: r.motoristas?.nome ?? null,
        combustivel: r.combustivel,
        km: r.km,
        kmDesdeAnterior: anteriorPorId[r.id] ?? null,
        litros,
        valorBruto,
        desconto,
        valorPago,
        precoBomba: litros > 0 ? valorBruto / litros : null,
        unitario: num(r.preco_litro),
        kml: kmlPorId[r.id] ?? null,
        anomalia: anomaliaPorId[r.id] ?? null,
        tanqueCheio: r.tanque_cheio,
        posto: r.posto,
        comprovante: r.comprovante_url,
        observacao: r.observacao,
        cupom: conferenciaDoCupom(r),
      };
    })
    .filter((l) => {
      switch (f.situacao ?? 'todos') {
        case 'consumo':
          return l.anomalia != null;
        case 'cupom':
          return cupomAConferir(l.cupom);
        case 'sem_comprovante':
          return !l.comprovante;
        case 'manual':
          return l.cupom.origem === 'manual';
        default:
          return true;
      }
    })
    .sort((a, b) => b.data.localeCompare(a.data) || b.registradoEm.localeCompare(a.registradoEm));

  const ids = new Set(linhas.map((l) => l.id));
  const ciclos = ciclosNoPeriodo.filter((c) => ids.has(c.id));

  const agrupar = (chave: (l: LinhaAcompanhamento) => string, nome: (l: LinhaAcompanhamento) => string, detalhe?: (l: LinhaAcompanhamento) => string | null) =>
    [...Map.groupBy(linhas, chave)]
      .map(([k, lista]): Agrupado => {
        const doGrupo = new Set(lista.map((l) => l.id));
        return {
          chave: k,
          nome: nome(lista[0]!),
          detalhe: detalhe?.(lista[0]!) ?? null,
          anomalias: lista.filter((l) => l.anomalia).length,
          ...totais(lista, ciclos.filter((c) => doGrupo.has(c.id))),
        };
      })
      .sort((a, b) => b.valorPago - a.valorPago);

  return {
    linhas,
    totais: totais(linhas, ciclos),
    porVeiculo: agrupar(
      (l) => l.veiculoId,
      (l) => l.placa,
      (l) => l.modelo,
    ),
    porMotorista: agrupar(
      (l) => l.motoristaId ?? 'sem',
      (l) => l.motorista ?? 'Sem motorista',
    ),
    porPosto: agrupar(
      (l) => chavePosto(l.posto),
      (l) => l.posto?.trim() || 'Posto não informado',
    ),
    aConferir: linhas.filter((l) => cupomAConferir(l.cupom)).length,
    semComprovante: linhas.filter((l) => !l.comprovante).length,
  };
}

/** Planilha (CSV com ; e vírgula decimal, como o Excel em português abre). */
export function paraCsv(linhas: LinhaAcompanhamento[]): string {
  const dec = (v: number | null, casas = 2) => (v == null ? '' : v.toFixed(casas).replace('.', ','));
  const txt = (v: string | null | undefined) => {
    const s = (v ?? '').replace(/\r?\n/g, ' ');
    return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecalho = [
    'Data', 'Registrado em', 'Placa', 'Modelo', 'Motorista', 'Combustível', 'KM', 'KM desde o anterior', 'Litros',
    'Preço bomba (R$/L)', 'Valor total (R$)', 'Desconto (R$)', 'Valor pago (R$)', 'Unitário com desconto (R$/L)', 'km/l',
    'Consumo fora do padrão', 'Tanque cheio', 'Posto', 'Origem dos valores', 'Cupom conferido', 'Placa do cupom', 'KM no cupom', 'Observação',
  ];
  const linhasCsv = linhas.map((l) =>
    [
      l.data.split('-').reverse().join('/'),
      txt(new Date(l.registradoEm).toLocaleString('pt-BR', { timeZone: 'America/Porto_Velho' })),
      txt(l.placa),
      txt(l.modelo),
      txt(l.motorista),
      txt(l.combustivel),
      String(l.km),
      l.kmDesdeAnterior == null ? '' : String(l.kmDesdeAnterior),
      dec(l.litros, 3),
      dec(l.precoBomba, 3),
      dec(l.valorBruto),
      dec(l.desconto),
      dec(l.valorPago),
      dec(l.unitario, 3),
      dec(l.kml, 1),
      l.anomalia ? `${Math.round(l.anomalia.variacao * 100)}%` : '',
      l.tanqueCheio ? 'sim' : 'parcial',
      txt(l.posto),
      l.cupom.origem === 'leitura' ? `leitura da foto${l.cupom.modelo ? ` (${l.cupom.modelo})` : ''}` : 'digitado',
      l.cupom.origem === 'leitura' ? (l.cupom.editado ? 'editado à mão' : l.cupom.conferido ? 'sim' : l.cupom.corrigido ? 'corrigido' : 'conferir') : '',
      l.cupom.placaConfere == null ? '' : l.cupom.placaConfere ? 'confere' : 'DIFERENTE',
      l.cupom.kmCupom == null ? '' : String(l.cupom.kmCupom),
      txt(l.observacao),
    ].join(';'),
  );
  // BOM: o Excel reconhece os acentos
  return `﻿${[cabecalho.join(';'), ...linhasCsv].join('\r\n')}\r\n`;
}
