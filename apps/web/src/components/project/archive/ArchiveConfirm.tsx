'use client'

import { createPortal } from 'react-dom'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { archiveExplainer } from './archive-events'
import { useVorath } from '@/hooks/useVorath'

interface ArchiveConfirmProps {
  boardName: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The one "Archive board?" question, portalled so it never submits a host form
 * and its clicks never reach a host modal's backdrop.
 */
export function ArchiveConfirm({ boardName, onConfirm, onCancel }: ArchiveConfirmProps) {
  const mounted = useHasMounted()
  const explainer = archiveExplainer(useVorath())
  if (!mounted) return null
  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <ConfirmModal
        isOpen={boardName !== null}
        title={boardName ? `Archive "${boardName}"?` : 'Archive board?'}
        message={explainer}
        confirmLabel="Archive"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>,
    document.body
  )
}
