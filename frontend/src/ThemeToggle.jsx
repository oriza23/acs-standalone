import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { applyTheme } from './theme.js'

function ThemeToggle({ tone = 'sidebar', className = '' }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  function handleToggle() {
    const next = !dark
    setDark(next)
    applyTheme(next ? 'dark' : 'light')
  }

  const toneClass = tone === 'surface'
    ? 'border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
    : 'border-white/15 bg-white/10 text-white hover:bg-white/20'

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={dark}
      aria-label={dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
      title={dark ? 'Mode terang' : 'Mode gelap'}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors duration-300 ${toneClass} ${className}`}
    >
      {dark ? <Sun size={18} strokeWidth={2.2} /> : <Moon size={18} strokeWidth={2.2} />}
      <span>{dark ? 'Terang' : 'Gelap'}</span>
    </button>
  )
}

export default ThemeToggle
