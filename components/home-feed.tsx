"use client"

import { useState, useCallback, useEffect } from "react"
import { useAuth } from "@/lib/authContext"
import { Loader2, Play } from "lucide-react"
import RecommendationSection from "@/components/recommendation-section"
import { MediaItem, UserProfile } from "@/types/database"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getAllUsers, getUserProfile } from "@/lib/firebase/firestore"
import ChatbotLauncher from "@/components/ChatbotLauncher"
import Onboarding from "@/components/onboarding"
import Image from "next/image"

// Persist hero across navigations
let cachedHero: MediaItem | null = null

export default function HomeFeed() {
  const { user, loading } = useAuth()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(true)
  const [isNewUser, setIsNewUser] = useState(false)
  const [hero, setHero] = useState<MediaItem | null>(cachedHero)
  const [activeTab, setActiveTab] = useState<"recs" | "community">("recs")
  const router = useRouter()

  useEffect(() => {
    getAllUsers().then(setUsers).catch(() => {}).finally(() => setIsLoadingUsers(false))
  }, [])

  useEffect(() => {
    if (!user) return
    getUserProfile(user.uid).then(profile => {
      if (!profile || (profile.stats?.totalRatings ?? 0) === 0) setIsNewUser(true)
    }).catch(() => {})
  }, [user])

  const onRecsLoaded = useCallback((items: MediaItem[]) => {
    if (!hero) {
      const good = items.filter(i => (i.backdropImage || i.coverImage) && i.description && i.description.length > 50)
      if (good.length > 0) {
        cachedHero = good[0]
        setHero(good[0])
      }
    }
  }, [hero])

  if (loading) return <div className="h-[60vh] flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  if (isNewUser) return <Onboarding displayName={user?.displayName} onComplete={() => setIsNewUser(false)} />

  return (
    <div className="min-h-screen">
      {/* ── Hero ── */}
      {hero && (hero.backdropImage || hero.coverImage) ? (
        <div className="relative w-full h-[420px] sm:h-[480px] overflow-hidden cursor-pointer"
          onClick={() => router.push(`/media/${hero.id}`)}>
          <Image src={hero.backdropImage || hero.coverImage!} alt="" fill
            className={`object-cover ${hero.backdropImage ? '' : 'blur-sm scale-105'}`}
            style={{ filter: 'var(--backdrop-brightness)' }}
            priority />
          {/* Bottom fade */}
          <div className="absolute bottom-0 left-0 right-0 h-48" style={{ background: 'linear-gradient(to top, hsl(var(--background)), transparent)' }} />

          <div className="absolute inset-0 flex items-end">
            <div className="max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 pb-12 flex gap-6 items-end">
              {/* Poster */}
              <div className="relative w-[140px] sm:w-[160px] aspect-[2/3] rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/10 shrink-0 hidden sm:block">
                <Image src={hero.coverImage || "/placeholder.jpg"} alt={hero.title} fill className="object-cover" />
              </div>
              {/* Info */}
              <div className="space-y-3 max-w-xl">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Featured for you</p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">{hero.title}</h2>
                {hero.description && (
                  <p className="text-sm text-white/60 line-clamp-2 leading-relaxed">{hero.description}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {hero.genres?.slice(0, 3).map(g => (
                    <Badge key={g} variant="secondary" className="bg-white/10 text-white/70 border-0 text-[11px]">{g}</Badge>
                  ))}
                  {hero.year && <span className="text-[11px] text-white/40">{hero.year}</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Minimal header when no hero */
        <div className="pt-10 pb-6 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}
          </h1>
        </div>
      )}

      {/* ── Content ── */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border">
          <button onClick={() => setActiveTab("recs")}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
              ${activeTab === "recs" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            Recommendations
          </button>
          <button onClick={() => setActiveTab("community")}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
              ${activeTab === "community" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            Community
          </button>
        </div>

        {activeTab === "recs" ? (
          <div className="space-y-12">
            <RecommendationSection title="For You" description="Personalized picks based on your taste" type="for_you" onLoad={onRecsLoaded} />
            <RecommendationSection title="People Love" description="Highly rated favorites from the community" type="popular" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {isLoadingUsers ? (
              Array(8).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
                  <div className="h-10 w-10 rounded-full shimmer" />
                  <div className="space-y-1.5 flex-1"><div className="h-3.5 w-2/3 rounded shimmer" /><div className="h-3 w-1/3 rounded shimmer" /></div>
                </div>
              ))
            ) : users.length === 0 ? (
              <p className="col-span-full text-center py-20 text-sm text-muted-foreground">No users yet</p>
            ) : users.map((u) => (
              <div key={u.uid}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => router.push(`/profile/${u.uid}`)}>
                <Avatar className="h-10 w-10">
                  <AvatarImage src={u.photoURL || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-sm">{u.displayName?.charAt(0) || "U"}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{u.displayName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {u.stats?.totalRatings || 0} ratings{u.stats?.averageRating ? ` · ${u.stats.averageRating.toFixed(1)} avg` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ChatbotLauncher />
    </div>
  )
}
