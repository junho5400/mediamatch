"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { format } from "date-fns"
import { CalendarIcon, Loader2, Search, X, BookOpen, Film, Tv } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { cn } from "@/lib/utils"
import { addMediaToLibrary } from "@/lib/api"
import MediaSearchResults from "@/components/media-search-results"
import { MediaItem, MediaType } from "@/types/database"
import { useDebouncedCallback } from 'use-debounce'
import { Rating } from "@/components/ui/rating"
import { useSearchParams, useRouter } from "next/navigation"
import { auth } from "@/lib/firebase/firebase"

const formSchema = z.object({
  date: z.date().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
  rating: z.number().min(0.5).max(5).optional(),
  addToWatchlist: z.boolean().optional(),
})

interface AddMediaFormProps {
  prefilledMediaId?: string | null
  onSuccess?: () => void
}

export default function AddMediaForm({ prefilledMediaId, onSuccess }: AddMediaFormProps = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<MediaItem[]>([])
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const [isLoadingMedia, setIsLoadingMedia] = useState(false)
  const [selectedType, setSelectedType] = useState<MediaType>('movie')

  // Fetch pre-selected media — prefer the prop, fall back to URL param
  useEffect(() => {
    const mediaId = prefilledMediaId ?? searchParams.get('mediaId')
    if (mediaId) {
      const fetchMedia = async () => {
        setIsLoadingMedia(true)
        try {
          const response = await fetch(`/api/media/${mediaId}`)
          if (!response.ok) {
            throw new Error('Failed to fetch media')
          }
          const data = await response.json()
          setSelectedMedia(data)
        } catch {
          toast({
            title: "Error",
            description: "Failed to load media details",
            variant: "destructive",
          })
        } finally {
          setIsLoadingMedia(false)
        }
      }
      fetchMedia()
    }
  }, [prefilledMediaId, searchParams, toast])

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tags: "",
      notes: "",
      rating: 0,
      addToWatchlist: false,
    },
  })

  const performSearch = useDebouncedCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    
    try {
      const response = await fetch(`/api/media/search?q=${encodeURIComponent(query)}${selectedType ? `&type=${selectedType}` : ''}`);
      
      if (!response.ok) {
        setSearchResults([]);
        return;
      }
      
      const results = await response.json();
      
      if (!Array.isArray(results)) {
        setSearchResults([]);
        return;
      }
      
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    performSearch(value);
  };

  const handleSelectMedia = (media: MediaItem) => {
    setSelectedMedia(media);
    setSearchResults([]);
    setSearchQuery("");
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!selectedMedia) {
      toast({
        title: "Error",
        description: "Please select a media to add",
        variant: "destructive",
      })
      return
    }

    try {
      await addMediaToLibrary({
        mediaId: selectedMedia.id,
        date: values.date,
        tags: values.tags,
        notes: values.notes,
        rating: values.rating,
        title: selectedMedia.title,
        coverImage: selectedMedia.coverImage,
      })

      toast({
        title: "Success",
        description: "Media added to your library",
      })

      if (onSuccess) {
        onSuccess()
      } else {
        // Standalone /add page → navigate to profile after submit
        const user = auth.currentUser
        if (user) {
          router.push(`/profile/${user.uid}`)
        }
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to add media to library",
        variant: "destructive",
      })
    }
  }

  const getSearchPlaceholder = () => {
    switch (selectedType) {
      case 'movie':
        return "Search movies...";
      case 'tv':
        return "Search TV shows...";
      case 'book':
        return "Search books...";
      default:
        return "Search movies...";
    }
  };

  const isInDialog = onSuccess !== undefined

  return (
    <div className="space-y-8">
      {!isInDialog && (
        <div>
          <h2 className="text-2xl font-semibold">Log your media</h2>
          <p className="text-sm text-muted-foreground">What did you watch/read?</p>
        </div>
      )}

      {!selectedMedia && !isLoadingMedia && (
        <div className="space-y-5 border-t border-border/60 pt-6">
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Type</p>
            <div className="flex gap-1">
              {([
                { value: 'movie' as const, icon: Film, label: 'Movies' },
                { value: 'tv' as const, icon: Tv, label: 'TV' },
                { value: 'book' as const, icon: BookOpen, label: 'Books' },
              ]).map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedType(value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium transition-colors border-b -mb-px
                    ${selectedType === value
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-3 w-3" />{label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={getSearchPlaceholder()}
              className="w-full pl-6 pr-8 py-2 text-sm bg-transparent border-0 border-b border-border focus:border-primary focus:outline-none transition-colors placeholder:text-muted-foreground/60"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
            />
            {isSearching && (
              <Loader2 className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          {searchResults.length > 0 && (
            <MediaSearchResults results={searchResults} onSelect={handleSelectMedia} />
          )}
        </div>
      )}

      {isLoadingMedia && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {selectedMedia && (
        <div className="flex items-center gap-4 border-t border-b border-border/60 py-5">
          <div className="relative w-14 h-20 overflow-hidden rounded shrink-0">
            <Image
              src={selectedMedia.coverImage || "/placeholder.svg"}
              alt={selectedMedia.title}
              fill
              sizes="56px"
              className="object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold tracking-tight truncate">{selectedMedia.title}</h3>
            <p className="text-[11px] text-muted-foreground capitalize">
              {selectedMedia.type}
              {selectedMedia.releaseDate ? ` · ${new Date(selectedMedia.releaseDate).getFullYear()}` : ''}
              {selectedMedia.genres?.length ? ` · ${selectedMedia.genres.slice(0, 2).join(', ')}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setSelectedMedia(null); setSearchQuery("") }}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-7 pt-2">
          <FormField
            control={form.control}
            name="rating"
            render={({ field }) => (
              <FormItem className="space-y-2.5">
                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rating</FormLabel>
                <FormControl>
                  <Rating
                    value={field.value || 0}
                    onChange={field.onChange}
                    size="sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem className="flex flex-col space-y-2.5">
                  <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Watched / Read on</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <button
                          type="button"
                          className={cn(
                            "flex items-center justify-between w-full text-left text-sm py-2 border-b border-border hover:border-primary/60 transition-colors",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="h-3.5 w-3.5 opacity-50" />
                        </button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date > new Date() || date < new Date("1900-01-01")
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem className="space-y-2.5">
                  <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tags</FormLabel>
                  <FormControl>
                    <input
                      type="text"
                      placeholder="thought-provoking, funny, rewatched"
                      className="w-full text-sm py-2 bg-transparent border-0 border-b border-border focus:border-primary focus:outline-none transition-colors placeholder:text-muted-foreground/60"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem className="space-y-2.5">
                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Review</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="What did you think? — your words feed the embedding model."
                    className="resize-none border-0 border-b border-border rounded-none focus-visible:ring-0 focus-visible:border-primary px-0 text-sm placeholder:text-muted-foreground/60 min-h-[64px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center justify-end pt-4 border-t border-border/60">
            <Button type="submit" disabled={!selectedMedia} className="rounded-full px-6">
              Add to library
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
