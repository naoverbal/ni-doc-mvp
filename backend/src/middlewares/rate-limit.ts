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

/**
 * Cria um rate limiter por USUÁRIO para as rotas que reconfirmam a senha (ex.:
 * cancelar orçamento), impedindo força bruta de senha por elas.
 *
 * Só tentativas com senha errada (403) consomem a cota: respostas de sucesso e
 * outros erros não contam. Deve ser registrado APÓS a autenticação (usa
 * `req.usuario.id` como chave). Store em memória; fábrica para que cada router
 * tenha o seu (sem vazamento de estado entre testes).
 */
export function criarConfirmacaoSenhaRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 5,
    message: { erro: 'Muitas tentativas de confirmação de senha. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.usuario.id,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 403,
  })
}

/**
 * Cria um rate limiter geral para as rotas autenticadas da API (auditoria B-8),
 * por IP (depende de `TRUST_PROXY` correto atrás do Nginx). Contém raspagem e
 * abuso de um cliente autenticado ou de uma sessão roubada. O teto de 300 por
 * minuto acomoda o uso normal da SPA (o dashboard percorre todas as páginas da
 * lista) e usuários que compartilham o IP de um escritório. Login, confirmação
 * de senha e rotas públicas têm limites próprios, mais estritos.
 *
 * Fábrica (não singleton) para que cada app tenha seu store e os testes não
 * vazem contagem entre si.
 */
export function criarApiRateLimit(max = 300): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60 * 1000, // 1 min
    max,
    message: { erro: 'Muitas requisições. Tente novamente em instantes.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
}

/**
 * Cria um rate limiter para as rotas públicas (visualização e aceite via token).
 *
 * São endpoints sem autenticação, expostos ao cliente final — o limite por IP
 * contém abuso/força bruta de token sem atrapalhar o uso legítimo (abrir o link,
 * ver o PDF e aprovar/reprovar). Store em memória; fábrica para que cada router
 * tenha seu próprio store (sem vazamento de estado entre testes).
 */
export function criarPublicoRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 60,
    message: { erro: 'Muitas requisições. Tente novamente mais tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
}
