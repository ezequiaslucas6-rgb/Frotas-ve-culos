import {
  Building2,
  CalendarCheck,
  Camera,
  CarFront,
  ClipboardCheck,
  LayoutDashboard,
  Truck,
  UserCog,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { BombaCombustivel } from '@/components/icones/bomba-combustivel';
import type { Tables } from '@/types/database';

type Papel = Tables<'profiles'>['role'];

export interface NavItem {
  href: string;
  label: string;
  /** rótulo da barra inferior do celular, quando o principal não cabe */
  curto?: string;
  icon: LucideIcon;
  /** papéis que enxergam o item */
  papeis: Papel[];
}

const GESTAO: Papel[] = ['admin', 'supervisor'];

export const NAV_ITEMS: NavItem[] = [
  { href: '/meu-veiculo', label: 'Meu veículo', icon: CarFront, papeis: ['motorista'] },
  { href: '/dashboard', label: 'Painel', icon: LayoutDashboard, papeis: GESTAO },
  { href: '/checklists/hoje', label: 'Checklist de hoje', curto: 'Hoje', icon: CalendarCheck, papeis: GESTAO },
  { href: '/checklists', label: 'Checklists', icon: ClipboardCheck, papeis: ['admin', 'supervisor', 'motorista'] },
  { href: '/veiculos', label: 'Veículos', icon: Truck, papeis: GESTAO },
  { href: '/motoristas', label: 'Motoristas', icon: Users, papeis: GESTAO },
  { href: '/abastecimentos', label: 'Abastecimentos', curto: 'Histórico', icon: BombaCombustivel, papeis: ['admin', 'supervisor', 'motorista'] },
  { href: '/manutencoes', label: 'Manutenções', curto: 'Manutenção', icon: Wrench, papeis: GESTAO },
  { href: '/filiais', label: 'Filiais', icon: Building2, papeis: ['admin'] },
  { href: '/supervisores', label: 'Supervisores', icon: UserCog, papeis: ['admin'] },
  { href: '/perfil', label: 'Meu perfil', icon: UserRound, papeis: ['motorista'] },
];

/** Botão de destaque (câmera) e os itens fixos da barra inferior no celular. */
export const ACAO_PRINCIPAL: Record<Papel, { href: string; label: string; icon: LucideIcon }> = {
  admin: { href: '/checklists/novo', label: 'Novo checklist', icon: Camera },
  supervisor: { href: '/checklists/novo', label: 'Novo checklist', icon: Camera },
  motorista: { href: '/checklists/novo', label: 'Novo checklist', icon: Camera },
};

export const BARRA_INFERIOR: Record<Papel, string[]> = {
  admin: ['/dashboard', '/veiculos', '/manutencoes'],
  supervisor: ['/dashboard', '/veiculos', '/manutencoes'],
  motorista: ['/meu-veiculo', '/abastecimentos', '/perfil'],
};

export const itensDoPapel = (papel: Papel) => NAV_ITEMS.filter((i) => i.papeis.includes(papel));
