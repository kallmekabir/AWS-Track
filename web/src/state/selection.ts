// The selected resident, shared by the priority list, the map, the drawer and the
// copilot's resident links. The call log never sets it (map spec section 8.3).
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface Selection {
  selectedId: string | null
  /** `reveal` scrolls the list and map back into view, for links further down the page. */
  select: (id: string | null, opts?: { reveal?: boolean }) => void
}

const SelectionContext = createContext<Selection>({ selectedId: null, select: () => {} })

export function SelectionProvider({ children }: { children: ReactNode }) {
  // ?select=R-131 preselects a resident (handy for screenshots and rehearsals).
  const [selectedId, setSelectedId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('select'),
  )
  const select = useCallback((id: string | null, opts?: { reveal?: boolean }) => {
    setSelectedId(id)
    if (id && opts?.reveal) {
      document.getElementById('work')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])
  const value = useMemo(() => ({ selectedId, select }), [selectedId, select])
  return createElement(SelectionContext.Provider, { value }, children)
}

export function useSelection(): Selection {
  return useContext(SelectionContext)
}
