export class AiForbiddenError extends Error {
  constructor() {
    super('AI features are restricted to administrators')
    this.name = 'AiForbiddenError'
  }
}
