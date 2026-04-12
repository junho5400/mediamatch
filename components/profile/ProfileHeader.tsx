"use client"

import Image from "next/image"
import { BookOpen, Film, Tv } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { RatingDistribution } from "@/components/rating-distribution"
import { MediaItem, MediaType, UserProfile } from "@/types/database"

interface FavoriteMediaCollection {
  book?: { mediaId?: string; title: string; coverImage: string }
  movie?: { mediaId?: string; title: string; coverImage: string }
  tv?: { mediaId?: string; title: string; coverImage: string }
}

interface ProfileHeaderProps {
  profile: UserProfile
  isOwnProfile: boolean
  favoriteMedia: FavoriteMediaCollection
  onEditMedia: (type: keyof FavoriteMediaCollection) => void
}

export default function ProfileHeader({ profile, isOwnProfile, favoriteMedia, onEditMedia }: ProfileHeaderProps) {
  const ratingData = {
    averageRating: profile.stats?.averageRating || 0,
    numberOfRatings: profile.stats?.totalRatings || 0,
    mostFrequent: profile.stats?.ratingDistribution
      ? Object.entries(profile.stats.ratingDistribution)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 0
      : 0,
    distribution: profile.stats?.ratingDistribution || {},
  }

  return (
    <Card className="border-0 rounded-xl shadow-[0_8px_20px_-8px_rgba(0,0,0,0.12)]">
      <CardHeader className="flex flex-col items-center text-center">
        <div className="relative w-32 h-32">
          <Avatar className="w-32 h-32 border-4 border-background shadow-xl">
            <AvatarImage src={profile.photoURL || undefined} />
            <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-3xl font-semibold">
              {profile.displayName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
        </div>
        <CardTitle className="mt-4 text-2xl font-bold">{profile.displayName}</CardTitle>
        <CardDescription className="text-base">@{profile.uid}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-medium mb-3 border-b pb-1">Favorite Media</h3>
            <div className="grid grid-cols-3 gap-4">
              {(['book', 'movie', 'tv'] as const).map((type) => (
                <div key={type} className="text-center">
                  <div
                    className={`relative w-full aspect-[2/3] rounded-xl overflow-hidden mb-2 shadow-md
                      ${isOwnProfile ? 'cursor-pointer hover:opacity-90 transition-all duration-300 group' : ''}
                      ${!favoriteMedia?.[type]?.coverImage ? 'bg-muted' : ''}`}
                    onClick={() => isOwnProfile && onEditMedia(type)}
                  >
                    {favoriteMedia?.[type]?.coverImage && (
                      <>
                        <Image
                          src={favoriteMedia[type]!.coverImage}
                          alt={favoriteMedia[type]!.title}
                          fill
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        {isOwnProfile && (
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent
                                         opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        )}
                      </>
                    )}
                    {isOwnProfile && !favoriteMedia?.[type]?.coverImage && (
                      <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className="h-8 w-8 text-muted-foreground">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <Badge variant="outline"
                      className={`text-xs px-2 py-1 rounded-full
                        ${type === 'movie' ? 'bg-indigo-50 text-indigo-700 border-indigo-200/50 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800/50' :
                        type === 'book' ? 'bg-pink-50 text-pink-700 border-pink-200/50 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800/50' :
                        'bg-purple-50 text-purple-700 border-purple-200/50 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/50'}`}>
                      {type === 'movie' && <Film className="h-3 w-3 mr-1" />}
                      {type === 'book' && <BookOpen className="h-3 w-3 mr-1" />}
                      {type === 'tv' && <Tv className="h-3 w-3 mr-1" />}
                      <span className="font-medium">{type === 'tv' ? 'Series' : type.charAt(0).toUpperCase() + type.slice(1)}</span>
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-base font-medium mb-3 border-b pb-1">Rating Distribution</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-primary/5 rounded-lg border border-primary/10">
                  <div className="text-2xl font-bold text-primary">{ratingData.averageRating.toFixed(1)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Average</div>
                </div>
                <div className="text-center p-3 bg-purple-500/5 rounded-lg border border-purple-500/10">
                  <div className="text-2xl font-bold text-purple-500">{ratingData.numberOfRatings}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total</div>
                </div>
                <div className="text-center p-3 bg-pink-500/5 rounded-lg border border-pink-500/10">
                  <div className="text-2xl font-bold text-pink-500">{ratingData.mostFrequent}</div>
                  <div className="text-xs text-muted-foreground mt-1">Most given</div>
                </div>
              </div>
              <div className="px-2">
                <div className="w-full max-w-lg">
                  <RatingDistribution
                    distribution={ratingData.distribution}
                    totalRatings={Object.values(ratingData.distribution).reduce((a, b) => a + b, 0)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
