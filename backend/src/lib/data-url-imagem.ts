// Único formato aceito para imagens embutidas no template (auditoria B-5): data
// URL base64 de imagem raster ou SVG. O valor entra num atributo `src="..."` do
// HTML do PDF SEM escape, então qualquer aspa ou caractere fora do alfabeto base64
// permitiria injetar atributos (ex.: `onerror=`) ou apontar para recurso externo.
// SVG só é seguro aqui por ser usado via <img> (scripts não executam nesse contexto).
const DATA_URL_IMAGEM = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/

export function ehDataUrlImagemValido(valor: string): boolean {
  return DATA_URL_IMAGEM.test(valor)
}
