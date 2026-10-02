import { redirect } from 'next/navigation';
import { getSession, homeDoPapel } from '@/lib/auth';

export default async function Home() {
  const session = await getSession();
  redirect(session ? homeDoPapel(session.profile.role) : '/login');
}
