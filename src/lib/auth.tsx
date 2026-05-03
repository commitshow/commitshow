import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User, AuthError } from '@supabase/supabase-js'
import { supabase, PUBLIC_MEMBER_COLUMNS, type Member } from './supabase'

export type OAuthProvider = 'google' | 'github' | 'twitter' | 'linkedin_oidc'

type AuthState = {
  session: Session | null
  user: User | null
  member: Member | null
  loading: boolean
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signUpWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>
  signInWithGoogle: () => Promise<{ error: AuthError | null }>
  signInWithOAuth: (provider: OAuthProvider) => Promise<{ error: AuthError | null }>
  signOut: () => Promise<void>
  updateMember: (patch: Partial<Pick<Member, 'display_name' | 'avatar_url' | 'preferred_stack'>>) => Promise<{ error: string | null }>
  refreshMember: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [member, setMember] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const loadMember = async (uid: string) => {
    const { data } = await supabase
      .from('members')
      .select(PUBLIC_MEMBER_COLUMNS)
      .eq('id', uid)
      .maybeSingle()
    setMember(data as Member | null)
  }

  useEffect(() => {
    if (!session?.user) {
      setMember(null)
      return
    }
    loadMember(session.user.id)
  }, [session?.user?.id])

  // Sync OAuth identity providers → members.{x,github}_handle whenever the
  // auth user's identity list includes a recognized provider row. Covers
  // (1) signup via that provider, (2) linking from VerifiedIdentities. RPC
  // is idempotent — calling on every session change keeps the denormalized
  // handles fresh if the user later renames on the provider's side.
  useEffect(() => {
    if (!session?.user) return
    const providers = new Set((session.user.identities ?? []).map(i => i.provider))
    let mounted = true

    const syncProvider = async (
      provider: 'twitter' | 'github' | 'linkedin_oidc',
      rpc: 'sync_x_identity' | 'sync_github_identity' | 'sync_linkedin_identity',
    ) => {
      if (!providers.has(provider)) return false
      const { error } = await supabase.rpc(rpc, { p_user_id: session.user.id })
      if (error) {
        console.warn(`[auth] ${rpc} failed`, error.message)
        return false
      }
      return true
    }

    Promise.all([
      syncProvider('twitter',       'sync_x_identity'),
      syncProvider('github',        'sync_github_identity'),
      syncProvider('linkedin_oidc', 'sync_linkedin_identity'),
    ]).then(results => {
      if (!mounted) return
      // If anything synced, refresh the member row so the UI sees the new
      // handles. One refetch per session-change covers all providers.
      if (results.some(Boolean)) loadMember(session.user.id)
    })

    return () => { mounted = false }
  }, [session?.user?.id, (session?.user?.identities ?? []).length])

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    member,
    loading,
    signInWithEmail: (email, password) =>
      supabase.auth.signInWithPassword({ email, password }).then(r => ({ error: r.error })),
    signUpWithEmail: (email, password) =>
      supabase.auth.signUp({ email, password }).then(r => ({ error: r.error })),
    signInWithGoogle: () =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      }).then(r => ({ error: r.error })),
    signInWithOAuth: (provider) =>
      supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      }).then(r => ({ error: r.error })),
    signOut: async () => { await supabase.auth.signOut() },
    updateMember: async (patch) => {
      if (!session?.user?.id) return { error: 'Not signed in' }
      const { error, data } = await supabase
        .from('members')
        .update(patch)
        .eq('id', session.user.id)
        .select(PUBLIC_MEMBER_COLUMNS)
        .single()
      if (error) return { error: error.message }
      setMember(data as unknown as Member)
      return { error: null }
    },
    refreshMember: async () => {
      if (session?.user?.id) await loadMember(session.user.id)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
