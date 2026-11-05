# Convenções de Execução de Tarefas

Regras para executar as tarefas da spec em `.kiro/specs/ni-doc-mvp/tasks.md`.
Aplicam-se a toda sessão de chat deste workspace.

## Uma tarefa por sessão de chat

Cada tarefa da spec é executada em uma **sessão de chat nova e isolada**. Não
encadeie duas tarefas na mesma sessão: ao concluir uma tarefa, pare e aguarde o
usuário abrir uma nova sessão para a próxima.

- A abertura de uma nova sessão é uma ação do usuário no IDE — o agente não
  cria sessões. Ao terminar uma tarefa, encerre deixando claro qual é a próxima
  tarefa e peça para o usuário iniciá-la em uma nova sessão.
- Dentro de uma sessão, trabalhe apenas na tarefa solicitada. Não adiante
  tarefas seguintes nem toque em arquivos fora do escopo dela.

## Fechar a tarefa ao concluir

Assim que uma tarefa for concluída e verificada (testes passando, build e lint
limpos), marque o item correspondente em `.kiro/specs/ni-doc-mvp/tasks.md`,
mudando `[~]` (ou `[ ]`) para `[x]`. Faça isso automaticamente, sem esperar um
pedido explícito do usuário.

- Só marque `[x]` quando o DoD da tarefa estiver satisfeito e a verificação
  tiver passado. Se algo ficou pendente, mantenha `[~]` e explique o que falta.
- Marque exatamente a tarefa executada; não altere o estado de outras tarefas.

## Delegação via workflow

A execução de uma tarefa segue a orientação de orquestração do projeto: o
trabalho substantivo (ler código, implementar, testar, revisar) é delegado a um
workflow, enquanto a sessão principal permanece leve. Ao concluir, reporte o
resultado, feche a tarefa em `tasks.md` e indique a próxima.
