"use client"

import Image from "next/image"
import { Star } from "lucide-react"
import { useRouter } from "next/navigation"

interface MediaCardProps {
  media: {
    id: string
    title: string
    type: "movie" | "book" | "tv" | "series"
    coverImage?: string
    year?: string
    rating?: number
  }
  size?: "default" | "large"
}

export default function MediaCard({ media, size = "default" }: MediaCardProps) {
  const router = useRouter()
  const w = size === "large" ? "w-[200px]" : "w-[154px]"

  return (
    <div className={`group ${w} shrink-0 cursor-pointer`}
      onClick={() => router.push(`/media/${media.id}`)}>
      {/* Poster */}
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-muted
                      ring-1 ring-border group-hover:ring-primary/40
                      shadow-md group-hover:shadow-xl group-hover:shadow-primary/10
                      transition-all duration-200 group-hover:scale-[1.03]">
        <Image
          src={media.coverImage || "/placeholder.svg"}
          alt={media.title}
          fill
          className="object-cover"
          sizes={size === "large" ? "200px" : "154px"}
        />
        {/* Hover overlay with rating */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-200 flex items-end p-2.5">
          {media.rating && media.rating > 0 && (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200
                            bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 flex items-center gap-1">
              <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
              <span className="text-[11px] font-medium text-white">{media.rating.toFixed(1)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="mt-2 px-0.5">
        <h3 className="text-[13px] font-medium leading-snug line-clamp-1 text-foreground/90
                        group-hover:text-primary transition-colors">
          {media.title}
        </h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {media.year || ""}
        </p>
      </div>
    </div>
  )
}
