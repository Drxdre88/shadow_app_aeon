export function initiativeEnabled(): boolean {
  return process.env.KAIROS_INITIATIVE === '1'
}
