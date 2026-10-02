import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // build autocontido (node server.js) para rodar em Docker na VPS
  output: 'standalone',
  experimental: {
    // Checklists enviam apenas metadados (as fotos vão direto ao Storage),
    // então o limite padrão de 1MB das Server Actions é suficiente.
    serverActions: { bodySizeLimit: '1mb' },
    // Telas já abertas (ou pré-carregadas ao passar o mouse/encostar o dedo no menu)
    // abrem instantaneamente por 30 s, sem ir ao servidor. Toda gravação (Server
    // Action com revalidatePath) descarta esse cache na hora.
    staleTimes: { dynamic: 30, static: 30 },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Câmera liberada para o próprio site (necessária para o checklist).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
