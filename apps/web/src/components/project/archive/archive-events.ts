import { useEffect } from 'react'

export const ARCHIVE_CHANGED_EVENT = 'aeon:board-archive-changed'

export const ARCHIVE_EXPLAINER = "Hides this board from everyone's dashboard and from Vorath; you can restore it any time."

export const ARCHIVE_OWNER_ONLY = 'Only the person who created this board can archive it.'

/** Lets the dashboard, the sidebar's archived list and the board banner refresh after any archive or restore. */
export function announceArchiveChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ARCHIVE_CHANGED_EVENT))
}

export function useOnArchiveChange(onChange: () => unknown) {
  useEffect(() => {
    const handle = () => { Promise.resolve(onChange()).catch(() => {}) }
    window.addEventListener(ARCHIVE_CHANGED_EVENT, handle)
    return () => window.removeEventListener(ARCHIVE_CHANGED_EVENT, handle)
  }, [onChange])
}
