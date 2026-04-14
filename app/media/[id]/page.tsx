"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { Film, BookOpen, Tv, ListPlus, ListX, PlusCircle, Star, ArrowLeft, Clock } from "lucide-react"
import LogMediaDialog from "@/components/log-media-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { MediaItem, MediaEntry } from "@/types/database"
import { Rating } from "@/components/ui/rating"
import { format } from "date-fns"
import { auth } from "@/lib/firebase/firebase"
import { getUserMediaEntries } from "@/lib/firebase/firestore"
import { getDoc, doc } from "firebase/firestore"
import { db } from "@/lib/firebase/firebase"

export default function MediaDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [userRating, setUserRating] = useState(0)
  const [inWatchlist, setInWatchlist] = useState(false)
  const [userEntry, setUserEntry] = useState<MediaEntry | null>(null)
  const [logOpen, setLogOpen] = useState(false)

  useEffect(() => {
    const fetchMedia = async () => {
      try {
        const [mediaRes] = await Promise.all([fetch(`/api/media/${id}`), fetch(`/api/media/${id}/ratings`)])
        if (!mediaRes.ok) throw new Error()
        const data = await mediaRes.json()
        setMedia(data)
        const currentUser = auth.currentUser
        if (currentUser) {
          const [entries, userDoc] = await Promise.all([getUserMediaEntries(currentUser.uid), getDoc(doc(db, 'users', currentUser.uid))])
          const found = entries.find(e => e.mediaId === id)
          if (found) { setUserEntry(found); setUserRating(found.rating || 0) }
          if (userDoc.exists()) { setInWatchlist((userDoc.data().watchlist || []).includes(`${data.type}-${id}`)) }
        }
      } catch { toast({ title: "Error", description: "Failed to load media", variant: "destructive" }) }
      finally { setIsLoading(false) }
    }
    fetchMedia()
  }, [id, toast])

  const toggleWatchlist = async () => {
    try {
      const user = auth.currentUser
      if (!user || !media) return
      const token = await user.getIdToken()
      const res = await fetch(`/api/media/${id}/watchlist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ add: !inWatchlist }),
      })
      if (!res.ok) throw new Error()
      setInWatchlist(!inWatchlist)
      toast({ title: inWatchlist ? "Removed" : "Added", description: `${media.title} ${inWatchlist ? "removed from" : "added to"} watchlist` })
    } catch { toast({ title: "Error", description: "Failed to update watchlist", variant: "destructive" }) }
  }

  if (isLoading) return <div className="h-[60vh] flex items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>

  if (!media) return (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">Media not found</p>
      <Button variant="ghost" size="sm" onClick={() => router.push("/")}><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Home</Button>
    </div>
  )

  const hasBackdrop = !!media.backdropImage

  return (
    <div>
      {/* ── Full-width backdrop ── */}
      <div className="relative w-full h-[50vh] min-h-[380px] max-h-[500px] overflow-hidden">
        {(media.backdropImage || media.coverImage) && (
          <Image
            src={media.backdropImage || media.coverImage!}
            alt=""
            fill
            className={`object-cover ${hasBackdrop ? '' : 'blur-md scale-110'}`}
            style={{ filter: 'var(--backdrop-brightness)' }}
            priority
          />
        )}
        {/* Smooth fade to background */}
        <div className="absolute bottom-0 left-0 right-0 h-1/2" style={{ background: 'linear-gradient(to top, hsl(var(--background)) 0%, hsl(var(--background) / 0.6) 40%, transparent 100%)' }} />

        {/* Back */}
        <div className="absolute top-4 left-4 sm:left-6 lg:left-8 z-10">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="text-white/70 hover:text-white hover:bg-white/10 text-xs">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />Back
          </Button>
        </div>
      </div>

      {/* ── Content overlapping the backdrop ── */}
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 -mt-48 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_280px] gap-6 items-start">

          {/* ── Col 1: Poster ── */}
          <div className="hidden lg:block">
            <div className="relative w-[220px] aspect-[2/3] rounded-xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/10">
              <Image src={media.coverImage || "/placeholder.svg"} alt={media.title} fill className="object-cover" priority />
            </div>
          </div>

          {/* ── Col 2: Main info ── */}
          <div className="space-y-5 pt-2">
            {/* Meta */}
            <div className="flex items-center gap-2 text-xs text-white/50 lg:text-muted-foreground">
              {media.type === "movie" ? <Film className="h-3.5 w-3.5" /> : media.type === "book" ? <BookOpen className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
              <span className="capitalize">{media.type}</span>
              {media.year && <><span>·</span><span>{media.year}</span></>}
              {media.authors?.length ? <><span>·</span><span>{media.authors.join(", ")}</span></> : null}
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-white lg:text-foreground">
              {media.title}
            </h1>

            {/* Genres */}
            {media.genres && media.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {media.genres.map(g => (
                  <Badge key={g} variant="secondary" className="text-[11px] font-medium rounded-full px-2.5 py-0.5">{g}</Badge>
                ))}
              </div>
            )}

            {/* Ratings inline */}
            <div className="flex items-center gap-5">
              {media.stats && media.stats.totalRatings > 0 ? (
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  <span className="text-lg font-bold">{media.stats.averageRating.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">/5 · {media.stats.totalRatings}</span>
                </div>
              ) : userEntry && userRating > 0 ? (
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  <span className="text-lg font-bold">{userRating.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">/5 · your rating</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">No ratings yet</span>
              )}
              {media.type !== 'book' && media.rating && media.rating > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground border-l border-border pl-5">
                  <span className="font-semibold text-foreground">{media.rating.toFixed(1)}</span>/10 TMDB
                </div>
              )}
            </div>

            {/* Description */}
            {media.description && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Synopsis</h2>
                <p className="text-sm leading-relaxed text-foreground/80">{media.description}</p>
              </div>
            )}

            {/* User log (if logged) */}
            {userEntry && (
              <div className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 flex-nowrap whitespace-nowrap overflow-x-auto">
                  <span className="text-xs text-muted-foreground shrink-0">Your rating</span>
                  <Rating value={userRating} onChange={() => {}} readOnly={true} size="sm" />
                  {userEntry.tag && userEntry.tag.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px] shrink-0">{tag}</Badge>
                  ))}
                </div>
                {userEntry.review && <p className="text-sm text-muted-foreground italic leading-relaxed">&quot;{userEntry.review}&quot;</p>}
                <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {format(userEntry.watchedAt instanceof Date ? userEntry.watchedAt : userEntry.watchedAt.toDate(), 'MMMM d, yyyy')}
                </p>
              </div>
            )}

            {/* Credits */}
            {(media.directors?.length || media.cast?.length) && (
              <div className="space-y-2">
                {media.directors?.length ? (
                  <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-14 shrink-0">Director</span><span>{media.directors.join(", ")}</span></div>
                ) : null}
                {media.cast?.length ? (
                  <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-14 shrink-0">Cast</span><span className="line-clamp-2">{media.cast.join(", ")}</span></div>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Col 3: Actions + Details card ── */}
          <div className="hidden lg:flex flex-col space-y-3 pt-32">
            {/* Actions — horizontal, above the card (always rendered to keep layout stable) */}
            <div className="flex gap-2">
              <Button onClick={() => setLogOpen(true)} size="sm" className="flex-1">
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />{userEntry ? 'Edit' : 'Log'}
              </Button>
              <Button variant="secondary" size="sm" onClick={toggleWatchlist} className="flex-1 bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] border-0">
                {inWatchlist ? <><ListX className="mr-1.5 h-3.5 w-3.5" />Watchlist</> : <><ListPlus className="mr-1.5 h-3.5 w-3.5" />Watchlist</>}
              </Button>
            </div>

            {/* Details card — glassmorphic, bottom-aligned with poster */}
            <div className="rounded-xl p-4 space-y-2.5 bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06]">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Details</h3>
              {(
                [
                  ["Type", media.type.charAt(0).toUpperCase() + media.type.slice(1)],
                  media.year ? ["Year", media.year] : null,
                  media.authors?.length ? ["Author", media.authors.join(", ")] : null,
                  media.genres?.length ? ["Genre", media.genres.slice(0, 2).join(", ")] : null,
                  media.totalRatings && media.totalRatings > 0 ? ["Votes", media.totalRatings.toLocaleString()] : null,
                ].filter((row): row is [string, string] => row !== null)
              ).map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right max-w-[150px] truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile-only actions */}
          {!userEntry && (
            <div className="flex gap-2 lg:hidden mt-4">
              <Button onClick={() => setLogOpen(true)} size="sm">
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />Log
              </Button>
              <Button variant="secondary" size="sm" onClick={toggleWatchlist}>
                {inWatchlist ? <><ListX className="mr-1.5 h-3.5 w-3.5" />Watchlist</> : <><ListPlus className="mr-1.5 h-3.5 w-3.5" />Watchlist</>}
              </Button>
            </div>
          )}
        </div>
      </div>
      <LogMediaDialog open={logOpen} onOpenChange={setLogOpen} prefilledMediaId={media.id} />
    </div>
  )
}
