---
inclusion: always
---

# Acessibilidade

Diretrizes de acessibilidade para o ni-doc. Aplicam-se à SPA (React + Vite) e a
qualquer saída HTML renderizada pelo backend (templates de PDF, página pública
de aceite). O alvo é **WCAG 2.1 nível AA**.

> A conformidade total com WCAG exige teste manual com tecnologias assistivas e
> revisão humana especializada. Estas regras cobrem o que é verificável em
> código; elas não substituem essa validação.

## Princípios

- **HTML semântico primeiro.** Use o elemento certo para o papel (`button`,
  `a`, `nav`, `main`, `header`, `ul`/`ol`, `table` com `th`). Só recorra a ARIA
  quando a semântica nativa não cobrir o caso — ARIA corrige, não substitui.
- **Operável por teclado.** Todo fluxo interativo (criar/enviar orçamento,
  aprovar/rejeitar na página pública) funciona sem mouse. Nunca remova o
  indicador de foco; mantenha a ordem de foco lógica e previsível.
- **Perceptível.** Contraste mínimo de 4.5:1 para texto normal e 3:1 para texto
  grande e componentes de interface. Não transmita informação apenas por cor
  (ex.: status de orçamento precisa de rótulo textual, não só de cor).

## Formulários (React Hook Form + Zod)

- Todo campo tem `<label>` associado via `htmlFor`/`id`. Placeholder não é
  rótulo.
- Erros de validação do Zod são anunciados: vincule a mensagem ao campo com
  `aria-describedby` e marque o campo inválido com `aria-invalid`.
- Agrupe campos relacionados em `<fieldset>` com `<legend>`.
- Botão de submit descreve a ação ("Enviar orçamento"), não genérico ("OK").

## Componentes e conteúdo

- **Imagens/ícones:** `alt` descritivo em imagens informativas; `alt=""` (ou
  `aria-hidden`) em decorativas. Ícone-botão sem texto visível recebe
  `aria-label`.
- **Nome acessível:** todo controle interativo tem nome acessível (texto
  visível, `aria-label` ou `aria-labelledby`).
- **Feedback dinâmico:** mensagens de sucesso/erro e estados de carregamento
  usam `aria-live` (`polite` para status, `assertive` para erros) para serem
  anunciados por leitores de tela.
- **Idioma:** `lang="pt-BR"` no `<html>`; o produto é pt-BR.
- **Links:** texto de link é autoexplicativo; evite "clique aqui". A página
  pública de aceite deve ser utilizável por clientes finais em qualquer
  dispositivo.

## Documentos renderizados (PDF/HTML)

- Templates de orçamento preservam estrutura de títulos coerente e contraste
  adequado; não dependa de cor para distinguir seções ou valores.
- QR Code e link público têm alternativa textual equivalente.

## Verificação

- Rode o linter de acessibilidade (`eslint-plugin-jsx-a11y`, quando presente) e
  resolva os avisos antes de concluir uma tarefa de UI.
- Navegue a tela pelo teclado (Tab/Shift+Tab/Enter/Esc) para confirmar foco e
  operação.
- Ao afirmar conformidade, declare o que foi verificado em código e o que ainda
  requer teste manual com tecnologia assistiva.
