"use client"

import Link from "next/link"
import { useState, useEffect } from "react"
import Image from "next/image"
import { ChevronRight, Search, Loader2, BookOpen, Film, Tv, Dna, Lock, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { MediaItem, MediaEntry, MediaType, UserProfile } from "@/types/database"
import { getUserMediaEntries, getUserWatchlist, updateFavoriteMedia, deleteMediaEntry } from "@/lib/firebase/firestore"
import { auth } from "@/lib/firebase/firebase"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useDebouncedCallback } from 'use-debounce'
import ChatbotLauncher from "@/components/ChatbotLauncher"
import MediaCalendar from "@/components/profile/MediaCalendar"
import MediaCollection from "@/components/profile/MediaCollection"

interface ProfileViewProps { profile: UserProfile; isOwnProfile: boolean }
interface FavoriteMediaCollection {
  book?: { mediaId?: string; title: string; coverImage: string }
  movie?: { mediaId?: string; title: string; coverImage: string }
  tv?: { mediaId?: string; title: string; coverImage: string }
}

export default function ProfileView({ profile, isOwnProfile }: ProfileViewProps) {
  const [libraryEntries, setLibraryEntries] = useState<(MediaEntry & { id: string })[]>([])
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(true)
  const [selectedMediaType, setSelectedMediaType] = useState<MediaType | 'all'>('all')
  const [watchlist, setWatchlist] = useState<MediaItem[]>([])
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(true)
  const [favoriteMedia, setFavoriteMedia] = useState<FavoriteMediaCollection>(profile.favoriteMedia || {})
  const [editingMedia, setEditingMedia] = useState<{ type: keyof FavoriteMediaCollection | null; isOpen: boolean }>({ type: null, isOpen: false })
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<MediaItem[]>([])

  useEffect(() => {
    if (!profile.uid) return
    getUserMediaEntries(profile.uid).then(setLibraryEntries).catch(() => {}).finally(() => setIsLoadingLibrary(false))
    getUserWatchlist(profile.uid).then(async (ids) => {
      const items = await Promise.all(ids.map(async (id) => {
        try { const res = await fetch(`/api/media/${id.includes('-') ? id : `movie-${id}`}`); return res.ok ? res.json() : null }
        catch { return null }
      }))
      setWatchlist(items.filter(Boolean))
    }).catch(() => {}).finally(() => setIsLoadingWatchlist(false))
  }, [profile.uid])

  const searchMedia = useDebouncedCallback(async (query: string) => {
    if (!editingMedia.type || query.length < 2) { setSearchResults([]); return }
    setIsSearching(true)
    try { const res = await fetch(`/api/media/search?q=${encodeURIComponent(query)}&type=${editingMedia.type}`); if (res.ok) setSearchResults(await res.json()) }
    catch {} finally { setIsSearching(false) }
  }, 300)

  const handleSelectFavorite = async (media: MediaItem) => {
    if (!editingMedia.type) return
    const t = editingMedia.type
    try {
      await updateFavoriteMedia(profile.uid, t, { title: media.title, coverImage: media.coverImage || "/placeholder.svg", mediaId: media.id })
      setFavoriteMedia(prev => ({ ...prev, [t]: { title: media.title, coverImage: media.coverImage || "/placeholder.svg" } }))
      setEditingMedia({ type: null, isOpen: false }); setSearchQuery(""); setSearchResults([])
    } catch { toast({ title: "Error", description: "Failed to update", variant: "destructive" }) }
  }

  const stats = profile.stats || { totalRatings: 0, averageRating: 0, ratingDistribution: {} }
  const movieCount = libraryEntries.filter(e => e.type === 'movie').length
  const tvCount = libraryEntries.filter(e => e.type === 'tv').length
  const bookCount = libraryEntries.filter(e => e.type === 'book').length
  const recentEntries = [...libraryEntries].sort((a, b) => {
    const da = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.seconds * 1000 || 0
    const db_ = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.seconds * 1000 || 0
    return db_ - da
  }).slice(0, 8)

  let memberSince = new Date().getFullYear()
  try {
    if (profile.createdAt) {
      if (profile.createdAt instanceof Date) memberSince = profile.createdAt.getFullYear()
      else if (typeof (profile.createdAt as any).toDate === 'function') memberSince = (profile.createdAt as any).toDate().getFullYear()
      else if (typeof (profile.createdAt as any).seconds === 'number') memberSince = new Date((profile.createdAt as any).seconds * 1000).getFullYear()
    }
  } catch {}

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16">

        {/* ════ THREE-COLUMN LAYOUT ════ */}
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_260px] gap-12 lg:gap-14 items-start">

          {/* ══ COL 1: Profile ID — sticky, no card chrome ══ */}
          <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
            <Avatar className="h-20 w-20">
              <AvatarImage src={profile.photoURL || undefined} />
              <AvatarFallback className="bg-muted text-2xl font-bold text-muted-foreground">
                {profile.displayName?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>

            <div className="space-y-1">
              <h1 className="text-base font-semibold tracking-tight">{profile.displayName}</h1>
              <p className="text-[11px] text-muted-foreground">Since {memberSince}</p>
            </div>

            {/* Stats — flat list, hairline separators */}
            <div className="border-t border-border/60 pt-4 space-y-3">
              {[
                { val: stats.totalRatings, label: "Rated" },
                { val: stats.averageRating ? stats.averageRating.toFixed(1) : "—", label: "Avg" },
                { val: movieCount + tvCount, label: "Watched" },
                { val: bookCount, label: "Read" },
              ].map(({ val, label }) => (
                <div key={label} className="flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">{val}</span>
                </div>
              ))}
            </div>

            {/* Favorites */}
            <div className="border-t border-border/60 pt-4 space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Favorites</p>
              <div className="grid grid-cols-3 gap-2">
                {(['movie', 'tv', 'book'] as const).map((type) => (
                  <div key={type}
                    className={`relative aspect-[2/3] rounded-sm overflow-hidden bg-muted/60
                      ${isOwnProfile ? 'cursor-pointer group hover:opacity-90 transition-opacity' : ''}`}
                    onClick={() => isOwnProfile && setEditingMedia({ type, isOpen: true })}>
                    {favoriteMedia?.[type]?.coverImage ? (
                      <Image src={favoriteMedia[type]!.coverImage} alt={favoriteMedia[type]!.title} fill
                        className="object-cover" sizes="80px" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-muted-foreground">
                        {type === 'movie' ? <Film className="h-3.5 w-3.5" /> : type === 'tv' ? <Tv className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
                        {isOwnProfile && <span className="text-[8px]">Add</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Media DNA — hairline divider button */}
            {libraryEntries.length >= 5 ? (
              <Link
                href={`/profile/${profile.uid}/ai-report`}
                prefetch={false}
                className="group border-t border-border/60 pt-4 flex items-center justify-between"
              >
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary group-hover:text-foreground transition-colors">
                  <Dna className="h-3 w-3" />Media DNA
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ) : !isLoadingLibrary && libraryEntries.length > 0 && (
              <div className="border-t border-border/60 pt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
                <Lock className="h-3 w-3 shrink-0" />Log {5 - libraryEntries.length} more for Media DNA
              </div>
            )}
          </aside>

          {/* ══ COL 2: Calendar + Collection — no card chrome ══ */}
          <main className="space-y-12 min-w-0">
            <MediaCalendar
              libraryEntries={libraryEntries}
              isLoadingLibrary={isLoadingLibrary}
              selectedMediaType={selectedMediaType}
              onMediaTypeChange={setSelectedMediaType}
            />
            <div className="border-t border-border/60 pt-8">
              <MediaCollection
                libraryEntries={libraryEntries}
                watchlist={watchlist}
                isLoadingLibrary={isLoadingLibrary}
                isLoadingWatchlist={isLoadingWatchlist}
                selectedMediaType={selectedMediaType}
                onMediaTypeChange={setSelectedMediaType}
                isOwnProfile={isOwnProfile}
                onDeleteEntry={async (entry) => {
                  await deleteMediaEntry(profile.uid, entry.type, entry.mediaId, entry.id, entry.rating)
                  setLibraryEntries(prev => prev.filter(e => e.id !== entry.id))
                  toast({ title: "Removed", description: "Media removed" })
                }}
              />
            </div>
          </main>

          {/* ══ COL 3: Recent + Watchlist ══ */}
          <aside className="lg:sticky lg:top-20 lg:self-start space-y-8">
            {/* Recent activity */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 mb-3">Recent</p>
              {isLoadingLibrary ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {Array(8).fill(0).map((_, i) => <div key={i} className="aspect-[2/3] rounded-sm shimmer" />)}
                </div>
              ) : recentEntries.length > 0 ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {recentEntries.map((entry) => (
                    <div key={entry.id} className="group relative aspect-[2/3] rounded-sm overflow-hidden bg-muted/60">
                      {entry.coverImage && (
                        <Image src={entry.coverImage} alt={entry.title} fill className="object-cover" sizes="60px" />
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-end justify-center pb-1">
                        {entry.rating && (
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-white font-medium flex items-center gap-0.5">
                            <Star className="h-2 w-2 text-amber-400 fill-amber-400" />{entry.rating}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-6">No activity yet</p>
              )}
            </div>

            {/* Watchlist */}
            <div className="border-t border-border/60 pt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 mb-3">
                Watchlist {watchlist.length > 0 && <span className="text-foreground/80 ml-1 normal-case tracking-normal">{watchlist.length}</span>}
              </p>
              {isLoadingWatchlist ? (
                <div className="space-y-2">
                  {Array(3).fill(0).map((_, i) => <div key={i} className="h-10 rounded-sm shimmer" />)}
                </div>
              ) : watchlist.length > 0 ? (
                <div className="space-y-2">
                  {watchlist.slice(0, 6).map((item) => (
                    <Link key={item.id} href={`/media/${item.type}-${item.id}`}
                      className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                      <div className="relative w-7 h-10 rounded-sm overflow-hidden bg-muted/60 shrink-0">
                        {item.coverImage && <Image src={item.coverImage} alt={item.title} fill className="object-cover" sizes="28px" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{item.title}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{item.type}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-4">Nothing here yet</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Edit Favorite Dialog */}
      <Dialog open={editingMedia.isOpen} onOpenChange={(open) => {
        setEditingMedia({ type: null, isOpen: open }); setSearchQuery(""); setSearchResults([])
      }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Favorite {editingMedia.type?.charAt(0).toUpperCase()}{editingMedia.type?.slice(1)}</DialogTitle>
            <DialogDescription>Search and select your favorite.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search..." className="pl-9" value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); searchMedia(e.target.value) }} />
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {isSearching && <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Searching...</div>}
              {searchResults.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                  onClick={() => handleSelectFavorite(item)}>
                  <div className="relative w-8 h-12 rounded overflow-hidden bg-muted shrink-0">
                    {item.coverImage && <Image src={item.coverImage} alt={item.title} fill className="object-cover" sizes="32px" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground">{item.year}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ChatbotLauncher />
    </div>
  )
}
