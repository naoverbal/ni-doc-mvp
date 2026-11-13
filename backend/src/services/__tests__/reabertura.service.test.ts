import type { Mock } from 'vitest'
import { eventoAuditoriaDe } from '../../__tests__/auditoria-teste.js'
import { describe, it, expect, vi } from 'vitest'
import { criarReaberturaService } from '../reabertura.service.js'
import { criarConfirmacaoSenha } from '../confirmacao-senha.js'
import { hashSenha } from '../../lib/senha.js'
import type {
  OrcamentoComItens,
  OrcamentoRepository,
} from '../../repositories/orcamento.repository.js'
import type { UsuarioRepository } from '../../repositories/usuario.repository.js'
import type { AuditoriaService } from '../auditoria.service.js'

const ctx = { tenantId: 'tenant-1', usuarioId: 'user-1', ip: '1.2.3.4', userAgent: 'UA' }

function orcamento(status: OrcamentoComItens['status']): OrcamentoComItens {
  return { id: 'orc-1', tenantId: 'tenant-1', status } as OrcamentoComItens
}

async function montar(opcoes: { existente?: OrcamentoComItens | null } = {}) {
  const senhaHash = await hashSenha('senha-certa')
  const orcamentoRepo = {
    buscarPorId: vi
      .fn()
      .mockResolvedValueOnce(
        opcoes.existente === undefined ? orcamento('reprovado') : opcoes.existente,
      )
      .mockResolvedValue(orcamento('rascunho')),
    reabrir: vi.fn().mockResolvedValue({ statusAnterior: 'reprovado' }),
  } as unknown as OrcamentoRepository
  const usuarioRepo = {
    buscarSenhaHashPorId: vi.fn().mockResolvedValue(senhaHash),
  } as unknown as UsuarioRepository
  const auditoriaService = {
    registrar: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditoriaService
  const confirmacaoSenha = criarConfirmacaoSenha({ usuarioRepo, auditoriaService })
  const service = criarReaberturaService({ orcamentoRepo, confirmacaoSenha })
  return { service, orcamentoRepo, auditoriaService }
}

describe('ReaberturaService', () => {
  it('reabre, audita com a justificativa aparada e devolve o orçamento relido', async () => {
    const { service, orcamentoRepo } = await montar()

    const resultado = await service.reabrir(ctx, 'orc-1', {
      senha: 'senha-certa',
      justificativa: '  Cliente voltou  ',
    })

    expect(resultado.status).toBe('rascunho')
    expect(orcamentoRepo.reabrir).toHaveBeenCalledWith('tenant-1', 'orc-1', expect.any(Function))
    // Auditoria entregue ao repositório (gravada na mesma transação da reabertura).
    expect(
      eventoAuditoriaDe(orcamentoRepo.reabrir as Mock, { statusAnterior: 'reprovado' }),
    ).toMatchObject({
      acao: 'reabrir',
      estadoAnterior: { status: 'reprovado' },
      estadoNovo: { status: 'rascunho', justificativa: 'Cliente voltou' },
    })
  })

  it('responde 400 sem justificativa, antes de qualquer consulta', async () => {
    const { service, orcamentoRepo } = await montar()
    await expect(
      service.reabrir(ctx, 'orc-1', { senha: 'senha-certa', justificativa: '   ' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(orcamentoRepo.buscarPorId).not.toHaveBeenCalled()
  })

  it('responde 404 quando o orçamento não existe no tenant', async () => {
    const { service, orcamentoRepo } = await montar({ existente: null })
    await expect(
      service.reabrir(ctx, 'orc-1', { senha: 'senha-certa', justificativa: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(orcamentoRepo.reabrir).not.toHaveBeenCalled()
  })

  it('responde 403 com senha errada, audita a tentativa e não reabre', async () => {
    const { service, orcamentoRepo, auditoriaService } = await montar()
    await expect(
      service.reabrir(ctx, 'orc-1', { senha: 'errada', justificativa: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(orcamentoRepo.reabrir).not.toHaveBeenCalled()
    expect(auditoriaService.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'reabrir_senha_invalida' }),
    )
    expect(JSON.stringify(vi.mocked(auditoriaService.registrar).mock.calls)).not.toContain('errada')
  })
})
