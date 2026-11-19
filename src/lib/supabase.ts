import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR_PROJECT'));
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      db: { schema: 'public' },
    })
  : null;

export type Role = 'admin' | 'teacher' | 'supervisor' | 'student' | 'parent';
export type AccountStatus = 'active' | 'pending' | 'rejected' | 'suspended';
export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: AccountStatus;
  avatar_url?: string | null;
};
