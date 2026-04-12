"use client"

import { useState, useEffect, useRef } from "react"
import { Search, X, Loader2, Film, Tv, BookOpen, Users } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { MediaItem, MediaType, UserProfile } from "@/types/database"
import { useRouter } from "next/navigation"
import { useDebouncedCallback } from "use-debounce"
import { getAllUsers } from "@/lib/firebase/firestore"
import Image from "next/image"

const TYPES = [
  { type: "movie" as const, icon: Film, label: "Movies" },
  { type: "tv" as const, icon: Tv, label: "TV Shows" },
  { type: "book" as const, icon: BookOpen, label: "Books" },
  { type: "user" as const, icon: Users, label: "People" },
]

interface SearchOverlayProps {
  open: boolean
  onClose: () => void
}

export default function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("")
  const [selectedType, setSelectedType] = useState<MediaType | "user">("movie")
  const [isSearching, setIsSearching] = useState(false)
  const [mediaResults, setMediaResults] = useState<MediaItem[]>([])
  const [userResults, setUserResults] = useState<UserProfile[]>([])
  const [allUsers, setAllUsers] = useState<UserProfile[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Load users once
  useEffect(() => {
    getAllUsers().then(setAllUsers).catch(() => {})
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
      setQuery("")
      setMediaResults([])
      setUserResults([])
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    if (open) window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  const performSearch = useDebouncedCallback(async (q: string) => {
    if (q.length < 2) { setMediaResults([]); setUserResults([]); return }
    setIsSearching(true)
    try {
      if (selectedType === "user") {
        setUserResults(allUsers.filter(u => u.displayName?.toLowerCase().includes(q.toLowerCase())))
        setMediaResults([])
      } else {
        const res = await fetch(`/api/media/search?q=${encodeURIComponent(q)}&type=${selectedType}`)
        setUserResults([])
        if (res.ok) setMediaResults(await res.json())
      }
    } catch {} finally { setIsSearching(false) }
  }, 300)

  const handleInput = (val: string) => {
    setQuery(val)
    performSearch(val)
  }

  const select = (path: string) => {
    onClose()
    router.push(path)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-x-0 top-0 z-50 flex justify-center pt-[15vh] px-4">
        <div className="w-full max-w-lg bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Type pills */}
          <div className="flex gap-1.5 p-3 pb-0">
            {TYPES.map(({ type, icon: Icon, label }) => (
              <button key={type} onClick={() => { setSelectedType(type); setQuery(""); setMediaResults([]); setUserResults([]) }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                  ${selectedType === type
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                <Icon className="h-3 w-3" />{label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="relative p-3">
            <Search className="absolute left-6 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="text"
              placeholder={`Search ${TYPES.find(t => t.type === selectedType)?.label.toLowerCase()}...`}
              className="pl-10 pr-10 h-11 rounded-xl border-border text-sm"
              value={query}
              onChange={(e) => handleInput(e.target.value)}
            />
            <div className="absolute right-6 inset-y-0 flex items-center">
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : query ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex items-center"
                  onClick={() => { setQuery(""); setMediaResults([]); setUserResults([]) }}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          {/* Results */}
          {query.length >= 2 && (mediaResults.length > 0 || userResults.length > 0 || !isSearching) && (
            <div className="max-h-[50vh] overflow-y-auto border-t border-border">
              {mediaResults.length > 0 ? (
                <div className="p-2">
                  {mediaResults.map((item) => (
                    <div key={item.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => select(`/media/${item.id}`)}>
                      <div className="relative h-14 w-10 rounded overflow-hidden bg-muted shrink-0">
                        {item.coverImage && (
                          <Image src={item.coverImage} alt={item.title} fill className="object-cover" sizes="40px" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="capitalize">{item.type}</span>
                          {item.year && <span> · {item.year}</span>}
                          {item.genres?.slice(0, 2).map(g => <span key={g}> · {g}</span>)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : userResults.length > 0 ? (
                <div className="p-2">
                  {userResults.map((u) => (
                    <div key={u.uid}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => select(`/profile/${u.uid}`)}>
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={u.photoURL || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">{u.displayName?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{u.displayName}</p>
                        <p className="text-xs text-muted-foreground">{u.stats?.totalRatings || 0} ratings</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground py-12">
                  No results for &quot;{query}&quot;
                </p>
              )}
            </div>
          )}

          {/* Keyboard hint */}
          {query.length < 2 && (
            <div className="p-3 pt-0 text-center">
              <p className="text-[11px] text-muted-foreground/50">
                Press <kbd className="px-1.5 py-0.5 rounded border border-border text-[10px]">ESC</kbd> to close
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
