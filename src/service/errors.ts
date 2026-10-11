/** Bad input from an admin flow. The message is safe to show to the user. */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}
