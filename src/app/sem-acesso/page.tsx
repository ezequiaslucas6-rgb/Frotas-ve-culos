import type { Metadata } from 'next';
import { ShieldAlert } from 'lucide-react';
import { signOut } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Acesso não habilitado' };

export default function SemAcessoPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="items-center">
          <ShieldAlert className="size-10 text-warning" />
          <CardTitle>Acesso não habilitado</CardTitle>
          <CardDescription>
            Seu usuário existe, mas ainda não possui perfil no sistema. Peça ao Administrador Geral para habilitá-lo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full">
              Sair
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
