# Requirements Document

## Introduction

O **ni-doc** é uma aplicação web server-side para emissão, versionamento, envio e acompanhamento de orçamentos. O sistema permite que operadores de múltiplas empresas (tenants) criem orçamentos, personalizem templates de PDF, enviem propostas a clientes e coletem aprovação via QR Code, mantendo trilha de auditoria completa.

### Objetivos do Produto

- Reduzir o tempo de emissão de orçamentos
- Padronizar a apresentação visual das propostas
- Garantir rastreabilidade e integridade dos documentos emitidos
- Facilitar a aprovação do cliente via canal digital
- Centralizar histórico de versões e aceites

### Fora de Escopo (Fase 1)

- Emissão de nota fiscal (NFe/NFSe)
- Integração com gateway de pagamento
- Assinatura digital com certificado ICP-Brasil
- Aplicativo mobile nativo
- Múltiplos templates por tenant (apenas um global)
- Multi-idioma (apenas pt-BR)

---

## Glossary

| Termo | Definição |
|-------|-----------|
| **Tenant** | Empresa/grupo que usa o sistema para emitir orçamentos. Isolamento lógico dos dados. |
| **Usuário** | Pessoa física que acessa o sistema. Pode ser admin ou operador. |
| **Admin** | Usuário com permissão para gerenciar usuários, template e configurações do tenant. |
| **Operador** | Usuário com permissão para criar, editar e enviar orçamentos. |
| **Cliente Final** | Pessoa ou empresa destinatária do orçamento. Acessa via link público. |
| **Orçamento** | Aggregate root. Documento comercial com itens, valores, versões e aceite. |
| **Versão** | Snapshot imutável de um orçamento no momento do envio. |
| **Rascunho** | Estado inicial de um orçamento, editável livremente, sem versionamento. |
| **Template** | Definição visual (PDF de fundo + placeholders) usada para renderizar o PDF. |
| **Cliente** | Entidade de referência. Destinatário do orçamento (PF ou PJ). |
| **Empresa** | Entidade de referência. Pode ser o tenant emissor ou um cliente PJ. |
| **Responsável Técnico** | Profissional associado a um item do orçamento. |
| **Placeholder** | Chave dinâmica no template (ex: `{cliente}`, `{valor_total}`). |
| **Token Público** | Identificador único e não adivinhável usado no link/QR Code de aprovação. |
| **Hash do Documento** | SHA-256 do PDF gerado, usado para validar integridade. |

---

## Atores e Perfis

| Ator | Descrição | Acesso |
|------|-----------|--------|
| **Admin do Tenant** | Gerencia usuários, template e configurações. | Área logada completa |
| **Operador** | Cria, edita, envia e acompanha orçamentos. | Área logada restrita |
| **Cliente Final** | Aprova ou reprova orçamentos. | Área pública via token |

---

## Requirements

### Módulo 1 — Fundação

#### RF-001 — Autenticação de Usuário

**User Story:** Como operador, quero fazer login com e-mail e senha para acessar o sistema com segurança.

**Critérios de Aceitação:**

1. **Quando** um usuário acessar a página de login, **o sistema deve** exibir formulário com campos de e-mail e senha.
2. **Quando** um usuário submeter credenciais válidas, **o sistema deve** criar uma sessão no servidor e retornar um cookie com flags `HttpOnly`, `Secure` e `SameSite=Lax`.
3. **Quando** um usuário submeter credenciais inválidas, **o sistema deve** retornar mensagem genérica de erro sem revelar qual campo está incorreto.
4. **Quando** um usuário realizar login bem-sucedido, **o sistema deve** registrar o evento na auditoria.
5. **Quando** um usuário realizar logout, **o sistema deve** invalidar a sessão no servidor e limpar o cookie.
6. **Enquanto** um usuário não estiver autenticado, **o sistema deve** redirecionar para login qualquer requisição a rotas privadas.
7. **O sistema deve** aplicar rate limiting no endpoint de login (máximo 5 tentativas por 15 minutos por IP).

---

#### RF-002 — Isolamento Multi-tenant

**User Story:** Como admin, quero que os dados do meu tenant sejam isolados dos demais para garantir privacidade.

**Critérios de Aceitação:**

