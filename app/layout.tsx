import type { Metadata } from 'next';
import './globals.css';
import './people.css';
import './conta/cloud.css';
import './refresh.css';
import './mobile-first.css';
import { StateProvider } from './state-provider';
import { IconoirProvider } from 'iconoir-react';
export const metadata: Metadata = { title: 'Fatura em dia', description: 'Organize sua fatura, divida as compras e acompanhe as próximas parcelas.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><IconoirProvider iconProps={{ strokeWidth: 1.7 }}><StateProvider>{children}</StateProvider></IconoirProvider></body></html>;
}
