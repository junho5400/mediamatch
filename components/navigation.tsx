"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { PlusCircle, User, LogOut, Sun, Moon, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/authContext"
import { signOut } from "@/lib/firebase/firebase"
import { useTheme } from "next-themes"
import SearchOverlay from "@/components/search-overlay"
import LogMediaDialog from "@/components/log-media-dialog"

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const { theme, setTheme } = useTheme()
  const [searchOpen, setSearchOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  // Global keyboard shortcut: Cmd/Ctrl+K or "/" opens the search overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key === "/" && !inField) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  if (pathname === "/login") return null

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-background/70 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1400px] mx-auto flex h-12 items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="font-bold text-base tracking-tight shrink-0">MediaMatch</Link>

          {user && !loading && (
            <div className="flex-1 flex justify-center px-8">
              <button onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground h-8 px-4 rounded-full bg-muted/50 border border-border/50 w-full max-w-[280px] transition-colors">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[13px]">Search...</span>
                <kbd className="ml-auto text-[10px] text-muted-foreground/40 hidden sm:inline">⌘K</kbd>
              </button>
            </div>
          )}

          {loading ? <div className="h-7 w-7 rounded-full shimmer" /> : user ? (
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setLogOpen(true)}
              >
                <PlusCircle className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Log</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                <Sun className="h-3.5 w-3.5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-3.5 w-3.5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 p-0">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={user.photoURL || ""} />
                      <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-bold">{user.displayName?.charAt(0) || "U"}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem asChild className="cursor-pointer text-xs">
                    <Link href={`/profile/${user.uid}`}><User className="mr-2 h-3.5 w-3.5" />Profile</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={async () => { await signOut(); router.push("/login") }}
                    className="cursor-pointer text-xs text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-3.5 w-3.5" />Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      </header>
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <LogMediaDialog open={logOpen} onOpenChange={setLogOpen} />
    </>
  )
}
