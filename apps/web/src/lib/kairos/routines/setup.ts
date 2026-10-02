// Links and constants for the Set up Kairos checklist (pure — safe in client components).

export const CLAUDE_ROUTINES_URL = 'https://claude.ai/code/routines'
export const KAIROS_CONNECTOR_NAME = 'aeon'

// claude.ai opens its "Add custom connector" form pre-filled from these params;
// the user only reviews it and signs in.
export function claudeConnectorInstallUrl(mcpUrl: string): string {
  const params = new URLSearchParams({
    modal: 'add-custom-connector',
    connectorName: KAIROS_CONNECTOR_NAME,
    connectorUrl: mcpUrl,
  })
  return `https://claude.ai/customize/connectors?${params.toString()}`
}
