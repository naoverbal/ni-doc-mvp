import type { FluentIcon } from '@fluentui/react-icons'
import {
  Board24Regular,
  BuildingMultiple24Regular,
  DocumentBulletList24Regular,
  History24Regular,
  LayoutColumnTwo24Regular,
  People24Regular,
  PersonBoard24Regular,
  Settings24Regular,
} from '@fluentui/react-icons'

// Item de navegação da sidebar (protótipo). `rota` só é definida para os itens
// já implementados; os demais aparecem desabilitados ("em breve"). `apenasAdmin`
// restringe o item a usuários admin (hoje: Template).
export interface ItemNavegacao {
  // Identificador estável, usado como key e para marcação da rota ativa.
  chave: string
  rotulo: string
  icone: FluentIcon
  // Rota do React Router; ausente quando o item ainda não tem destino.
  rota?: string
  // Quando true, o NavLink casa apenas com a rota exata (Dashboard, Template).
  // Itens sem `fim` permanecem ativos nas subrotas (ex.: Orçamentos).
  fim?: boolean
  apenasAdmin?: boolean
}

// Ordem e composição conforme o protótipo de alta fidelidade. Itens sem rota
// ainda (Clientes, Empresas, Responsáveis Técnicos, Auditoria, Configurações)
// ficam desabilitados até que as telas sejam entregues.
export const ITENS_NAVEGACAO: ItemNavegacao[] = [
  { chave: 'dashboard', rotulo: 'Dashboard', icone: Board24Regular, rota: '/dashboard', fim: true },
  { chave: 'orcamentos', rotulo: 'Orçamentos', icone: DocumentBulletList24Regular, rota: '/orcamentos' },
  { chave: 'clientes', rotulo: 'Clientes', icone: People24Regular },
  { chave: 'empresas', rotulo: 'Empresas', icone: BuildingMultiple24Regular },
  { chave: 'responsaveis', rotulo: 'Responsáveis Técnicos', icone: PersonBoard24Regular },
  {
    chave: 'template',
    rotulo: 'Template',
    icone: LayoutColumnTwo24Regular,
    rota: '/template',
    fim: true,
    apenasAdmin: true,
  },
  { chave: 'auditoria', rotulo: 'Auditoria', icone: History24Regular },
  { chave: 'configuracoes', rotulo: 'Configurações', icone: Settings24Regular },
]
