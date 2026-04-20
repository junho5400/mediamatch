"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Loader2, ArrowRight, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/authContext"
import { addMediaEntry } from "@/lib/firebase/firestore"
import { MediaItem } from "@/types/database"

interface OnboardingProps {
  displayName?: string | null
  onComplete?: () => void
}

// Curated, type-prefixed IDs — broad-taste sampler used to seed the
// cold-start signal. Span movies / TV / books across eras, genres,
// countries so the taste vector starts with real diversity.
const SEED_IDS = [
  // Movies (20)
  "movie-550",    // Fight Club
  "movie-27205",  // Inception
  "movie-680",    // Pulp Fiction
  "movie-13",     // Forrest Gump
  "movie-862",    // Toy Story
  "movie-129",    // Spirited Away
  "movie-19404",  // Dilwale Dulhania Le Jayenge
  "movie-475557", // Joker
  "movie-155",    // The Dark Knight
  "movie-238",    // The Godfather
  "movie-496243", // Parasite
  "movie-769",    // Goodfellas
  "movie-120",    // LOTR: Fellowship
  "movie-424",    // Schindler's List
  "movie-11",     // Star Wars
  "movie-372058", // Your Name
  "movie-637",    // Life Is Beautiful
  "movie-8587",   // The Lion King
  "movie-324857", // Spider-Verse
  "movie-389",    // 12 Angry Men
  // TV (12)
  "tv-1396",      // Breaking Bad
  "tv-1399",      // Game of Thrones
  "tv-66732",     // Stranger Things
  "tv-60574",     // Peaky Blinders
  "tv-94605",     // Arcane
  "tv-1668",      // Friends
  "tv-2316",      // The Office (US)
  "tv-46648",     // True Detective
  "tv-87108",     // Chernobyl
  "tv-93405",     // Squid Game
  "tv-76479",     // The Boys
  "tv-82856",     // The Mandalorian
  // Books (8)
  "book-iXn5U2IzVH0C", // The Great Gatsby
  "book-6u2QEAAAQBAJ", // 1984
  "book-ayJpGQeyxgkC", // To Kill a Mockingbird
  "book-OlCHcjX0RT4C", // The Hobbit
  "book-B1hSG45JCX4C", // Dune
  "book-hACTuAAACAAJ", // Harry Potter and the Sorcerer's Stone
  "book-3UQLvgAACAAJ", // Pride and Prejudice
  "book-zfuOEAAAQBAJ", // Sapiens
]

const MIN_PICKS = 5

function StarRow({
  value,
  onChange,
}: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map(n => {
        const filled = value >= n
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? 0 : n)}
            className="p-0.5 hover:scale-110 transition-transform"
            aria-label={`Rate ${n} stars`}
          >
            <Star
              className={`h-3.5 w-3.5 ${filled ? "fill-amber-400 text-amber-400" : "text-white/40"}`}
              strokeWidth={2}
            />
          </button>
        )
      })}
    </div>
  )
}

export default function Onboarding({ displayName, onComplete }: OnboardingProps) {
  const firstName = displayName?.split(" ")[0] || "there"
  const router = useRouter()
  const { user } = useAuth()
  const [items, setItems] = useState<MediaItem[]>([])
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all(
      SEED_IDS.map(id =>
        fetch(`/api/media/${id}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
      )
    ).then(results => {
      if (cancelled) return
      const valid = results.filter((r): r is MediaItem => !!r && !!r.coverImage)
      setItems(valid)
    })
    return () => { cancelled = true }
  }, [])

  const setRating = (id: string, value: number) => {
    setRatings(prev => {
      const next = { ...prev }
      if (value === 0) delete next[id]
      else next[id] = value
      return next
    })
  }

  const ratedCount = Object.keys(ratings).length
  const enough = ratedCount >= MIN_PICKS

  const submit = async () => {
    if (!user || !enough || submitting) return
    setSubmitting(true)
    try {
      await Promise.all(
        items
          .filter(it => ratings[it.id])
          .map(it =>
            addMediaEntry(user.uid, it.type, it.id, {
              mediaId: it.id,
              type: it.type,
              title: it.title,
              coverImage: it.coverImage,
              rating: ratings[it.id],
              review: "",
              watchedAt: new Date(),
            })
          )
      )
      router.refresh()
      onComplete?.()
    } catch {
      // fall through
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col">
      {/* ── Header ── */}
      <div className="max-w-[1100px] mx-auto w-full px-4 sm:px-6 lg:px-8 pt-12 pb-6">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">Step 1 of 1 · Cold start</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
              Welcome, {firstName}. Rate a few you&apos;ve seen.
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Star at least {MIN_PICKS}. Low ratings push your taste vector <em>away</em> from those embeddings, high ratings pull it closer — that&apos;s how the engine learns what you don&apos;t want.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold tabular-nums">{ratedCount}<span className="text-muted-foreground/60 text-base">/{MIN_PICKS}</span></p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">rated</p>
          </div>
        </div>

        {/* progress bar */}
        <div className="mt-5 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${Math.min(100, (ratedCount / MIN_PICKS) * 100)}%` }}
          />
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 max-w-[1100px] mx-auto w-full px-4 sm:px-6 lg:px-8 pb-32">
        {items.length === 0 ? (
          <div className="h-[40vh] flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map(item => {
              const value = ratings[item.id] || 0
              const active = value > 0
              return (
                <div
                  key={item.id}
                  className={`group relative aspect-[2/3] rounded-lg overflow-hidden transition-all
                    ${active
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "ring-1 ring-border/60"}`}
                >
                  {item.coverImage && (
                    <Image src={item.coverImage} alt={item.title} fill className="object-cover" sizes="(max-width: 768px) 50vw, 20vw" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-2.5 text-left space-y-1.5">
                    <div>
                      <p className="text-[11px] font-semibold text-white leading-tight line-clamp-1">{item.title}</p>
                      {item.year && <p className="text-[10px] text-white/50">{item.year}</p>}
                    </div>
                    <StarRow value={value} onChange={(v) => setRating(item.id, v)} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Sticky CTA bar ── */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="max-w-[1100px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {enough
              ? "Looking good. Ready to seed your taste vector."
              : `Rate ${MIN_PICKS - ratedCount} more to continue.`}
          </p>
          <Button
            onClick={submit}
            disabled={!enough || submitting}
            size="default"
            className="rounded-full px-5"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>Continue<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>}
          </Button>
        </div>
      </div>
    </div>
  )
}