1. **O sistema deve** associar cada usuário a um `tenant_id` no momento do cadastro.
2. **O sistema deve** aplicar Row-Level Security (RLS) no PostgreSQL em todas as tabelas com `tenant_id`.
3. **Enquanto** um usuário estiver autenticado, **o sistema deve** filtrar automaticamente todas as queries pelo seu `tenant_id`.
4. **Quando** um usuário tentar acessar um recurso de outro tenant, **o sistema deve** retornar erro 404 (não 403, para não revelar a existência do recurso).

---

#### RF-003 — Auditoria

**User Story:** Como admin, quero consultar o histórico de alterações para fins de auditoria e conformidade.

**Critérios de Aceitação:**

1. **O sistema deve** registrar em `eventos_auditoria` toda operação sensível: login, logout, criação/alteração/envio/aceite de orçamento, alteração de template.
2. **O sistema deve** incluir em cada evento: `tenant_id`, `usuario_id`, `acao`, `entidade`, `entidade_id`, `estado_anterior` (JSONB), `estado_novo` (JSONB), `ip`, `user_agent`, `timestamp`.
3. **O sistema deve** permitir consulta de auditoria por admin do tenant, com filtros por entidade, usuário e período.
4. **O sistema deve** manter registros de auditoria por no mínimo 5 anos.

---

#### RF-004 — Criptografia

**User Story:** Como admin, quero que dados sensíveis sejam criptografados para proteger meus clientes.

**Critérios de Aceitação:**

1. **O sistema deve** armazenar senhas usando Argon2id com parâmetros mínimos: memória 64MB, iterações 3, paralelismo 4.
2. **O sistema deve** criptografar CPF/CNPJ, e-mail e telefone usando AES-256-GCM com chave gerenciada em variável de ambiente.
3. **O sistema deve** usar HTTPS/TLS 1.3 obrigatoriamente em produção.
4. **O sistema deve** usar cookies com flags `HttpOnly`, `Secure` e `SameSite=Lax`.

---

### Módulo 2 — Orçamento (Core)

#### RF-005 — Criação de Orçamento

**User Story:** Como operador, quero criar um novo orçamento para iniciar uma proposta comercial.

**Critérios de Aceitação:**

1. **Quando** um operador criar um orçamento, **o sistema deve** gerar um número sequencial por tenant (formato `ORC-{ANO}-{SEQUENCIAL}`).
2. **Quando** um operador criar um orçamento, **o sistema deve** iniciá-lo com status `rascunho`.
3. **Quando** um operador criar um orçamento, **o sistema deve** associar automaticamente `tenant_id` e `usuario_id`.
4. **Quando** um operador criar um orçamento, **o sistema deve** exigir: cliente, título e ao menos um item.
5. **Enquanto** o orçamento estiver em `rascunho`, **o sistema deve** permitir edição irrestrita.
6. **Quando** um operador criar um orçamento, **o sistema deve** registrar o evento na auditoria.

---

#### RF-006 — Itens do Orçamento

**User Story:** Como operador, quero adicionar itens ao orçamento com quantidade, valor e responsável para compor a proposta.

**Critérios de Aceitação:**

1. **Quando** um operador adicionar um item, **o sistema deve** exigir: nome, quantidade e valor unitário.
2. **Quando** um operador adicionar um item, **o sistema deve** permitir associar um Responsável Técnico (opcional).
3. **Quando** um operador adicionar um item, **o sistema deve** permitir desconto por item (percentual ou fixo).
4. **Quando** um operador adicionar um item, **o sistema deve** calcular automaticamente o total do item.
5. **Quando** um operador alterar a quantidade ou valor unitário, **o sistema deve** recalcular o total em tempo real.
6. **Quando** um operador remover um item, **o sistema deve** recalcular os totais.
7. **O sistema deve** permitir reordenar itens via drag-and-drop.

---

#### RF-007 — Totais e Descontos

**User Story:** Como operador, quero ver os totais calculados automaticamente para conferir o valor final da proposta.

**Critérios de Aceitação:**

1. **O sistema deve** calcular o subtotal como a soma dos totais dos itens (com descontos por item já aplicados).
2. **O sistema deve** permitir desconto global (percentual ou fixo).
3. **O sistema deve** calcular o total final como subtotal menos desconto global.
4. **O sistema deve** exibir os totais em tempo real enquanto o operador edita.

---

#### RF-008 — Versionamento

**User Story:** Como operador, quero que o orçamento gere versões automáticas ao ser enviado para manter histórico.

