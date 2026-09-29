import { supabase } from '../lib/supabase'

export interface AdminUser {
  id: string
  email?: string
  name?: string
}

export async function getAdminProfile(): Promise<AdminUser | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('admins')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: user.id,
    email: user.email,
    name: user.email,
  }
}
