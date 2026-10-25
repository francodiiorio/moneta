import { useState } from 'react'
import { ONBOARDING_HIDDEN_KEY } from '../service'

function read(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function useOnboardingHidden(): [boolean, () => void] {
  const [hidden, setHidden] = useState(read)
  function hide() {
    try {
      localStorage.setItem(ONBOARDING_HIDDEN_KEY, '1')
    } catch {
      // Storage blocked (private mode): hidden for this visit only.
    }
    setHidden(true)
  }
  return [hidden, hide]
}