**Critérios de Aceitação:**

1. **Quando** um operador enviar um orçamento pela primeira vez, **o sistema deve** criar a versão 1 e mudar o status para `enviado`.
2. **Quando** um operador alterar um orçamento já enviado e salvá-lo, **o sistema deve** criar uma nova versão (v2, v3...).
3. **O sistema deve** manter o histórico completo de todas as versões.
4. **O sistema deve** permitir visualizar versões anteriores sem alterá-las.
5. **Quando** uma nova versão for criada, **o sistema deve** invalidar o aceite da versão anterior (se houver).
6. **Quando** uma nova versão for criada, **o sistema deve** notificar o cliente por e-mail (se configurado).

---

#### RF-009 — Status do Orçamento

**User Story:** Como operador, quero acompanhar o status do orçamento para saber em que etapa ele está.

**Critérios de Aceitação:**

1. **O sistema deve** suportar os status: `rascunho`, `enviado`, `aprovado`, `reprovado`, `expirado`, `cancelado`.
2. **Quando** um orçamento for enviado, **o sistema deve** mudar o status para `enviado`.
3. **Quando** o cliente aprovar, **o sistema deve** mudar o status para `aprovado`.
4. **Quando** o cliente reprovar, **o sistema deve** mudar o status para `reprovado` e registrar o motivo (opcional).
5. **Quando** a data de validade expirar, **o sistema deve** mudar o status para `expirado` (via job agendado).
6. **Quando** um operador cancelar, **o sistema deve** mudar o status para `cancelado`.

---

### Módulo 3 — Entidades de Referência

#### RF-010 — Cliente

**User Story:** Como operador, quero buscar ou criar clientes durante a criação do orçamento sem sair do fluxo.

**Critérios de Aceitação:**

1. **Quando** um operador digitar no campo de cliente, **o sistema deve** buscar clientes existentes do tenant (autocomplete).
2. **Quando** um operador digitar um cliente que não existe, **o sistema deve** oferecer a opção "criar novo cliente".
3. **Quando** um operador criar um cliente, **o sistema deve** exigir nome e CPF/CNPJ validado, e permitir e-mail e telefone.
4. **Quando** um operador editar um cliente existente, **o sistema deve** atualizar apenas o cadastro do cliente. Orçamentos e versões já emitidos não devem ser alterados, pois preservam o snapshot do cliente no momento da emissão.
5. **O sistema deve** permitir desativar um cliente sem removê-lo (soft delete).

---

#### RF-011 — Empresa

**User Story:** Como operador, quero associar empresas como clientes PJ do orçamento.

**Critérios de Aceitação:**

1. **O sistema deve** distinguir dois tipos de empresa: `tenant` (emissora) e `cliente_pj` (destinatária).
2. **Quando** um operador buscar empresa como cliente PJ, **o sistema deve** usar autocomplete similar ao de cliente.
3. **O sistema deve** permitir que uma empresa cliente PJ tenha CNPJ, endereço e contatos.
4. **O sistema deve** permitir editar os dados da empresa cliente PJ sob demanda.

---

#### RF-012 — Responsável Técnico

**User Story:** Como operador, quero associar responsáveis técnicos aos itens do orçamento.

**Critérios de Aceitação:**

1. **Quando** um operador associar um responsável técnico a um item, **o sistema deve** buscar existentes (autocomplete).
2. **Quando** um operador digitar um responsável que não existe, **o sistema deve** oferecer a opção "criar novo".
3. **O sistema deve** permitir associar múltiplos itens ao mesmo responsável.
4. **O sistema deve** permitir editar os dados do responsável sob demanda.
5. **O sistema deve** permitir que um item não tenha responsável técnico associado.

---

### Módulo 4 — Templates

#### RF-013 — Template Global por Tenant

**User Story:** Como admin, quero editar o template do meu tenant para personalizar a aparência dos orçamentos.

**Critérios de Aceitação:**

1. **Cada tenant deve** ter exatamente um template ativo.
2. **Quando** um tenant for criado, **o sistema deve** criar um template padrão.
3. **O sistema deve** permitir editar o template a qualquer momento.
4. **O sistema deve** versionar o template apenas para fins de auditoria e reprodução fiel de versões anteriores de orçamentos. Cada versão de orçamento deve referenciar a versão do template vigente no momento da emissão.

---

#### RF-014 — Editor Visual de Template

