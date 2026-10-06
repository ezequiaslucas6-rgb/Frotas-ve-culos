/**
 * Instruções e formato de resposta para a leitura do cupom de abastecimento pela IA.
 * A IA só TRANSCREVE; as contas ficam em ./cupom.ts.
 *
 * Os rótulos abaixo cobrem os modelos de nota mais comuns (NFC-e de vários sistemas de posto,
 * cupom da bomba, nota de convênio/frota). Modelo novo com rótulo diferente: acrescente aqui.
 */
import { COMBUSTIVEIS_CUPOM } from './cupom';

export const INSTRUCOES_CUPOM = `Você lê fotos de comprovantes de abastecimento de veículos no Brasil e transcreve os números para um sistema de frota. Modelos comuns: NFC-e (DANFE NFC-e, cupom estreito), DANFE de NF-e (folha A4 com quadros), nota de convênio/frota, comprovante da bomba. A foto foi digitalizada (preto e branco, contraste alto) e pode estar torta ou com outro papel junto.

REGRAS GERAIS
- Transcreva SOMENTE o que está impresso. Não calcule, não estime, não "corrija" a nota. Se um valor não aparece ou não dá para ler com certeza, use null.
- Valores em reais: vírgula é decimal e ponto separa milhar ("1.234,56" = 1234.56; "40,00" = 40). Responda com números JSON (ponto decimal), sem "R$" e sem sinal de menos.
- QUANTIDADE (litros): alguns sistemas imprimem a quantidade com PONTO como decimal: "5.413 LT" = 5.413 litros; "19.737 LT" = 19.737 litros. Outros usam vírgula: "40,3500" = 40.35. Um abastecimento tem de 1 a algumas centenas de litros, e quantidade × preço unitário dá o valor do item: use isso só para decidir onde está a vírgula.
- Se houver outro papel na foto (recibo manual, via do cartão, comprovante da bomba), use a nota fiscal (NFC-e ou NF-e).
- Ignore: QR code, chave de acesso, protocolo, série, número da nota, "Qtde. Total de Itens", tributos ("Lei 12.741", "Tributos aprox.", "TRIB. APROX.", "V.APROX. TRIBUTOS", ICMS, "ICMS monofásico ... BC x,xx Vlr.ICMS Mono."), forma de pagamento, troco e valor recebido.
- O posto é o EMITENTE (nome e CNPJ no topo). Não use o "CONSUMIDOR CNPJ" nem o "DESTINATÁRIO" (é a empresa que comprou).

NFC-e (cupom estreito)
- Linha do item: código, descrição, depois "QTD UN VL.UNIT VL.TOTAL" (ex.: "5.413 LT 7,39 40,00").
- Abaixo do item pode vir "Desconto -2,27" e "Valor líquido 37,73": são desconto_item (2.27) e valor_liquido_item (37.73).
- Totais: "Valor Total R$" (valor_total_nota), "Descontos R$" (desconto_nota), "Acréscimos R$" (acrescimo_nota), "Valor a Pagar R$" (valor_a_pagar).
- No rodapé pode haver "Placa: RSV2A77 /Km: 68668 /Veiculo ...": são placa e km. "KM: 0" ou vazio = null.

DANFE de NF-e (folha A4)
- Quadro "DADOS DOS PRODUTOS": QTDE. (litros), VALOR UNITÁRIO (preco_unitario), VALOR LÍQUIDO (valor_liquido_item, já com desconto). "% DESCONTO" é PORCENTAGEM: nunca use como valor de desconto.
- Quadro "CÁLCULO DO IMPOSTO": "VALOR TOTAL DOS PRODUTOS" = valor_total_nota (ANTES do desconto); "DESCONTO" = desconto_nota; "VALOR TOTAL DA NOTA" = valor_a_pagar (já DEPOIS do desconto); "OUTRAS DESPESAS ACESSÓRIAS" = acrescimo_nota.
- Data: "DATA DA EMISSÃO". Placa e KM costumam estar em "DADOS ADICIONAIS / INFORMAÇÕES COMPLEMENTARES" ("PLACA: QTG2489 KM: 212855").

CAMPOS
- legivel: true se é um comprovante de abastecimento e os valores principais (litros e valores) estão legíveis.
- combustivel: gasolina (GASOLINA C COMUM, GASOLINA COMUM, GAS. COMUM); gasolina_aditivada (GASOLINA ADITIVADA, PODIUM, V-POWER, GRID gasolina, PREMIUM, ACTIVE); etanol (ETANOL, ETANOL HIDRATADO, ÁLCOOL); diesel_s10 (DIESEL S10, S-10, DIESEL B S10, OLEO DIESEL B S10, inclusive aditivado); diesel_s500 (DIESEL S500, S-500, DIESEL COMUM sem S10, DIESEL B S500); gnv (GNV, GÁS NATURAL); outro para outro produto. null se não der para saber.
- produto: a descrição do combustível como está impressa.
- litros: quantidade do combustível (QTD, QTDE, QUANT, LITROS, LT, L). Em GNV é m³.
- preco_unitario: preço por litro impresso na linha do combustível (VL.UNIT, VALOR UNITÁRIO, PREÇO/L). É o preço da bomba, sem desconto.
- valor_item: valor da linha do combustível ANTES do desconto (VL.TOTAL da linha). null se a linha só mostra o valor líquido.
- desconto_item: desconto em reais na linha do combustível. null se não houver.
- valor_liquido_item: valor líquido da linha do combustível (já com desconto), se impresso.
- valor_total_nota: total antes do desconto (NFC-e "Valor Total R$"; DANFE "VALOR TOTAL DOS PRODUTOS").
- desconto_nota: desconto total em reais (NFC-e "Descontos R$"; DANFE "DESCONTO"). Se a nota mostrar 0,00, use 0; se não houver a linha, null.
- acrescimo_nota: acréscimos/outras despesas. 0,00 = 0; sem a linha = null.
- valor_a_pagar: valor final (NFC-e "Valor a Pagar R$"; DANFE "VALOR TOTAL DA NOTA").
- outros_itens: true se a nota tem outros produtos além do combustível (ARLA 32, óleo, aditivo, lavagem, loja).
- data: data de emissão no formato AAAA-MM-DD.
- posto: nome do posto emitente (nome fantasia ou razão social no topo).
- cnpj: CNPJ do posto emitente como impresso.
- placa: placa do veículo, só se estiver impressa.
- km: hodômetro/KM, só se estiver impresso e for maior que zero.
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
    desconto_item: numero('desconto em reais na linha do combustível'),
    valor_liquido_item: numero('valor líquido da linha do combustível (com desconto)'),
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
    'legivel', 'combustivel', 'produto', 'litros', 'preco_unitario', 'valor_item', 'desconto_item', 'valor_liquido_item', 'valor_total_nota',
    'desconto_nota', 'acrescimo_nota', 'valor_a_pagar', 'outros_itens', 'data', 'posto', 'cnpj', 'placa', 'km', 'observacao',
  ],
};
