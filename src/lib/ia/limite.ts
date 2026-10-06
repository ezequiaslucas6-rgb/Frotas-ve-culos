/**
 * Limite de uso por usuário, em memória (um processo só, como na VPS). Protege a cota
 * gratuita do Gemini de cliques repetidos ou de um celular em laço.
 */
export function criarLimitador({ porMinuto, porDia }: { porMinuto: number; porDia: number }) {
  const usos = new Map<string, number[]>();
  return {
    /** registra o uso e diz se ainda está dentro do limite */
    permitir(chave: string, agora = Date.now()): boolean {
      const doDia = (usos.get(chave) ?? []).filter((t) => agora - t < 86_400_000);
      const doMinuto = doDia.filter((t) => agora - t < 60_000).length;
      if (doMinuto >= porMinuto || doDia.length >= porDia) {
        usos.set(chave, doDia);
        return false;
      }
      doDia.push(agora);
      usos.set(chave, doDia);
      return true;
    },
  };
}

/** Guarda resultados por um tempo (a mesma foto não é lida duas vezes). */
export function criarCache<T>({ validadeMs, maximo }: { validadeMs: number; maximo: number }) {
  const itens = new Map<string, { valor: T; em: number }>();
  return {
    ler(chave: string, agora = Date.now()): T | undefined {
      const item = itens.get(chave);
      if (!item) return undefined;
      if (agora - item.em > validadeMs) {
        itens.delete(chave);
        return undefined;
      }
      return item.valor;
    },
    guardar(chave: string, valor: T, agora = Date.now()) {
      if (itens.size >= maximo) itens.delete(itens.keys().next().value as string); // sai o mais antigo
      itens.set(chave, { valor, em: agora });
    },
  };
}