**User Story:** Como admin, quero montar o template visualmente arrastando elementos sobre um canvas A4.

**Critérios de Aceitação:**

1. **O sistema deve** oferecer um canvas A4 (210mm x 297mm) para edição do template.
2. **O sistema deve** permitir upload de PDF de fundo (design base).
3. **O sistema deve** permitir upload de imagens (PNG, JPG, SVG) para compor o template.
4. **O sistema deve** permitir redimensionar, rotacionar e posicionar imagens.
5. **O sistema deve** permitir upload de fontes customizadas (TTF, OTF, WOFF, WOFF2).
6. **O sistema deve** agrupar fontes de uma mesma família.
7. **O sistema deve** permitir inserir placeholders de dados (ex: `{cliente}`, `{valor_total}`).
8. **O sistema deve** permitir delimitar áreas de conteúdo dinâmico com altura máxima.
9. **O sistema deve** permitir definir elementos comuns a todas as páginas (header/footer).
10. **O sistema deve** permitir configurar listas com tabulação entre dados (ex: `{item}.........{valor}`).
11. **O sistema deve** interpretar heading tags (h1, h2, h3) e sua hierarquia.

---

#### RF-015 — Quebra de Página Automática

**User Story:** Como operador, quero que listas longas de itens se estendam automaticamente em múltiplas páginas.

**Critérios de Aceitação:**

1. **Quando** uma lista de itens exceder a altura máxima da área configurada, **o sistema deve** gerar automaticamente uma nova página.
2. **O sistema deve** repetir o header em todas as páginas geradas.
3. **O sistema deve** repetir o footer em todas as páginas geradas.
4. **O sistema deve** garantir que um item não seja cortado entre páginas.

---

### Módulo 5 — Renderização e PDF

#### RF-016 — Geração de PDF

**User Story:** Como operador, quero gerar e baixar o PDF do orçamento em menos de 2 segundos.

**Critérios de Aceitação:**

1. **Quando** um operador solicitar o PDF, **o sistema deve** gerar o arquivo no servidor.
2. **O sistema deve** gerar o PDF em no máximo 2 segundos.
3. **O sistema deve** retornar o PDF como download de arquivo (sem diálogo de impressão do navegador).
4. **O sistema deve** aplicar o template ativo do tenant na renderização.
5. **O sistema deve** substituir os placeholders pelos dados reais do orçamento.
6. **O sistema deve** armazenar o PDF gerado como evidência imutável para auditoria. O arquivo armazenado é o documento oficial daquela versão e não deve ser regenerado nem modificado.
7. **O sistema deve** nomear o arquivo como `{numero_orcamento}-v{versao}.pdf`.

---

#### RF-017 — Hash do Documento

**User Story:** Como sistema, quero calcular o hash do PDF para garantir integridade documental.

**Critérios de Aceitação:**

1. **Quando** um PDF for gerado, **o sistema deve** calcular seu hash SHA-256.
2. **O sistema deve** armazenar o hash junto ao orçamento/versão.
3. **O sistema deve** usar o hash para validar a integridade do documento no momento do aceite.

---

### Módulo 6 — Aprovação e Assinatura

#### RF-018 — QR Code de Acesso

**User Story:** Como operador, quero que o PDF contenha um QR Code para o cliente acessar e aprovar online.

**Critérios de Aceitação:**

1. **Quando** um PDF for gerado, **o sistema deve** incluir um QR Code no documento.
2. **O QR Code deve** apontar para uma URL pública com token de alta entropia (UUID v4 + HMAC).
3. **O token deve** ser único por versão do orçamento.
4. **O token deve** expirar junto com a validade do orçamento.

---

#### RF-019 — Página Pública de Aprovação

**User Story:** Como cliente final, quero acessar o orçamento via QR Code e aprová-lo online.

**Critérios de Aceitação:**

1. **Quando** um cliente acessar o link com token válido, **o sistema deve** exibir o orçamento em modo leitura.
2. **O sistema deve** validar o hash do documento e exibir selo "Documento íntegro" se válido.
3. **O sistema deve** exibir botões "Aprovar" e "Reprovar".
4. **Quando** o cliente clicar em "Aprovar", **o sistema deve** exigir aceite explícito via checkbox.
5. **Quando** o cliente aprovar, **o sistema deve** registrar: IP, timestamp, user agent, hash do documento, método (`cliente`).
6. **Quando** o cliente aprovar, **o sistema deve** gerar um comprovante de aceite.
7. **Quando** o token for inválido ou expirado, **o sistema deve** exibir mensagem genérica de erro.

