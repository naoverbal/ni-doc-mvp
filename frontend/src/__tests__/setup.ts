import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Limpa o DOM renderizado entre os testes para evitar vazamento de estado.
afterEach(() => {
  cleanup()
})
