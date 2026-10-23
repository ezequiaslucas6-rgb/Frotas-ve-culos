/**
 * Referência do KM no lançamento de abastecimento: o ÚLTIMO ABASTECIMENTO do veículo, não o KM do
 * veículo (que também sobe com checklists e manutenções). O consumo (km/l) sai só dos
 * abastecimentos, e comparar com o KM de um checklist acusava "KM menor que o último registrado"
 * sem estar errado. Só um veículo SEM abastecimento anterior usa o KM do veículo como ponto de partida.
 * Funções puras.
 */
export interface UltimoAbastecimento {
  km: number;
  /** data do abastecimento (YYYY-MM-DD) */
  data: string;
}

export interface ReferenciaKm {
  km: number;
  origem: 'abastecimento' | 'veiculo';
  /** data do último abastecimento (só quando a origem é o abastecimento) */
  data: string | null;
}

export function referenciaDoKm(ultimo: UltimoAbastecimento | null, kmVeiculo: number): ReferenciaKm {
  return ultimo ? { km: ultimo.km, origem: 'abastecimento', data: ultimo.data } : { km: kmVeiculo, origem: 'veiculo', data: null };
}

/**
 * Hodômetro menor que a referência só é aceito em lançamento retroativo (dia anterior ou antes).
 * Devolve o motivo da recusa ou null.
 */
export function kmAbaixoDaReferencia(km: number, dataAbastecimento: string, hoje: string, ref: ReferenciaKm): boolean {
  return km < ref.km && dataAbastecimento >= hoje;
}
