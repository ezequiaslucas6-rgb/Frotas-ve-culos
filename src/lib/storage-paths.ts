/** Miniatura gerada no upload ao lado da imagem: foto-<id>.jpg -> foto-<id>.mini.jpg */
export const caminhoMiniatura = (path: string) => path.replace(/\.[a-z0-9]+$/i, '.mini.jpg');
