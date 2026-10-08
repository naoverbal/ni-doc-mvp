import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit'

/**
 * Cria um rate limiter para o endpoint de login.
 *
 * Store em memória, 5 tentativas por IP a cada 15 minutos. Ao exceder,
 * responde 429 com mensagem clara.
 *
 * É uma fábrica para que cada instância do router crie o seu próprio
 * limiter (store independente), evitando vazamento de estado entre testes.
 */
export function criarLoginRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 5,
    message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
  })
}

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 100,
  message: { erro: 'Muitas requisições.' },
  standardHeaders: true,
  legacyHeaders: false,
})
