import { redirect } from 'next/navigation';

// "My jobs" is the dashboard — keep a single canonical place for it.
export default function JobsIndex() {
  redirect('/dashboard');
}
