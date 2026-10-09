import { useId, useState, type ReactElement } from 'react'
import { useParams } from 'react-router-dom'
import {
  useAprovarPublico,
  usePublicoOrcamento,
  useReprovarPublico,
} from '@/hooks/usePublicoOrcamento'
import type { OrcamentoSnapshotPublico, SnapshotPublicoItem } from '@/types/api'

// -----------------------------------------------------------------------------
// Página pública de aprovação (RF-019). Acessada pelo CLIENTE FINAL via o link
// com token (uuid.hmac), em qualquer dispositivo, SEM autenticação. Exibe o
// orçamento em modo leitura (snapshot imutável + PDF embutido), um selo de
// integridade e os controles de decisão (aprovar com aceite explícito via
// checkbox, ou reprovar).
//
// Acessibilidade (WCAG AA): toda a tela vive em um <main> com hierarquia de
// títulos coerente; o PDF embutido tem título/alternativa textual e link para
// abrir/baixar; o checkbox tem <label> associado; os botões têm nome acessível
// e não dependem só de cor; o resultado (sucesso/erro/comprovante) é anunciado
// via aria-live; o fluxo é operável só por teclado com foco visível.
// -----------------------------------------------------------------------------

// Mensagem genérica para token inválido/expirado (RF-019.7): não revela se o
// orçamento existe nem o motivo exato.
const MENSAGEM_ERRO_ACESSO =
  'Não foi possível acessar este orçamento. O link pode ser inválido ou ter expirado.'

// Formata um valor em Real (pt-BR).
function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Formata uma data ISO (YYYY-MM-DD) para o padrão pt-BR, sem depender de fuso.
function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  if (ano && mes && dia) return `${dia}/${mes}/${ano}`
  return iso
}

// Linha de item do orçamento em modo leitura.
function LinhaItem({ item }: { item: SnapshotPublicoItem }): ReactElement {
  return (
    <tr>
      <th scope="row">{item.nome}</th>
      <td>{item.descricao ?? '—'}</td>
      <td>
        {item.quantidade} {item.unidade}
      </td>
      <td>{formatarMoeda(item.valor_unitario)}</td>
      <td>{formatarMoeda(item.total)}</td>
    </tr>
  )
}

// Tabela de itens do orçamento (semântica, com cabeçalhos de coluna e de linha).
function TabelaItens({ snapshot }: { snapshot: OrcamentoSnapshotPublico }): ReactElement {
  return (
    <table>
      <caption>Itens do orçamento</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Descrição</th>
          <th scope="col">Quantidade</th>
          <th scope="col">Valor unitário</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.itens.map((item) => (
          <LinhaItem key={item.ordem} item={item} />
        ))}
      </tbody>
    </table>
  )
}

