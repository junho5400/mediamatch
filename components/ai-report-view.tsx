"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ChevronDown, ArrowLeft } from "lucide-react"
import { UserProfile } from "@/types/database"
import { AIReport, MBTITrait } from "@/types/ai-report"

interface AIReportViewProps {
  profile: UserProfile
  report: AIReport
}

function formatDate(d: unknown): string {
  if (!d) return ""
  let date: Date | null = null
  if (d instanceof Date) date = d
  else if (typeof d === "object" && d !== null && "toDate" in d) {
    date = (d as { toDate: () => Date }).toDate()
  } else if (typeof d === "object" && d !== null && "_seconds" in d) {
    // Firestore Timestamp serialized to JSON: { _seconds, _nanoseconds }
    date = new Date((d as { _seconds: number })._seconds * 1000)
  } else if (typeof d === "object" && d !== null && "seconds" in d) {
    date = new Date((d as { seconds: number }).seconds * 1000)
  } else if (typeof d === "string" || typeof d === "number") {
    const parsed = new Date(d)
    if (!isNaN(parsed.getTime())) date = parsed
  }
  if (!date || isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

export default function AIReportView({ profile, report }: AIReportViewProps) {
  const router = useRouter()
  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-24">
      {/* ── Back ── */}
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors mb-10"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to profile
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-12 lg:gap-16">

        {/* ══ Sticky profile card ══ */}
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
          <div>
            {profile.photoURL ? (
              <div className="relative h-20 w-20 rounded-full overflow-hidden">
                <Image src={profile.photoURL} alt={profile.displayName} fill className="object-cover" sizes="80px" />
              </div>
            ) : (
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground">
                {profile.displayName?.charAt(0) || "?"}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">{profile.displayName}</h2>
            {profile.createdAt && (
              <p className="text-[11px] text-muted-foreground">Since {formatDate(profile.createdAt)}</p>
            )}
          </div>

          <div className="border-t border-border/60 pt-4 space-y-3">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Rated</span>
              <span className="font-semibold tabular-nums">{profile.stats?.totalRatings ?? 0}</span>
            </div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Avg</span>
              <span className="font-semibold tabular-nums">
                {(profile.stats?.averageRating ?? 0).toFixed(1)}
                <span className="text-muted-foreground/60 font-normal">/5</span>
              </span>
            </div>
          </div>

          {/* Favorites */}
          {profile.favoriteMedia && (
            <div className="border-t border-border/60 pt-4 space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">Favorites</p>
              <div className="grid grid-cols-3 gap-2">
                {(["movie", "tv", "book"] as const).map(type => {
                  const fav = profile.favoriteMedia?.[type]
                  if (!fav?.coverImage) {
                    return (
                      <div key={type} className="aspect-[2/3] rounded-sm bg-muted/60" />
                    )
                  }
                  return (
                    <div key={type} className="relative aspect-[2/3] rounded-sm overflow-hidden">
                      <Image src={fav.coverImage} alt={fav.title} fill className="object-cover" sizes="80px" />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </aside>

        {/* ══ Right column: report ══ */}
        <main>
          {/* ── Hero ── */}
          <header className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Media DNA
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
              {report.personaName}
            </h1>
            <p className="max-w-2xl text-base text-foreground/65 italic leading-relaxed">
              &ldquo;{report.tagline}&rdquo;
            </p>
            {report.personaDetails?.tags?.length ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
                {report.personaDetails.tags.map((tag, i) => (
                  <span key={tag} className="flex items-center gap-3">
                    {i > 0 && <span className="text-border">·</span>}
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </header>

          {/* ── Genres + Personality side-by-side ── */}
          <section className="border-t border-border/60 mt-12 pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-5">
                  Genres
                </p>
                <GenreList genres={report.genres} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-5">
                  Personality
                </p>
                <div className="space-y-7">
                  {(report.mediaPersonality || []).map(trait => (
                    <TraitAxis key={trait.name} {...trait} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── Analysis (collapsible) ── */}
          <Analysis text={report.insightText} />
        </main>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────── */

function GenreList({ genres }: { genres: { name: string; percentage: number }[] }) {
  if (!genres?.length) {
    return <p className="text-sm text-muted-foreground">No genre data yet.</p>
  }
  const max = Math.max(...genres.map(g => g.percentage), 1)
  return (
    <div className="space-y-3.5">
      {genres.slice(0, 6).map(g => {
        const pct = (g.percentage / max) * 100
        return (
          <div key={g.name}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[13px] font-medium text-foreground">{g.name}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">{g.percentage.toFixed(0)}%</span>
            </div>
            <div className="relative h-px w-full bg-border">
              {/* matte fill */}
              <div
                className="absolute inset-y-0 left-0 bg-foreground/40"
                style={{ width: `${pct}%` }}
              />
              {/* pink tip — only the rightmost edge */}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-[3px] w-2 bg-primary"
                style={{ left: `calc(${pct}% - 8px)` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────── */

function TraitAxis({ left, right, value, name }: MBTITrait) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] mb-2.5">
        <span className="text-muted-foreground">{left}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">{name}</span>
        <span className="text-muted-foreground">{right}</span>
      </div>
      <div className="relative h-px w-full bg-border">
        {/* center tick */}
        <span aria-hidden className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-px bg-border" />
        <div
          className="absolute top-1/2 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
          style={{ left: `${clamped}%`, transform: "translate(-50%, -50%)" }}
          aria-hidden
        />
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────── */

function Analysis({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="border-t border-border/60 mt-12 pt-6">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="group w-full flex items-center justify-between text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground group-hover:text-foreground transition-colors">
          Analysis
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-500 ease-out ${
          open ? "grid-rows-[1fr] mt-5" : "grid-rows-[0fr] mt-0"
        }`}
      >
        <div className="overflow-hidden">
          <p className="text-[14px] leading-[1.78] text-foreground/85 whitespace-pre-line max-w-2xl">
            {text}
          </p>
        </div>
      </div>
    </section>
  )
}
