import {
  Building2,
  Camera,
  CarFront,
  ClipboardCheck,
  Fuel,
  LayoutDashboard,
  Receipt,
  Truck,
  UserCog,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
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
  { href: '/checklists', label: 'Checklists', icon: ClipboardCheck, papeis: GESTAO },
  { href: '/veiculos', label: 'Veículos', icon: Truck, papeis: GESTAO },
  { href: '/motoristas', label: 'Motoristas', icon: Users, papeis: GESTAO },
  { href: '/abastecimentos', label: 'Abastecimentos', curto: 'Histórico', icon: Receipt, papeis: ['admin', 'supervisor', 'motorista'] },
  { href: '/manutencoes', label: 'Manutenções', curto: 'Manutenção', icon: Wrench, papeis: GESTAO },
  { href: '/filiais', label: 'Filiais', icon: Building2, papeis: ['admin'] },
  { href: '/supervisores', label: 'Supervisores', icon: UserCog, papeis: ['admin'] },
  { href: '/perfil', label: 'Meu perfil', icon: UserRound, papeis: ['motorista'] },
];

/** Botão de destaque (câmera/bomba) e os itens fixos da barra inferior no celular. */
export const ACAO_PRINCIPAL: Record<Papel, { href: string; label: string; icon: LucideIcon }> = {
  admin: { href: '/checklists/novo', label: 'Novo checklist', icon: Camera },
  supervisor: { href: '/checklists/novo', label: 'Novo checklist', icon: Camera },
  motorista: { href: '/abastecimentos/novo', label: 'Registrar abastecimento', icon: Fuel },
};

export const BARRA_INFERIOR: Record<Papel, string[]> = {
  admin: ['/dashboard', '/veiculos', '/manutencoes'],
  supervisor: ['/dashboard', '/veiculos', '/manutencoes'],
  motorista: ['/meu-veiculo', '/abastecimentos', '/perfil'],
};

export const itensDoPapel = (papel: Papel) => NAV_ITEMS.filter((i) => i.papeis.includes(papel));
