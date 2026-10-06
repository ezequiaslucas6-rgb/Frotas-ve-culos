import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireAdmin } from '@/lib/auth';
import { iaConfigurada, modelosGemini } from '@/lib/ia/gemini';
import { TestadorCupons } from './testador-cupons';

export const metadata: Metadata = { title: 'Testar leitura de cupons' };

export default async function TestarLeituraPage() {
  await requireAdmin();
  const ligada = iaConfigurada();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Testar leitura de cupons"
        description="Envie fotos de modelos de nota para ver o que a leitura automática entende. Nada é lançado e as fotos são apagadas depois."
        actions={
          <Link href="/abastecimentos" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft /> Abastecimentos
          </Link>
        }
      />
      {ligada ? (
        <TestadorCupons modelos={modelosGemini()} />
      ) : (
        <Card>
          <CardContent className="flex items-start gap-3 text-sm">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-icone" />
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold">A leitura automática está desligada</p>
              <p className="text-muted-foreground">
                Crie uma chave gratuita em aistudio.google.com/apikey, coloque em <code>GEMINI_API_KEY</code> no arquivo{' '}
                <code>/opt/frotas/.env</code> da VPS e rode o instalador de novo (<code>bash /opt/frotas/deploy/instalar-vps.sh</code>).
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
