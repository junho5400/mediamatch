"use client"

import { useState } from "react"
import { Bot, X } from "lucide-react"
import ChatbotWindow from "./ChatbotWindow"

export default function ChatbotLauncher() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        aria-label={isOpen ? "Close chatbot" : "Open chatbot"}
        className="group fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/40 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 flex items-center justify-center"
        onClick={() => setIsOpen((v) => !v)}
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Bot className="h-6 w-6 group-hover:scale-110 transition-transform" strokeWidth={2.25} />
        )}
      </button>

      {isOpen && (
        <ChatbotWindow onClose={() => setIsOpen(false)} />
      )}
    </>
  )
}