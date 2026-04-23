import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type SeasonPhase = 'active' | 'applaud' | 'graduation' | 'closed'

export interface HeroStats {
  productsLive:       number | null
  productsDeltaWeek:  number | null
  scoutsActive:       number | null
  scoutsDeltaWeek:    number | null
  votesCast:          number | null
  votesDeltaToday:    number | null
  graduatesIn:        { days: number; hours: number } | null
  weekNum:            number | null
  seasonPhase:        SeasonPhase | null
}

const EMPTY: HeroStats = {
  productsLive: null, productsDeltaWeek: null,
  scoutsActive: null, scoutsDeltaWeek: null,
  votesCast: null,    votesDeltaToday: null,
  graduatesIn: null,  weekNum: null, seasonPhase: null,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function useHeroStats(): HeroStats {
  const [stats, setStats] = useState<HeroStats>(EMPTY)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const now = new Date()
      const weekAgoISO = new Date(now.getTime() - 7 * DAY_MS).toISOString()
      const startOfTodayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

      const [
        productsLive, productsNewWeek,
        scoutsActive, scoutsNewWeek,
        votesTotal,   votesToday,
        seasonRes,
      ] = await Promise.all([
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('projects').select('id', { count: 'exact', head: true }).gte('created_at', weekAgoISO),
        supabase.from('members').select('id',  { count: 'exact', head: true }).gt('activity_points', 0),
        supabase.from('members').select('id',  { count: 'exact', head: true }).gte('created_at', weekAgoISO),
        supabase.from('votes').select('id',    { count: 'exact', head: true }),
        supabase.from('votes').select('id',    { count: 'exact', head: true }).gte('created_at', startOfTodayISO),
        supabase.from('seasons')
          .select('start_date, end_date, applaud_end, graduation_date, status')
          .eq('status', 'active')
          .maybeSingle(),
      ])

      if (cancelled) return

      let graduatesIn: HeroStats['graduatesIn'] = null
      let weekNum: number | null = null
      let seasonPhase: SeasonPhase | null = null

      const s = seasonRes?.data as
        | { start_date: string; end_date: string; applaud_end: string; graduation_date: string }
        | null
      if (s) {
        const start      = new Date(`${s.start_date}T00:00:00`)
        const end        = new Date(`${s.end_date}T23:59:59`)
        const applaudEnd = new Date(`${s.applaud_end}T23:59:59`)
        const gradDate   = new Date(`${s.graduation_date}T23:59:59`)

        let target: Date
        if (now < end)             { seasonPhase = 'active';     target = end }
        else if (now < applaudEnd) { seasonPhase = 'applaud';    target = applaudEnd }
        else if (now < gradDate)   { seasonPhase = 'graduation'; target = gradDate }
        else                       { seasonPhase = 'closed';     target = gradDate }

        const ms = Math.max(0, target.getTime() - now.getTime())
        graduatesIn = {
          days:  Math.floor(ms / DAY_MS),
          hours: Math.floor((ms % DAY_MS) / (60 * 60 * 1000)),
        }

        if (seasonPhase === 'active') {
          const daysIn = Math.floor((now.getTime() - start.getTime()) / DAY_MS)
          weekNum = Math.min(3, Math.max(1, Math.floor(daysIn / 7) + 1))
        }
      }

      setStats({
        productsLive:      productsLive.count      ?? null,
        productsDeltaWeek: productsNewWeek.count   ?? null,
        scoutsActive:      scoutsActive.count      ?? null,
        scoutsDeltaWeek:   scoutsNewWeek.count     ?? null,
        votesCast:         votesTotal.count        ?? null,
        votesDeltaToday:   votesToday.count        ?? null,
        graduatesIn, weekNum, seasonPhase,
      })
    }

    run().catch(err => { if (!cancelled) console.error('[heroStats]', err) })
    return () => { cancelled = true }
  }, [])

  return stats
}
