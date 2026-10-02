'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatCnh, formatCpf, formatWhatsapp, normalizePlaca } from '@/lib/validators/documentos';

const MASKS = {
  cpf: { format: formatCpf, inputMode: 'numeric', placeholder: '000.000.000-00', autoComplete: 'off' },
  whatsapp: { format: formatWhatsapp, inputMode: 'tel', placeholder: '(11) 99999-9999', autoComplete: 'tel-national' },
  cnh: { format: formatCnh, inputMode: 'numeric', placeholder: '00000000000', autoComplete: 'off' },
  placa: { format: (v: string) => normalizePlaca(v).slice(0, 7), inputMode: 'text', placeholder: 'ABC1D23', autoComplete: 'off' },
} as const;

type MaskName = keyof typeof MASKS;

interface MaskedInputProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange'> {
  mask: MaskName;
  defaultValue?: string;
}

/** Input com máscara progressiva (CPF, WhatsApp, CNH, placa). O servidor revalida e normaliza. */
export function MaskedInput({ mask, defaultValue = '', ...props }: MaskedInputProps) {
  const cfg = MASKS[mask];
  const [value, setValue] = useState(() => cfg.format(defaultValue));
  return (
    <Input
      {...props}
      value={value}
      onChange={(e) => setValue(cfg.format(e.target.value))}
      inputMode={cfg.inputMode}
      placeholder={cfg.placeholder}
      autoComplete={cfg.autoComplete}
      className={mask === 'placa' ? 'uppercase' : undefined}
    />
  );
}
