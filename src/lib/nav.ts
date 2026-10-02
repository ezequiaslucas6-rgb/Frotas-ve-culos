import { Building2, ClipboardCheck, LayoutDashboard, Truck, UserCog, Users, Wrench, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { href: '/checklists', label: 'Checklists', icon: ClipboardCheck },
  { href: '/veiculos', label: 'Veículos', icon: Truck },
  { href: '/motoristas', label: 'Motoristas', icon: Users },
  { href: '/manutencoes', label: 'Manutenções', icon: Wrench },
  { href: '/filiais', label: 'Filiais', icon: Building2, adminOnly: true },
  { href: '/supervisores', label: 'Supervisores', icon: UserCog, adminOnly: true },
];

/** Itens fixos da barra inferior no celular (o resto fica no menu). */
export const BOTTOM_NAV_HREFS = ['/dashboard', '/checklists', '/veiculos', '/manutencoes'];
