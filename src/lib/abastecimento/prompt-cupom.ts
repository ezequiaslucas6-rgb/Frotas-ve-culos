/**
 * Instruções e formato de resposta para a leitura do cupom de abastecimento pela IA.
 * A IA só TRANSCREVE; as contas ficam em ./cupom.ts.
 *
 * Os rótulos abaixo cobrem os modelos de nota mais comuns (NFC-e de vários sistemas de posto,
 * cupom da bomba, nota de convênio/frota). Modelo novo com rótulo diferente: acrescente aqui.
 */
import { COMBUSTIVEIS_CUPOM } from './cupom';

export const INSTRUCOES_CUPOM = `Você lê fotos de comprovantes de abastecimento de veículos no Brasil: NFC-e (DANFE NFC-e), cupom fiscal, nota de convênio/frota, comprovante da bomba ou do cartão. A foto foi digitalizada (preto e branco, contraste alto) e pode estar um pouco torta.

REGRAS
- Transcreva SOMENTE números impressos. Não calcule, não estime, não "corrija" a nota. Se um valor não aparece ou não dá para ler com certeza, use null.
- Números brasileiros: vírgula é decimal e ponto separa milhar ("1.234,56" = 1234.56; "45,320" L = 45.32; "6,190" = 6.19). Responda com números JSON (ponto decimal), sem "R$".
- Há cupons com dois blocos (comprovante da bomba + NFC-e): use os valores da NFC-e.
- Ignore: QR code, chave de acesso, protocolo, série, CPF do consumidor, tributos ("Lei 12.741", "Tributos aprox.", "Valor aprox. dos tributos", ICMS), troco e o valor recebido em dinheiro/cartão (forma de pagamento).

CAMPOS
- legivel: true se é um comprovante de abastecimento e os valores principais (litros e valores) estão legíveis.
- combustivel: gasolina (GASOLINA C COMUM, GAS. COMUM, GASOLINA COMUM); gasolina_aditivada (ADITIVADA, PODIUM, V-POWER, GRID, PREMIUM, ACTIVE); etanol (ETANOL, ETANOL HIDRATADO, ÁLCOOL, ALCOOL); diesel_s10 (DIESEL S10, S-10, DIESEL B S10, OLEO DIESEL B S10); diesel_s500 (DIESEL S500, S-500, DIESEL COMUM, DIESEL B S500); gnv (GNV, GÁS NATURAL); outro para qualquer outro produto. null se não der para saber.
- produto: a descrição do combustível como está impressa.
- litros: quantidade do combustível (QTDE, QTD, QUANT, QUANTIDADE, LITROS, LT, L). Em GNV é m³.
- preco_unitario: preço por litro impresso na linha do combustível (VL. UNIT, VL UNIT, VALOR UNIT., UNITÁRIO, PREÇO/L, R$/L). É o preço da bomba, sem desconto.
- valor_item: valor da linha do combustível antes do desconto (VL. TOTAL, VL ITEM, VALOR, TOTAL do item).
- desconto_item: desconto escrito na própria linha do combustível (DESC, DESCONTO ITEM, VL DESC do item). null se não houver.
- valor_total_nota: total da nota antes do desconto (VALOR TOTAL R$, TOTAL R$, VL TOTAL, VALOR TOTAL DOS PRODUTOS, SUBTOTAL).
- desconto_nota: desconto total da nota (DESCONTO R$, DESCONTOS, DESC. TOTAL, VALOR DESCONTO). Se a nota mostrar desconto 0,00, use 0; se não houver a linha, null.
- acrescimo_nota: acréscimos/outras despesas (ACRÉSCIMO, OUTRAS DESPESAS). null se não houver.
- valor_a_pagar: valor final da nota (VALOR A PAGAR R$, TOTAL A PAGAR, VALOR PAGO, TOTAL LÍQUIDO, VALOR LÍQUIDO).
- outros_itens: true se a nota tem outros produtos além do combustível (ARLA 32, óleo, aditivo, lavagem, loja).
- data: data de emissão no formato AAAA-MM-DD.
- posto: nome do posto (nome fantasia ou razão social no topo).
- cnpj: CNPJ do posto como impresso.
- placa: placa do veículo, só se estiver impressa (notas de convênio).
- km: hodômetro/KM, só se estiver impresso.
- observacao: em poucas palavras, o que ficou duvidoso (ex.: "desconto ilegível", "foto cortada embaixo"); null se nada.`;

const numero = (description: string) => ({ type: 'NUMBER', nullable: true, description });
const texto = (description: string) => ({ type: 'STRING', nullable: true, description });

/** Formato da resposta (subconjunto OpenAPI aceito pelo Gemini). */
export const SCHEMA_CUPOM = {
  type: 'OBJECT',
  properties: {
    legivel: { type: 'BOOLEAN', description: 'é um comprovante de abastecimento legível' },
    combustivel: { type: 'STRING', nullable: true, enum: [...COMBUSTIVEIS_CUPOM] },
    produto: texto('descrição do combustível como impressa'),
    litros: numero('quantidade de combustível'),
    preco_unitario: numero('preço por litro impresso (bomba)'),
    valor_item: numero('valor da linha do combustível antes do desconto'),
    desconto_item: numero('desconto na linha do combustível'),
    valor_total_nota: numero('total da nota antes do desconto'),
    desconto_nota: numero('desconto total da nota'),
    acrescimo_nota: numero('acréscimos da nota'),
    valor_a_pagar: numero('valor a pagar da nota'),
    outros_itens: { type: 'BOOLEAN', description: 'há outros produtos além do combustível' },
    data: texto('data de emissão AAAA-MM-DD'),
    posto: texto('nome do posto'),
    cnpj: texto('CNPJ do posto'),
    placa: texto('placa, se impressa'),
    km: { type: 'INTEGER', nullable: true, description: 'hodômetro, se impresso' },
    observacao: texto('o que ficou duvidoso'),
  },
  required: [
    'legivel', 'combustivel', 'produto', 'litros', 'preco_unitario', 'valor_item', 'desconto_item', 'valor_total_nota',
    'desconto_nota', 'acrescimo_nota', 'valor_a_pagar', 'outros_itens', 'data', 'posto', 'cnpj', 'placa', 'km', 'observacao',
  ],
};
