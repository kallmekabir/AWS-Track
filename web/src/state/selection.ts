// The selected person, shared by the ranked list, the map pins and the details panel.
import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from 'react'

interface Selection {
  selectedId: string | null
  select: (id: string | null) => void
}

const SelectionContext = createContext<Selection>({ selectedId: null, select: () => {} })

export function SelectionProvider({ children }: { children: ReactNode }) {
  // ?select=r-002 opens that person's details on load (handy for screenshots and rehearsals).
  const [selectedId, select] = useState<string | null>(() => new URLSearchParams(window.location.search).get('select'))
  const value = useMemo(() => ({ selectedId, select }), [selectedId])
  return createElement(SelectionContext.Provider, { value }, children)
}

export function useSelection(): Selection {
  return useContext(SelectionContext)
}
