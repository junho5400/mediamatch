"use client"

import { useState } from "react"
import Image from "next/image"
import { CalendarIcon, BookOpen, Film, Tv, Loader2, Trash2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { MediaEntry, MediaItem, MediaType } from "@/types/database"
import { useRouter } from "next/navigation"
import { Timestamp } from "firebase/firestore"

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
  if (type === "movie") return <Film className="h-3 w-3 text-indigo-500" />
  if (type === "book") return <BookOpen className="h-3 w-3 text-pink-500" />
  if (type === "tv") return <Tv className="h-3 w-3 text-purple-500" />
  return null
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="text-4xl mb-4">{icon}</div>
      <p className="text-lg font-medium mb-2">{title}</p>
      <p className="text-muted-foreground max-w-xs">{description}</p>
    </div>
  )
}

function MediaFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-between items-center">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px] border border-border/50 rounded-lg">
          <SelectValue placeholder="Filter by type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="movie">Movies</SelectItem>
          <SelectItem value="tv">TV Shows</SelectItem>
          <SelectItem value="book">Books</SelectItem>
        </SelectContent>
      </Select>
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

  const filteredLibrary = libraryEntries.filter(
    entry => selectedMediaType === 'all' || entry.type === selectedMediaType
  )
  const filteredWatchlist = watchlist.filter(
    item => selectedMediaType === 'all' || item.type === selectedMediaType
  )

  return (
    <Card className="border-0 rounded-xl shadow-[0_8px_20px_-8px_rgba(0,0,0,0.12)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-xl font-semibold tracking-tight">Media Collection</CardTitle>
        <CardDescription className="text-muted-foreground">Your personal media collection</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="library" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 p-1 rounded-full bg-muted/50 border border-border/50">
            <TabsTrigger value="library" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2">
              Library
            </TabsTrigger>
            <TabsTrigger value="watchlist" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground py-2">
              Watchlist
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-4 pt-4">
            <MediaFilter value={selectedMediaType} onChange={(v) => onMediaTypeChange(v as MediaType | 'all')} />
            <ScrollArea className="h-[400px] pr-4">
              {isLoadingLibrary ? (
                <div className="flex justify-center items-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredLibrary.length === 0 ? (
                <EmptyState icon="📚" title="No media added yet" description="Start adding movies, books, or TV shows to build your collection" />
              ) : (
                <div className="space-y-3">
                  {filteredLibrary.map((item) => (
                    <div key={item.id}
                      className="flex gap-3 p-3 border border-border/50 rounded-xl hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer bg-card"
                      onClick={() => router.push(`/media/${item.mediaId}`)}>
                      <div className="relative w-16 h-24 rounded-lg overflow-hidden shadow-sm">
                        <Image src={item.coverImage || "/placeholder.svg"} alt={item.title} fill className="object-cover" />
                      </div>
                      <div className="flex flex-col justify-between flex-1">
                        <div>
                          <h3 className="font-medium line-clamp-1">{item.title}</h3>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <MediaTypeIcon type={item.type} />
                            <span className="capitalize">{item.type}</span>
                            {item.rating > 0 && (
                              <><span>•</span><span className="text-amber-500 font-medium">{item.rating}</span></>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center text-xs text-muted-foreground">
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            Added: {formatDate(item.watchedAt)}
                          </div>
                          {isOwnProfile && onDeleteEntry && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeleteTarget(item)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-4 pt-4">
            <MediaFilter value={selectedMediaType} onChange={(v) => onMediaTypeChange(v as MediaType | 'all')} />
            <ScrollArea className="h-[400px] pr-4">
              {isLoadingWatchlist ? (
                <div className="flex justify-center items-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredWatchlist.length === 0 ? (
                <EmptyState icon="📋" title="Your watchlist is empty" description="Start adding media to your watchlist to track what you want to experience next" />
              ) : (
                <div className="space-y-3">
                  {filteredWatchlist.map((item) => (
                    <div key={`${item.type}-${item.id}`}
                      className="flex gap-3 p-3 border border-border/50 rounded-xl hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer bg-card"
                      onClick={() => router.push(`/media/${item.id}`)}>
                      <div className="relative w-16 h-24 rounded-lg overflow-hidden shadow-sm">
                        <Image src={item.coverImage || "/placeholder.svg"} alt={item.title} fill className="object-cover" />
                      </div>
                      <div className="flex flex-col justify-between flex-1">
                        <div>
                          <h3 className="font-medium line-clamp-1">{item.title}</h3>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <MediaTypeIcon type={item.type} />
                            <span className="capitalize">{item.type}</span>
                          </div>
                        </div>
                        <div className="flex items-center text-xs text-muted-foreground mt-2 italic">
                          On your watchlist
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>

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
    </Card>
  )
}
