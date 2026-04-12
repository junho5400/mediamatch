"use client"

import { useState } from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight, BookOpen, Film, Tv } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MediaEntry, MediaType } from "@/types/database"
import { format } from "date-fns"
import { Timestamp } from "firebase/firestore"

interface MediaCalendarProps {
  libraryEntries: (MediaEntry & { id: string })[]
  isLoadingLibrary: boolean
  selectedMediaType: MediaType | 'all'
  onMediaTypeChange: (type: MediaType | 'all') => void
}

export default function MediaCalendar({
  libraryEntries,
  isLoadingLibrary,
  selectedMediaType,
  onMediaTypeChange,
}: MediaCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null)

  const formatYearMonth = (date: Date) =>
    `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}`

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const d = new Date(prev)
      d.setMonth(d.getMonth() + (direction === 'prev' ? -1 : 1))
      return d
    })
  }

  const getMediaEntriesForDate = (date: Date) => {
    if (isLoadingLibrary || !libraryEntries.length) return []
    return libraryEntries
      .filter(entry => {
        if (!entry.watchedAt) return false
        const entryDate = entry.watchedAt instanceof Date ? entry.watchedAt : (entry.watchedAt as Timestamp).toDate()
        return entryDate.toDateString() === date.toDateString() &&
          (selectedMediaType === 'all' || entry.type === selectedMediaType)
      })
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
  }

  const renderCalendarCell = (date: Date) => {
    const entries = getMediaEntriesForDate(date)
    const hasEntries = entries.length > 0

    return (
      <div
        key={date.toISOString()}
        className="aspect-square p-1 relative group"
        onMouseEnter={() => setHoveredDate(date)}
        onMouseLeave={() => setHoveredDate(null)}
      >
        <div className="relative w-full h-full">
          {hasEntries && (
            <div className="absolute inset-0 grid grid-cols-2 gap-0.5">
              {entries.slice(0, 2).map((entry, index) => (
                <div key={`${entry.id}-${index}`} className="relative aspect-[2/3] rounded-lg overflow-hidden shadow-sm">
                  <Image
                    src={entry.coverImage || "/placeholder.svg"}
                    alt={entry.title}
                    fill
                    sizes="60px"
                    className="object-cover"
                  />
                  {entry.rating > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm px-1 text-xs text-center font-medium">
                      {entry.rating}
                    </div>
                  )}
                </div>
              ))}
              {entries.length > 2 && (
                <div className="absolute bottom-0 right-0 bg-background/80 backdrop-blur-sm px-1 rounded-tl-lg text-xs font-medium">
                  +{entries.length - 2}
                </div>
              )}
            </div>
          )}
          <div className={`absolute top-1 left-1 text-xs ${hasEntries ? 'text-background font-medium' : ''}`}>
            {date.getDate()}
          </div>
        </div>

        {hoveredDate?.toDateString() === date.toDateString() && entries.length > 0 && (
          <div className="absolute z-50 w-64 p-3 bg-background/95 backdrop-blur-sm border border-border/50 rounded-xl shadow-xl">
            <div className="text-sm font-medium mb-2 border-b pb-1">
              {format(date, 'MMMM d, yyyy')}
            </div>
            <div className="space-y-2">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2">
                  <div className="w-8 h-12 relative flex-shrink-0">
                    <Image
                      src={entry.coverImage || "/placeholder.svg"}
                      alt={entry.title}
                      fill
                      sizes="32px"
                      className="object-cover rounded-lg shadow-sm"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{entry.title}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      {entry.type === "movie" && <Film className="h-3 w-3" />}
                      {entry.type === "book" && <BookOpen className="h-3 w-3" />}
                      {entry.type === "tv" && <Tv className="h-3 w-3" />}
                      <span className="capitalize">{entry.type}</span>
                      {entry.rating ? <span>{entry.rating}</span> : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card className="border-0 rounded-xl shadow-[0_8px_20px_-8px_rgba(0,0,0,0.12)]">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-xl font-semibold tracking-tight">Media Calendar</CardTitle>
        <Select value={selectedMediaType} onValueChange={(v) => onMediaTypeChange(v as MediaType | 'all')}>
          <SelectTrigger className="w-[120px] h-9 border border-border/50 rounded-lg">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="movie">Movies</SelectItem>
            <SelectItem value="tv">TV Shows</SelectItem>
            <SelectItem value="book">Books</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-accent rounded-lg transition-colors" onClick={() => navigateMonth('prev')}>
              <ChevronLeft className="h-5 w-5 text-muted-foreground" />
            </button>
            <span className="text-xl font-semibold tracking-tight">{formatYearMonth(currentMonth)}</span>
            <button className="p-2 hover:bg-accent rounded-lg transition-colors" onClick={() => navigateMonth('next')}>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
          <Button variant="outline" size="sm"
            className="border border-border/50 shadow-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => setCurrentMonth(new Date())}>
            Today
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center mb-4">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="text-sm font-medium text-muted-foreground">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 text-sm">
          {Array.from({ length: 35 }, (_, i) => {
            const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
            const startDay = firstDay.getDay()
            const day = i - startDay + 1
            const currentDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)
            const isCurrentMonth = currentDate.getMonth() === currentMonth.getMonth()

            return isCurrentMonth ? renderCalendarCell(currentDate) : (
              <div key={i} className="aspect-square p-1">
                <div className="relative w-full h-full opacity-30">
                  <div className="absolute top-1 left-1 text-xs text-muted-foreground">
                    {day > 0 ? day : day + new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0).getDate()}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
