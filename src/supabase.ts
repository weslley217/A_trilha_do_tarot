import { createClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://hmqznjjfzllkxeqqjrzm.supabase.co';
const fallbackAnonKey = 'sb_publishable_iqgn7xc6giRLAFEKiDfnHA_rzkErpeH';

const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const envAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isUsingSupabaseFallback = !envUrl || !envAnonKey;
export const supabaseUrl = envUrl || fallbackUrl;
export const supabaseAnonKey = envAnonKey || fallbackAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

