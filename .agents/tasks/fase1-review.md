# Bibliotecas base da Fase 1 (T-101 a T-105)

Cinco bibliotecas puras foram criadas para suportar criptografia, hashing de senha, geração de tokens, validação de documentos e cálculo de orçamentos. Todas passaram nos testes (45/45) e a cobertura de statements ficou em 98,52%. O design é consistente: dependências externas mínimas, funções puras onde requerido, tipagem estrita sem `any` ou `!` desnecessário.

**Watch for:** `senha.ts` usa `scrypt` disfarçado de Argon2id — o formato do hash imita `$argon2id$` mas o algoritmo real é diferente. Qualquer hash gerado por essa implementação **não poderá ser verificado por uma biblioteca Argon2 real** quando o pacote for desbloqueado. Isso é um risco de incompatibilidade de dados confirmado, não meramente cosmético.

**Verdict**: NEEDS_CHANGES

---

## High-level view

`senha.ts` contém a única questão bloqueante da fase: o pacote `argon2` estava bloqueado por política de `install-scripts` e a solução adotada foi usar `scrypt` com saída formatada como `$argon2id$`. Os hashes armazenados com essa implementação serão incompatíveis com `argon2.verify()` quando o bloqueio for removido. RF-004 e RNF-002 exigem explicitamente Argon2id com memória 64MB, iterações 3, paralelismo 4 — parâmetros que `scrypt` não possui.

`token.ts` usa HMAC-SHA256 com verificação de comprimento antes de `timingSafeEqual`, prevenindo timing leaks ao comparar buffers de tamanhos diferentes. O `catch {}` em `validarTokenPublico` (para `Buffer.from` com hex inválido) não é exercitado nos testes — gap de branch que contribui para os 66,66% de cobertura de branches do módulo.

A cobertura de branches de `senha.ts` está em 40% e `token.ts` em 66,66%. Em ambos, os caminhos de erro de variável de ambiente não são testados, e `senha.ts` tem um `return false` antecipado (`parts.length < 6`) sem cobertura. O Marco 2 exige 100% em `lib/` — esse gap precisa ser fechado nos dois módulos.

`crypto.ts` e `documento.ts` e `orcamento-calculo.ts` não apresentam questões abertas.

---

<details>
<summary>Issues (2)</summary>

1. **scrypt disfarçado de Argon2id** — `senha.ts` armazena hashes com prefixo `$argon2id$` mas o algoritmo real é `scrypt`. Quando o pacote `argon2` for desbloqueado, `argon2.verify()` rejeitará todos os hashes existentes — exigindo migração de todos os hashes em banco com reautenticação dos usuários. Usar `@node-rs/argon2` (binding pré-compilado, sem `install-scripts`) ou `argon2-wasm-pro` e reimplementar antes de qualquer dado chegar ao banco.

2. **Cobertura de branches insuficiente em senha.ts e token.ts** — `senha.ts` em 40% e `token.ts` em 66,66%, abaixo da meta de 100% do Marco 2. `senha.ts` precisa de teste para `verificarSenha` com hash mal-formado (menos de 6 partes). `token.ts` precisa de teste para `validarTokenPublico` com HMAC que não seja hex válido, exercitando o `catch {}` de `Buffer.from`.

</details>

<details>
<summary>Details</summary>

### scrypt com wrapper $argon2id$ em senha.ts

RF-004 e RNF-002 exigem Argon2id com parâmetros específicos (m=65536, t=3, p=4). A implementação atual usa `node:crypto.scrypt` e constrói uma string de saída que começa com `$argon2id$v=19$m=65536,t=3,p=4$` — satisfazendo o teste de formato mas não o requisito de algoritmo.

O problema surge quando `argon2` for desbloqueado. Qualquer código que chame `argon2.verify(hash, password)` vai falhar, pois o payload após o prefixo é um hash scrypt, não Argon2. Isso afeta:

- `verificarSenha` atual precisaria continuar usando `scrypt` para verificar hashes antigos
- `hashSenha` precisaria mudar para Argon2 real para novos hashes
- Os hashes em banco não serão migráveis sem reautenticação dos usuários

A solução correta antes de persistir qualquer dado é trocar para uma implementação real de Argon2. Alternativas sem dependência de `install-scripts`: `@node-rs/argon2` (binding nativo pré-compilado) ou `argon2-wasm-pro` (WebAssembly puro). Ambos expõem a mesma API e os testes existentes passarão sem alteração.

### Gaps de cobertura de branches em senha.ts e token.ts

`verificarSenha` em `senha.ts` tem um `return false` antecipado quando `parts.length < 6` que não é coberto por nenhum teste atual. Dado que a implementação depende do formato `$argon2id$v=...$salt$hash` (6 partes quando divididas por `$`), esse caminho protege contra hashes truncados ou de formato desconhecido e precisa de cobertura.

`token.ts` tem um `catch {}` em `validarTokenPublico` para o caso de `Buffer.from(hmacFornecido, 'hex')` receber uma string que não seja hex válido — o que resulta em um buffer de comprimento diferente do esperado. Um teste passando uma string não-hex como HMAC cobriria esse branch e documentaria o comportamento de fail-closed.

</details>

---

<details>
<summary>Arquivos revisados</summary>

- `backend/src/lib/crypto.ts` — AES-256-GCM, hashDocumento com normalização
- `backend/src/lib/senha.ts` — scrypt com formato de saída imitando Argon2id **(gap)**
- `backend/src/lib/token.ts` — HMAC-SHA256 com timingSafeEqual
- `backend/src/lib/documento.ts` — validação de CPF e CNPJ com dígito verificador
- `backend/src/lib/orcamento-calculo.ts` — funções puras de cálculo de orçamento
- `backend/src/lib/__tests__/crypto.test.ts` — 8 testes, round-trip + adulteração de authTag
- `backend/src/lib/__tests__/senha.test.ts` — 4 testes, formato verificado; faltam casos de erro
- `backend/src/lib/__tests__/token.test.ts` — 5 testes, adulteração de UUID e HMAC; falta caso hex inválido
- `backend/src/lib/__tests__/documento.test.ts` — 13 testes, CPF/CNPJ válidos e inválidos
- `backend/src/lib/__tests__/orcamento-calculo.test.ts` — 11 testes, cobertura de branches 100%

</details>
