/**
 * CPF, WhatsApp e CNH do motorista são obrigatórios? Desligado na fase de testes: a empresa
 * ainda não quer cadastrar dados reais. Para religar: MOTORISTA_DADOS_OBRIGATORIOS=1 no .env
 * do servidor (só o servidor lê; o formulário recebe o valor da página).
 */
export const dadosPessoaisObrigatorios = () => process.env.MOTORISTA_DADOS_OBRIGATORIOS?.trim() === '1';
