import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components'

// Rampa de marca do ni-doc (verde-sálvia, base no tom 60 = #4d5d53).
// 10 = tom mais escuro → 160 = mais claro. Gerada no Fluent Theme Designer
// para garantir contraste AA; ver .kiro/steering/ui.md.
const marca: BrandVariants = {
  10: '#171d19',
  20: '#222924',
  30: '#2d352f',
  40: '#38423a',
  50: '#414d44',
  60: '#4d5d53',
  70: '#5a6b60',
  80: '#6b7c72',
  90: '#7c8d83',
  100: '#8fa096',
  110: '#a4b4aa',
  120: '#b9c8be',
  130: '#cddad2',
  140: '#dfe8e3',
  150: '#ecf1ee',
  160: '#f7faf8',
}

// Fontes do projeto: Inter para texto, JetBrains Mono para números/códigos.
const fontFamilyBase = 'Inter, system-ui, -apple-system, sans-serif'
const fontFamilyMonospace = 'JetBrains Mono, Menlo, monospace'

export const lightTheme: Theme = {
  ...createLightTheme(marca),
  fontFamilyBase,
  fontFamilyMonospace,
}

export const darkTheme: Theme = {
  ...createDarkTheme(marca),
  fontFamilyBase,
  fontFamilyMonospace,
}