---

#### RF-020 — Aceite Manual pelo Operador

**User Story:** Como operador, quero registrar aceite manual quando o cliente aprovar por outro canal.

**Critérios de Aceitação:**

1. **Quando** um operador registrar um aceite manual, **o sistema deve** exigir justificativa.
2. **O aceite manual deve** registrar o operador como responsável pelo registro.
3. **O sistema deve** diferenciar aceite do cliente de aceite manual na auditoria.

---

#### RF-021 — Comprovante de Aceite

**User Story:** Como operador e cliente, quero acessar o comprovante de aceite para ter evidência documental.

**Critérios de Aceitação:**

1. **Quando** um aceite for registrado, **o sistema deve** gerar um comprovante em PDF.
2. **O comprovante deve** conter: número do orçamento, versão, data/hora, IP, user agent, hash do documento, método de aceite.
3. **O comprovante deve** ser acessível pelo operador e pelo cliente.

---

### Módulo 7 — Notificações

#### RF-022 — Envio de E-mail

**User Story:** Como operador, quero que o sistema envie e-mails automáticos para os envolvidos nos eventos do orçamento.

**Critérios de Aceitação:**

1. **Quando** um orçamento for enviado, **o sistema deve** enviar e-mail ao cliente com link e PDF anexo.
2. **Quando** o cliente aprovar, **o sistema deve** notificar o operador por e-mail.
3. **Quando** o cliente reprovar, **o sistema deve** notificar o operador por e-mail.
4. **Quando** uma nova versão for criada, **o sistema deve** notificar o cliente por e-mail.
5. **O sistema deve** permitir configurar templates de e-mail por tenant.
6. **O sistema deve** registrar envios na auditoria.

---

## Requisitos Não-Funcionais

### RNF-001 — Performance

1. **O sistema deve** gerar PDFs em no máximo 2 segundos.
2. **O sistema deve** responder requisições de API em no máximo 500ms para 95% dos casos.
3. **O sistema deve** suportar 20 usuários simultâneos sem degradação.

### RNF-002 — Segurança

1. **O sistema deve** armazenar senhas com Argon2id.
2. **O sistema deve** criptografar dados sensíveis com AES-256-GCM.
3. **O sistema deve** usar HTTPS/TLS 1.3 em produção.
4. **O sistema deve** usar cookies com `HttpOnly`, `Secure` e `SameSite=Lax`.
5. **O sistema deve** aplicar rate limiting em endpoints sensíveis.
6. **O sistema deve** aplicar Row-Level Security no PostgreSQL.

### RNF-003 — Auditoria

1. **O sistema deve** registrar eventos sensíveis com estado antes/depois.
2. **O sistema deve** manter registros por no mínimo 5 anos.

### RNF-004 — Usabilidade

1. **O sistema deve** ter interface responsiva (desktop-first).
2. **O sistema deve** oferecer editor visual de template com canvas A4.
3. **O sistema deve** oferecer autocomplete em entidades de referência.
4. **O sistema deve** oferecer feedback em tempo real em cálculos.

### RNF-005 — Manutenibilidade

1. **O sistema deve** ter cobertura de testes acima de 80%.
2. **O sistema deve** ter CI configurado (lint + testes + build).
3. **O sistema deve** usar tipagem estrita em TypeScript.
4. **O sistema deve** usar queries SQL com tipagem cuidadosa.

### RNF-006 — Portabilidade

1. **O sistema deve** rodar em Docker (dev e produção).
2. **O sistema deve** usar PostgreSQL 16+.
3. **O sistema deve** usar Node.js 22 LTS.

---

## Rastreabilidade

| Requisito | Módulo | Prioridade |
|-----------|--------|------------|
| RF-001 a RF-004 | Fundação | MVP |
| RF-005 a RF-009 | Orçamento Core | MVP |
| RF-010 a RF-012 | Entidades de Referência | MVP |
| RF-013 a RF-015 | Templates | MVP |
| RF-016 a RF-017 | PDF | MVP |
| RF-018 a RF-021 | Aprovação | MVP |
| RF-022 | Notificações | Fase 2 (simplificado no MVP) |