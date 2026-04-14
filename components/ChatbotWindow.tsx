"use client"

import { useEffect, useRef, useState } from "react"
import { X, Trash2, Sparkles, SendHorizonal, Bot } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/lib/authContext"
import { getUserMediaEntries } from "@/lib/firebase/firestore"
import { MediaEntry } from "@/types/database"
import { auth } from "@/lib/firebase/firebase"

type Message = { role: "user" | "bot"; text: string }

const STORAGE_KEY = "mediamatch_chat_history"

const SUGGESTED_PROMPTS = [
  "What should I watch tonight?",
  "Recommend me a book like The Martian",
  "What are some must-watch classic films?",
  "Suggest a TV series for a rainy weekend",
]

export default function ChatbotWindow({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return []
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? (JSON.parse(stored) as Message[]) : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()
  const [mediaLog, setMediaLog] = useState<MediaEntry[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch {
      // Storage quota exceeded or unavailable — fail silently
    }
  }, [messages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  useEffect(() => {
    const fetchMediaLog = async () => {
      if (!user?.uid) return
      const entries = await getUserMediaEntries(user.uid)
      setMediaLog(entries)
    }
    fetchMediaLog()
  }, [user?.uid])

  const clearConversation = () => {
    setMessages([])
    setError(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  const sendMessage = async (text?: string) => {
    const userMessage = (text ?? input).trim()
    if (!userMessage || !user?.uid) return

    setError(null)
    setMessages((prev) => [...prev, { role: "user", text: userMessage }])
    setInput("")
    setIsLoading(true)

    try {
      const token = await auth.currentUser?.getIdToken()
      const res = await fetch("/api/chatbot", {
        method: "POST",
        body: JSON.stringify({ message: userMessage, mediaLog }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData?.error ?? `Server error (${res.status})`)
      }

      const data = await res.json()
      setMessages((prev) => [...prev, { role: "bot", text: data.reply }])
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong."
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="fixed bottom-24 right-6 w-[400px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-8rem)] bg-card border border-border/80 shadow-2xl shadow-black/20 rounded-2xl z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="relative h-9 w-9 rounded-full bg-primary text-primary-foreground ring-1 ring-primary/40 flex items-center justify-center shadow-sm shadow-primary/20">
            <Bot className="h-5 w-5" strokeWidth={2.25} />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
          </div>
          <div className="flex flex-col leading-tight">
            <h4 className="text-sm font-semibold tracking-tight">MediaMatch Assistant</h4>
            <p className="text-[11px] text-muted-foreground">Online · Powered by Gemini</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {!isEmpty && (
            <button
              onClick={clearConversation}
              title="Clear conversation"
              aria-label="Clear conversation"
              className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Message area */}
      <div className="flex-1 px-4 py-4 space-y-3 overflow-y-auto">
        {isEmpty ? (
          <div className="h-full flex flex-col justify-center space-y-5">
            <div className="text-center space-y-1.5">
              <div className="mx-auto h-11 w-11 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <h5 className="text-sm font-semibold">How can I help?</h5>
              <p className="text-xs text-muted-foreground px-4">
                Ask for recommendations, compare titles, or get insights about your taste.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground px-0.5">
                Suggested
              </p>
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="group text-left text-xs border border-border/70 bg-background/50 rounded-lg px-3 py-2.5 hover:border-primary/50 hover:bg-muted/60 transition-all text-foreground/80 hover:text-foreground flex items-center gap-2"
                >
                  <span className="flex-1">{prompt}</span>
                  <SendHorizonal className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isUser = msg.role === "user"
            return (
              <div
                key={i}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && (
                  <div className="mr-2 mt-0.5 h-6 w-6 shrink-0 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-primary" strokeWidth={2.25} />
                  </div>
                )}
                <span
                  className={`inline-block max-w-[78%] text-sm leading-relaxed px-3.5 py-2 ${
                    isUser
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md whitespace-pre-wrap"
                      : "bg-muted text-foreground rounded-2xl rounded-bl-md"
                  }`}
                >
                  {isUser ? (
                    msg.text
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:my-2 prose-strong:text-foreground prose-a:text-primary">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  )}
                </span>
              </div>
            )
          })
        )}
        {isLoading && (
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 shrink-0 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-primary" strokeWidth={2.25} />
            </div>
            <div className="bg-muted rounded-2xl rounded-bl-md px-3.5 py-2.5 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
        {error && !isLoading && (
          <div className="mx-auto max-w-[90%] text-center text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-border/60">
        <div className="relative flex items-end rounded-xl border border-border/80 bg-background focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15 transition-all">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            rows={1}
            placeholder="Message MediaMatch…"
            className="flex-1 min-h-[44px] max-h-32 resize-none border-0 bg-transparent px-3.5 py-3 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !input.trim()}
            aria-label="Send message"
            className="m-1.5 h-8 w-8 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
