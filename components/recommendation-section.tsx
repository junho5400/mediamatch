"use client"

import { useEffect, useState, useRef } from "react"
import { useAuth } from "@/lib/authContext"
import { auth } from "@/lib/firebase/firebase"
import MediaCard from "@/components/media-card"
import { Button } from "@/components/ui/button"
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react"
import { MediaItem } from "@/types/database"

// Client-side cache that survives component unmount/remount (but not full page reload)
const clientCache = new Map<string, { items: MediaItem[], timestamp: number }>()
const CLIENT_CACHE_TTL = 60 * 60 * 1000  // 1 hour

interface RecommendationSectionProps {
  title: string
  description: string
  type: "for_you" | "popular"
  onLoad?: (items: MediaItem[]) => void
}

export default function RecommendationSection({ title, description, type, onLoad }: RecommendationSectionProps) {
  const { user, loading: authLoading } = useAuth()
  const [recommendations, setRecommendations] = useState<MediaItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const hasFetchedRef = useRef<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchRecommendations = async (refresh = false) => {
    if (!user) return

    // Check client cache (unless refreshing)
    if (!refresh) {
      const cached = clientCache.get(`${user.uid}:${type}`)
      if (cached && Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
        setRecommendations(cached.items)
        setIsLoading(false)
        hasFetchedRef.current[type] = true
        onLoad?.(cached.items)
        return
      }
    }

    setIsLoading(true); setError(false)
    try {
      const token = await auth.currentUser?.getIdToken()
      const url = `/api/recommendations?type=${type}&userId=${user.uid}${refresh ? "&refresh=1" : ""}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRecommendations(data)
      hasFetchedRef.current[type] = true
      onLoad?.(data)
      // Save to client cache
      clientCache.set(`${user.uid}:${type}`, { items: data, timestamp: Date.now() })
    } catch { setError(true) }
    finally { setIsLoading(false) }
  }

  useEffect(() => {
    if (authLoading || !user || hasFetchedRef.current[type]) return
    fetchRecommendations()
  }, [user, authLoading, type])

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -500 : 500, behavior: "smooth" })
  }

  // Skeleton
  const SkeletonCard = () => (
    <div className="w-[154px] shrink-0">
      <div className="aspect-[2/3] w-full rounded-lg shimmer" />
      <div className="mt-2 space-y-1"><div className="h-3.5 w-3/4 rounded shimmer" /><div className="h-3 w-1/2 rounded shimmer" /></div>
    </div>
  )


  // ── Carousel layout (used for both sections) ──
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-0.5">
          {recommendations.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => fetchRecommendations(true)} disabled={isLoading}
              className="text-xs text-muted-foreground h-7 px-2">
              <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />Refresh
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => scroll("left")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => scroll("right")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
        <div ref={scrollRef}
          className="flex gap-3 overflow-x-auto py-3 carousel-mask"
          style={{ scrollbarWidth: "none" }}>
          {isLoading || authLoading
            ? Array(8).fill(0).map((_, i) => <SkeletonCard key={i} />)
            : error
              ? <div className="w-full py-12 text-center">
                  <p className="text-sm text-muted-foreground mb-2">Couldn&apos;t load</p>
                  <Button variant="outline" size="sm" onClick={() => fetchRecommendations()}>Try again</Button>
                </div>
              : recommendations.length > 0
                ? recommendations.map((item) => <MediaCard key={item.id} media={item} />)
                : <p className="w-full py-12 text-center text-sm text-muted-foreground">Log some media to see recommendations</p>
          }
        </div>
      </div>
    </section>
  )
}
