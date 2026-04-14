"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import AddMediaForm from "@/components/add-media-form"

interface LogMediaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-select a media item (e.g. when opened from a media detail page). */
  prefilledMediaId?: string | null
}

export default function LogMediaDialog({
  open,
  onOpenChange,
  prefilledMediaId,
}: LogMediaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto p-8">
        <DialogHeader className="space-y-1.5 mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Log media
          </p>
          <DialogTitle className="text-2xl font-bold tracking-tight">What did you watch or read?</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Adds an entry to your library and updates your taste vector.
          </DialogDescription>
        </DialogHeader>
        <AddMediaForm
          prefilledMediaId={prefilledMediaId}
          onSuccess={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
