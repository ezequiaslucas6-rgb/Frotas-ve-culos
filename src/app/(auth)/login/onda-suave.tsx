/**
 * Fundo da tela de login: a paleta da marca (roxo → azul → verde) mesclada em ondas suaves.
 *
 * Cada faixa é uma região limitada por uma curva ondulada; o desfoque mistura as cores sem
 * linhas retas. O roxo fica embaixo à esquerda (onde estão os textos, para leitura em branco)
 * e o verde no canto de cima à direita. SVG estático: desenhado uma vez, sem animação.
 */
export function OndaSuave({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <filter id="onda-mescla" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="55" />
        </filter>
      </defs>

      <g filter="url(#onda-mescla)">
        {/* as formas passam da borda: o desfoque não clareia os cantos */}
        <rect x="-300" y="-300" width="1400" height="1600" fill="#4e42d1" />
        <path d="M-300 620 C 0 520, 140 760, 380 820 S 700 1000, 820 1300 L 1100 1300 L 1100 -300 L -300 -300 Z" fill="#4870d0" />
        <path d="M-300 150 C 60 90, 200 320, 440 400 S 780 480, 1100 760 L 1100 -300 L -300 -300 Z" fill="#3fa0ce" />
        <path d="M260 -300 C 330 20, 480 80, 600 240 S 860 380, 1100 440 L 1100 -300 Z" fill="#68c894" />
        <path d="M560 -300 C 640 -40, 720 40, 780 120 S 960 200, 1100 200 L 1100 -300 Z" fill="#8cef5c" />
      </g>

      {/* linhas de onda discretas acompanhando a mescla */}
      <g fill="none" stroke="#ffffff" strokeLinecap="round">
        <path d="M-40 190 C 120 130, 260 360, 460 430 S 780 520, 860 600" strokeOpacity="0.16" strokeWidth="2" />
        <path d="M-40 250 C 140 190, 270 430, 480 500 S 780 590, 860 690" strokeOpacity="0.1" strokeWidth="2" />
        <path d="M240 -40 C 330 90, 480 160, 600 290 S 800 410, 860 430" strokeOpacity="0.14" strokeWidth="2" />
      </g>
    </svg>
  );
}
