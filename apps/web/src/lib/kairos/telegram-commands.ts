import { sendMessage } from '@/lib/kairos/telegram'

export type CommandRouter = (userId: string, body: string, send: (text: string) => Promise<unknown>) => Promise<boolean>

// Owner command routers (promises, predictions, agenda). A failure to route
// hands the text to chat.
export async function routeOwnerCommands(
  name: string,
  router: CommandRouter,
  chatId: number | string,
  userId: string,
  body: string,
): Promise<boolean> {
  try {
    return await router(userId, body, (text) => sendMessage(chatId, text))
  } catch (err) {
    console.error(`[telegram-webhook] ${name}-command routing failed — handing the text to chat`, err)
    return false
  }
}
