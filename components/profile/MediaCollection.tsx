"use client"

import { useState } from "react"
import Image from "next/image"
import { CalendarIcon, BookOpen, Film, Tv, Loader2, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { MediaEntry, MediaItem, MediaType } from "@/types/database"
import { useRouter } from "next/navigation"
import { Timestamp } from "firebase/firestore"

const TYPE_FILTERS: Array<{ value: MediaType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV" },
  { value: "book", label: "Books" },
]

interface MediaCollectionProps {
  libraryEntries: (MediaEntry & { id: string })[]
  watchlist: MediaItem[]
  isLoadingLibrary: boolean
  isLoadingWatchlist: boolean
  selectedMediaType: MediaType | 'all'
  onMediaTypeChange: (type: MediaType | 'all') => void
  isOwnProfile: boolean
  onDeleteEntry?: (entry: MediaEntry & { id: string }) => Promise<void>
}

function formatDate(date: Date | Timestamp): string {
  const jsDate = date instanceof Date ? date : date.toDate()
  return jsDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function MediaTypeIcon({ type }: { type: string }) {
  if (type === "movie") return <Film className="h-3 w-3 text-muted-foreground" />
  if (type === "book") return <BookOpen className="h-3 w-3 text-muted-foreground" />
  if (type === "tv") return <Tv className="h-3 w-3 text-muted-foreground" />
  return null
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-foreground/80 mb-1">{title}</p>
      <p className="text-xs text-muted-foreground max-w-xs mx-auto">{description}</p>
    </div>
  )
}

export default function MediaCollection({
  libraryEntries,
  watchlist,
  isLoadingLibrary,
  isLoadingWatchlist,
  selectedMediaType,
  onMediaTypeChange,
  isOwnProfile,
  onDeleteEntry,
}: MediaCollectionProps) {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<(MediaEntry & { id: string }) | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!deleteTarget || !onDeleteEntry) return
    setIsDeleting(true)
    try {
      await onDeleteEntry(deleteTarget)
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  const [activeTab, setActiveTab] = useState<"library" | "watchlist">("library")
  const [visibleCount, setVisibleCount] = useState(20)
  const PAGE_SIZE = 20

  // Reset paging when tab or filter changes
  const resetPaging = () => setVisibleCount(PAGE_SIZE)

  const filteredLibrary = libraryEntries.filter(
    entry => selectedMediaType === 'all' || entry.type === selectedMediaType
  )
  const filteredWatchlist = watchlist.filter(
    item => selectedMediaType === 'all' || item.type === selectedMediaType
  )

  return (
    <section>
      {/* Header: eyebrow + tabs + filters */}
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Collection</p>
        <div className="flex items-center gap-4">
          {/* Tabs */}
          <div className="flex gap-1">
            {[
              { value: "library", label: "Library" },
              { value: "watchlist", label: "Watchlist" },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setActiveTab(value as "library" | "watchlist"); resetPaging() }}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors border-b -mb-px
                  ${activeTab === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Type filter */}
          <div className="flex gap-1">
            {TYPE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => { onMediaTypeChange(value); resetPaging() }}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors
                  ${selectedMediaType === value
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {activeTab === "library" ? (
        isLoadingLibrary ? (
          <div className="flex justify-center items-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredLibrary.length === 0 ? (
          <EmptyState title="No media added yet" description="Start adding movies, books, or TV shows to build your collection" />
        ) : (
          <>
          <div className="divide-y divide-border/60">
            {filteredLibrary.slice(0, visibleCount).map((item) => (
              <div key={item.id}
                className="group flex gap-4 py-4 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => router.push(`/media/${item.mediaId}`)}>
                <div className="relative w-12 h-[72px] overflow-hidden rounded-sm bg-muted/60 shrink-0">
                  <Image src={item.coverImage || "/placeholder.svg"} alt={item.title} fill className="object-cover" sizes="48px" />
                </div>
                <div className="flex flex-col justify-between flex-1 min-w-0">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight line-clamp-1">{item.title}</h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                      <MediaTypeIcon type={item.type} />
                      <span className="capitalize">{item.type}</span>
                      {item.rating > 0 && (
                        <><span className="text-border">·</span><span className="text-foreground/70 font-medium">{item.rating}/5</span></>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center text-[10px] text-muted-foreground/70">
                      <CalendarIcon className="h-2.5 w-2.5 mr-1" />
                      {formatDate(item.watchedAt)}
                    </div>
                    {isOwnProfile && onDeleteEntry && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(item) }}
                        className="text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        aria-label="Remove"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {filteredLibrary.length > visibleCount && (
            <div className="border-t border-border/60 pt-5 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Showing {visibleCount} of {filteredLibrary.length}
              </p>
              <button
                type="button"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary hover:text-foreground transition-colors"
              >
                Load more
              </button>
            </div>
          )}
          </>
        )
      ) : (
        isLoadingWatchlist ? (
          <div className="flex justify-center items-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredWatchlist.length === 0 ? (
          <EmptyState title="Your watchlist is empty" description="Start adding media to your watchlist to track what you want to experience next" />
        ) : (
          <>
          <div className="divide-y divide-border/60">
            {filteredWatchlist.slice(0, visibleCount).map((item) => (
              <div key={`${item.type}-${item.id}`}
                className="group flex gap-4 py-4 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => router.push(`/media/${item.id}`)}>
                <div className="relative w-12 h-[72px] overflow-hidden rounded-sm bg-muted/60 shrink-0">
                  <Image src={item.coverImage || "/placeholder.svg"} alt={item.title} fill className="object-cover" sizes="48px" />
                </div>
                <div className="flex flex-col justify-between flex-1 min-w-0">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight line-clamp-1">{item.title}</h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
                      <MediaTypeIcon type={item.type} />
                      <span className="capitalize">{item.type}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 italic mt-1.5">On your watchlist</p>
                </div>
              </div>
            ))}
          </div>
          {filteredWatchlist.length > visibleCount && (
            <div className="border-t border-border/60 pt-5 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Showing {visibleCount} of {filteredWatchlist.length}
              </p>
              <button
                type="button"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary hover:text-foreground transition-colors"
              >
                Load more
              </button>
            </div>
          )}
          </>
        )
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from library?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove &quot;{deleteTarget?.title}&quot; from your library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
