import { useEffect, useState } from 'react'

interface UseConnectModeProps {
  connectMode: boolean | undefined
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onConnectModeChange?: (v: boolean) => void
}

export function useConnectMode({ connectMode, onAddDependency, onConnectModeChange }: UseConnectModeProps) {
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!connectMode) setConnectSourceId(null)
  }, [connectMode])

  useEffect(() => {
    if (!connectMode) return
    const onMove = (e: MouseEvent) => setCursorPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [connectMode])

  const handleConnectClick = (taskId: string, fallback: (id: string) => void) => {
    if (!connectMode) {
      fallback(taskId)
      return
    }
    if (!connectSourceId) {
      setConnectSourceId(taskId)
    } else if (taskId !== connectSourceId) {
      onAddDependency?.(connectSourceId, taskId)
      setConnectSourceId(null)
      onConnectModeChange?.(false)
    }
  }

  const cancelConnect = () => {
    onConnectModeChange?.(false)
    setConnectSourceId(null)
  }

  return { connectSourceId, cursorPos, handleConnectClick, cancelConnect }
}
