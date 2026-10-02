export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly detalhes?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
