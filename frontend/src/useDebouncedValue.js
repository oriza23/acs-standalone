import { useEffect, useState } from 'react'

// Menunda nilai (mis. kata kunci pencarian) agar request server-side tidak
// dikirim pada setiap ketukan keyboard.
export default function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
