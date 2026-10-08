#!/usr/bin/env bash
#
# gerar-mensagem-commit.sh — gera uma mensagem de commit convencional de forma
# determinística (sem LLM, sem rede, zero custo) a partir do diff em staged.
#
# Infere, a partir dos caminhos dos arquivos em staged:
#   - tipo:    feat | fix | test | docs | chore | ci | style  (default: feat)
#   - escopo:  auth | orcamento | cliente | empresa | template | pdf | aceite
#              | db | crypto | ci | deps  (quando identificável)
#   - assunto: frase em minúscula, imperativo, sem ponto final, <= 72 chars
#
# Convenções: .kiro/steering/commit-format.md
#
# Uso:
#   scripts/gerar-mensagem-commit.sh            # imprime a mensagem no STDOUT
#   npm run commit:msg                          # idem, via npm
#
# A descrição é um palpite por heurística; revise/edite antes de confirmar.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "erro: não é um repositório git" >&2
  exit 1
fi
cd "$REPO_ROOT"

if git diff --cached --quiet; then
  echo "erro: nada em staged" >&2
  exit 1
fi

# Arquivos em staged (apenas caminhos). Loop portável (bash 3.2 do macOS não
# tem `mapfile`).
ARQUIVOS=()
while IFS= read -r _linha; do
  [[ -n "$_linha" ]] && ARQUIVOS+=("$_linha")
done < <(git diff --cached --name-only)
TOTAL=${#ARQUIVOS[@]}

# ---------------------------------------------------------------------------
# 1. Tipo — baseado nos caminhos. Verifica do mais específico ao mais genérico.
# ---------------------------------------------------------------------------
# Flags auxiliares.
tem_codigo=false   # arquivos de código em src/ (não-teste)
tem_teste=false
tem_doc=false
tem_ci=false
tem_config=false   # package.json, configs, dotfiles de ferramenta
outros=false

for f in "${ARQUIVOS[@]}"; do
  case "$f" in
    *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/__tests__/*)
      tem_teste=true ;;
    *.md|*.mdx|docs/*|*/docs/*)
      tem_doc=true ;;
    .github/*|*/.github/*)
      tem_ci=true ;;
    package.json|package-lock.json|*/package.json|*.config.*|.*rc|.*rc.*|*.yml|*.yaml|Dockerfile|*/Dockerfile|docker-compose*.yml|.env.example|tsconfig*.json)
      tem_config=true ;;
    *.ts|*.tsx|*.js|*.jsx|src/*|*/src/*)
      tem_codigo=true ;;
    *)
      outros=true ;;
  esac
done

# Resolve o tipo por prioridade.
if $tem_codigo; then
  TIPO="feat"            # default para mudança de código (conforme combinado)
elif $tem_teste; then
  TIPO="test"
elif $tem_ci; then
  TIPO="ci"
elif $tem_doc; then
  TIPO="docs"
elif $tem_config; then
  TIPO="chore"
else
  TIPO="chore"
fi

# ---------------------------------------------------------------------------
# 2. Escopo — procura um domínio conhecido nos caminhos.
# ---------------------------------------------------------------------------
# Escopos válidos do steering + mapeamento de palavras-chave de caminho.
detectar_escopo() {
  local caminhos_concat
  caminhos_concat=$(printf '%s\n' "${ARQUIVOS[@]}")
  # Pares "regex-no-caminho:escopo", na ordem de preferência.
  local pares=(
    "auth|login|sessao|senha|token:auth"
    "orcamento:orcamento"
    "cliente:cliente"
    "empresa|tenant:empresa"
    "template:template"
    "pdf|puppeteer:pdf"
    "aceite:aceite"
    "crypto:crypto"
    "db/|migrations|migrate|seed|repositor:db"
    "\\.github/|ci\\.yml:ci"
    "package.*json|package-lock:deps"
  )
  local par regex escopo
  for par in "${pares[@]}"; do
    regex="${par%%:*}"
    escopo="${par##*:}"
    if printf '%s' "$caminhos_concat" | grep -Eiq "$regex"; then
      echo "$escopo"
      return 0
    fi
  done
  return 1
}

ESCOPO="$(detectar_escopo || true)"

# ---------------------------------------------------------------------------
# 3. Assunto — descreve a mudança a partir dos arquivos/status.
# ---------------------------------------------------------------------------
# Verbo pela natureza predominante da mudança (A=add, M=modify, D=delete).
STATUS=()
while IFS= read -r _linha; do
  [[ -n "$_linha" ]] && STATUS+=("$_linha")
done < <(git diff --cached --name-status)
n_add=0; n_mod=0; n_del=0
for linha in "${STATUS[@]}"; do
  case "${linha:0:1}" in
    A) n_add=$((n_add+1)) ;;
    D) n_del=$((n_del+1)) ;;
    *) n_mod=$((n_mod+1)) ;;
  esac
done

if (( n_del > n_add && n_del > n_mod )); then
  VERBO="remove"
elif (( n_add > n_mod )); then
  VERBO="adiciona"
else
  VERBO="atualiza"
fi

# Alvo da frase: nome base de um arquivo (se único) ou a área/pasta comum.
if (( TOTAL == 1 )); then
  base="$(basename "${ARQUIVOS[0]}")"
  base="${base%.*}"                       # sem extensão
  base="${base//./ }"                     # pontos -> espaços
  ALVO="$base"
else
  # Pasta de nível mais informativo comum ao conjunto.
  primeiro_dir="$(dirname "${ARQUIVOS[0]}")"
  comum="$primeiro_dir"
  for f in "${ARQUIVOS[@]}"; do
    d="$(dirname "$f")"
    while [[ "$d" != "$comum" && "$comum" != "." ]]; do
      [[ "$d" == "$comum"* ]] && break
      comum="$(dirname "$comum")"
    done
  done
  if [[ "$comum" == "." || -z "$comum" ]]; then
    ALVO="${TOTAL} arquivos"
  else
    ALVO="$(basename "$comum")"
  fi
fi

ASSUNTO="${VERBO} ${ALVO}"

# ---------------------------------------------------------------------------
# 4. Monta a linha final e aplica as regras de formato.
# ---------------------------------------------------------------------------
if [[ -n "$ESCOPO" ]]; then
  PREFIXO="${TIPO}(${ESCOPO}): "
else
  PREFIXO="${TIPO}: "
fi

# Minúscula na descrição (o prefixo já é minúsculo), sem ponto final.
ASSUNTO="$(printf '%s' "$ASSUNTO" | tr '[:upper:]' '[:lower:]')"
ASSUNTO="${ASSUNTO%.}"

LINHA="${PREFIXO}${ASSUNTO}"

# Limite rígido de 72 caracteres (commitlint). Corta preservando o prefixo.
MAX=72
if (( ${#LINHA} > MAX )); then
  disponivel=$(( MAX - ${#PREFIXO} ))
  (( disponivel < 1 )) && disponivel=1
  ASSUNTO="${ASSUNTO:0:disponivel}"
  ASSUNTO="${ASSUNTO%" "}"               # não termina em espaço
  LINHA="${PREFIXO}${ASSUNTO}"
fi

printf '%s\n' "$LINHA"