export function PublicoOrcamento(): ReactElement {
  const { token } = useParams<{ token: string }>()

  const { data, isLoading, isError } = usePublicoOrcamento(token)
  const aprovar = useAprovarPublico(token)
  const reprovar = useReprovarPublico(token)

  // Aceite explícito (RF-019.4): só habilita "Aprovar" com o checkbox marcado.
  const [aceiteConfirmado, setAceiteConfirmado] = useState(false)
  const aceiteId = useId()

  // Carregamento: anunciado por leitores de tela (aria-live).
  if (isLoading) {
    return (
      <main>
        <p role="status" aria-live="polite">
          Carregando orçamento…
        </p>
      </main>
    )
  }

  // Token inválido/expirado (RF-019.7): mensagem genérica de erro.
  if (isError || !data) {
    return (
      <main>
        <h1>Orçamento</h1>
        <p role="alert">{MENSAGEM_ERRO_ACESSO}</p>
      </main>
    )
  }

  const { numero, versao, snapshot, integro, pdfUrl } = data

  // Decisão já registrada nesta sessão: a mutation que concluiu com sucesso.
  const decisao = aprovar.isSuccess ? aprovar.data : reprovar.isSuccess ? reprovar.data : null
  const foiAprovado = aprovar.isSuccess
  const foiReprovado = reprovar.isSuccess
  const decidido = foiAprovado || foiReprovado

  const processando = aprovar.isPending || reprovar.isPending
  const houveErroDecisao = aprovar.isError || reprovar.isError

  return (
    <main>
      <h1>Orçamento {numero}</h1>
      <p>Versão {versao}</p>

      {/* Selo de integridade (RF-019.2): rótulo textual, nunca só por cor. */}
      <p data-integridade={integro ? 'integro' : 'nao-verificavel'}>
        {integro ? 'Documento íntegro' : 'Integridade não verificável'}
      </p>

      <section aria-labelledby={`${aceiteId}-dados`}>
        <h2 id={`${aceiteId}-dados`}>Dados do orçamento</h2>
        <p>Cliente: {snapshot.cliente.nome}</p>
        <p>Documento: {snapshot.cliente.documento}</p>
        <p>Data de emissão: {formatarData(snapshot.data_emissao)}</p>
        <p>Validade: {snapshot.validade_dias} dias</p>
        {snapshot.condicoes_pagamento && (
          <p>Condições de pagamento: {snapshot.condicoes_pagamento}</p>
        )}
      </section>

      <section aria-label="Itens do orçamento">
        <TabelaItens snapshot={snapshot} />
        <p>Subtotal: {formatarMoeda(snapshot.subtotal)}</p>
        <p>Total: {formatarMoeda(snapshot.total)}</p>
      </section>

      {/* Documento oficial (PDF): embutido com título/alternativa textual e link
          para abrir/baixar em nova aba. Só quando há PDF emitido. */}
      {pdfUrl && (
        <section aria-label="Documento do orçamento">
          <h2>Documento</h2>
          <iframe src={pdfUrl} title="Documento do orçamento em PDF" width="100%" height="600">
            Seu navegador não consegue exibir o PDF embutido.
          </iframe>
          <p>
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
              Abrir o documento do orçamento em uma nova aba
            </a>
          </p>
        </section>
      )}

      {/* Decisão: aprovar (com aceite explícito) ou reprovar. Oculta após decidir. */}
      {!decidido && (
        <section aria-label="Decisão do orçamento">
          <h2>Decisão</h2>

          <div>
            <input
              id={aceiteId}
              type="checkbox"
              checked={aceiteConfirmado}
              onChange={(evento) => setAceiteConfirmado(evento.target.checked)}
              disabled={processando}
            />
            <label htmlFor={aceiteId}>
              Li e concordo com os termos deste orçamento e aceito o seu conteúdo
            </label>
          </div>

          <div>
            <button
              type="button"
              data-acao="aprovar"
              onClick={() => aprovar.mutate()}
              disabled={!aceiteConfirmado || processando}
            >
              {aprovar.isPending ? 'Aprovando…' : 'Aprovar'}
            </button>{' '}
            <button
              type="button"
              data-acao="reprovar"
              onClick={() => reprovar.mutate({})}
              disabled={processando}
            >
              {reprovar.isPending ? 'Reprovando…' : 'Reprovar'}
            </button>
          </div>

          {/* Erro da decisão: anunciado imediatamente por leitores de tela. */}
          {houveErroDecisao && (
            <p role="alert" aria-live="assertive">
              Não foi possível registrar sua decisão. Tente novamente.
            </p>
          )}
        </section>
      )}

      {/* Resultado da decisão (sucesso/comprovante): anunciado via aria-live. */}
      {decidido && (
        <section aria-label="Resultado">
          <p role="status" aria-live="polite">
            {foiAprovado
              ? 'Orçamento aprovado com sucesso. Obrigado!'
              : 'Orçamento reprovado. Sua resposta foi registrada.'}
          </p>
          {foiAprovado && decisao?.comprovantePdfPath && (
            <p>
              <a href={decisao.comprovantePdfPath} target="_blank" rel="noopener noreferrer">
                Baixar o comprovante de aceite em PDF
              </a>
            </p>
          )}
        </section>
      )}
    </main>
  )
}
