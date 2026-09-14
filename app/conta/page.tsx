import { redirect } from 'next/navigation';

export default function AccountPage() {
  redirect('/organizador?view=account');
}