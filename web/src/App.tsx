import { Dashboard } from './layout/Dashboard'
import { SelectionProvider } from './state/selection'

export default function App() {
  return (
    <SelectionProvider>
      <Dashboard />
    </SelectionProvider>
  )
}
