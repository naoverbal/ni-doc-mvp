import rateLimit from 'express-rate-limit'

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
})

export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 100,
  message: { erro: 'Muitas requisições.' },
  standardHeaders: true,
  legacyHeaders: false,
})
