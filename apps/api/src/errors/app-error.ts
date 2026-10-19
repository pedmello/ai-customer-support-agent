export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
