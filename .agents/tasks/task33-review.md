# Rota de envio de orçamento (POST /:id/enviar) delegando ao versionamento

O endpoint `POST /api/orcamentos/:id/enviar` versiona e envia um rascunho
delegando ao `versionamentoService.enviar(ctx, id)`. A rota apenas monta o
contexto (tenant/usuário/ip/userAgent) a partir da requisição autenticada,
chama o service e responde `201` com a `VersaoEnviada`. Toda a validação de
regra de negócio (rascunho obrigatório, itens obrigatórios, conflito de status)
vive no service e chega ao cliente como `AppError` tratado pelo `errorHandler`
central — a rota não duplica nenhuma dessas verificações. A factory
`criarOrcamentosRouter` passou a receber `versionamentoService` por argumento
(DI), e `app.ts` compõe o service com todas as suas dependências.

Watch for: nada bloqueante. Uma observação sobre a origem do `pdfPath` nulo
(confirmed) e uma sobre teste de atomicidade ausente no nível de rota
(possible), ambas abaixo.

**Verdict**: APPROVED

## High-level view

A rota segue o padrão em camadas do projeto: `route → service → repository`,
sem middleware `validate` porque não há corpo nem params a validar além do `id`
de URL — a única entrada é o `:id`, consumido diretamente pelo service, que já
responde `404` quando não existe. A delegação é literal: a rota não inspeciona
status nem itens, deixando o service ser a fonte única de verdade das regras
RF-008. Isso satisfaz o critério "não duplica validação".

O wiring em `app.ts` monta `criarVersionamentoService` com os sete deps que ele
exige (`orcamentoRepo`, `orcamentoVersaoRepo`, `clienteRepo`, `empresaRepo`,
`responsavelRepo`, `snapshotService`, `auditoriaService`), reutilizando
instâncias de repo já criadas no escopo da função. Nenhuma dependência nova foi
instanciada de forma redundante.

O `pdfPath`/`pdfHash` nulo não é imposto pela rota nem forçado artificialmente:
o service repassa `versao.pdfPath`/`versao.pdfHash` do repositório, que nascem
nulos porque a geração de PDF é a tarefa 40. O teste de sucesso ancora esse
contrato afirmando `res.body.pdfPath` null.

A cobertura de teste do bloco `POST /:id/enviar` exercita sucesso (201),
rascunho sem itens (400), não-rascunho (409), inexistente (404) e ausência de
autenticação (401, com asserção de que `enviar` não foi chamado). Todos via
mock do `versionamentoService`, consistentes com o estilo dos demais blocos do
arquivo.

A verificação (test/build/lint) foi registrada em `task33-evidence.md` com
todos os comandos retornando exit 0; não reexecutei as suítes.

<details>
<summary>Issues (2)</summary>

1. **Origem do pdfPath nulo** (não-bloqueante) — o nulo vem do repositório de
   versões, não de uma decisão da rota; correto para esta tarefa, mas a tarefa
   40 precisará popular esses campos sem alterar a assinatura da rota. Nenhuma
   ação agora.
2. **Atomicidade não coberta por teste de rota** (não-bloqueante) — os testes
   de rota mockam o service, então a transação atômica (versão + token +
   invalidação de aceite + status→enviado) não é verificada aqui. Isso é
   adequado para teste de rota e deve estar coberto nos testes do service/repo;
   confirmar que existe cobertura de integração daquela transação (fora do
   escopo desta tarefa).

</details>

<details>
<summary>Details</summary>

## Delegação sem duplicação de validação

A rota é propositalmente fina:

```ts
router.post('/:id/enviar', async (req, res, next) => {
  try {
    const ctx = construirContexto(req)
    const id = req.params['id'] as string
    const versao = await versionamentoService.enviar(ctx, id)
    res.status(201).json(versao)
  } catch (err) {
    next(err)
  }
})
```

Não há inspeção de `status`, de `itens`, nem de existência do orçamento — tudo
isso está em `versionamento.service.ts`, que lança `AppError(404)` para
inexistente, `AppError(409)` para não-rascunho e `AppError(400)` para rascunho
sem itens. A rota não repete nenhuma das três checagens, satisfazendo o
critério "delega ao service e não duplica validação". Não há middleware
`validate` porque a única entrada é o `:id` de path, consumido direto pelo
service — adicionar um schema Zod aqui seria cerimônia sem ganho.

## Pdf nulo é herdado, não forçado (confirmed)

O service repassa `versao.pdfPath` e `versao.pdfHash` vindos de
`orcamentoVersaoRepo.criarVersaoEnviar`, que os cria nulos porque a geração de
PDF pertence à tarefa 40. A rota não toca nesses campos. O teste de sucesso
afirma `expect(res.body.pdfPath).toBeNull()`, ancorando o contrato desta
tarefa. Quando a tarefa 40 popular o PDF, o campo deixa de ser nulo sem
qualquer mudança na assinatura da rota — a asserção do teste é que precisará
evoluir.

## Cobertura de teste

O bloco `POST /api/orcamentos/:id/enviar` cobre os quatro caminhos pedidos pelo
critério de aceite mais o 404:

- 201 com a versão criada, afirmando `id`, `versao`, `tokenPublico`, `pdfPath`
  null, e que `enviar` foi chamado com o contexto (tenant/usuário) e o `id`.
- 400 quando o service lança por rascunho sem itens.
- 409 quando o service lança por não-rascunho.
- 404 propagado do service.
- 401 sem cookie `session`, com asserção adicional de que `enviar` **não** foi
  chamado — bom cuidado, porque garante que a autenticação barra antes de
  tocar o service.

Os testes mockam o `versionamentoService`, o que é o nível certo para um teste
de rota: eles verificam que a rota traduz entrada → chamada de service → status
HTTP, não as regras internas do service. A consequência é que a transação
atômica do envio (criar versão, gerar token público único, invalidar aceite
anterior, status→enviado, auditoria) não é exercitada aqui; essa cobertura
pertence aos testes de service/repositório (fora do escopo desta tarefa).

## Verificação consultada

Não reexecutei as suítes. A evidência em `task33-evidence.md` registra o ciclo
TDD (RED: 22 failed | 6 passed antes da impl; GREEN: 28 passed no arquivo e
suíte completa 30 arquivos / 334 testes passando), `npm run build` exit 0,
`npm run lint` exit 0, e `prettier --check` limpo nos três arquivos. Todos com
exit code 0. O escopo do commit `ffd8691` confirma que apenas
`orcamentos.routes.ts`, `app.ts`, o arquivo de teste e o doc de evidência foram
tocados — nenhuma alteração fora do escopo, nenhuma integração de PDF.

</details>

<details>
<summary>File map</summary>

- `backend/src/routes/orcamentos.routes.ts` — novo endpoint `POST /:id/enviar`
  delegando ao versionamento; factory estendida com `versionamentoService`.
- `backend/src/app.ts` — wiring de `criarVersionamentoService` e passagem ao
  router.
- `backend/src/routes/__tests__/orcamentos.routes.test.ts` — bloco de testes do
  envio (201/400/409/404/401) e mock `makeVersionamentoService`.
- `.agents/tasks/task33-evidence.md` — evidência de verificação do coder.

Diff completo: `git show ffd8691`.
</details>
