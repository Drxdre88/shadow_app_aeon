// Does a spoken question need a lookup tool before Vorath can answer it?
// Pure and deliberately cheap: no model call sits in front of the first word.
// A tool-less answer streams token by token; a tool round answers in one go,
// so tools run only when the words ask for something the grounding block
// can't hold: a lookup, something fresh, a board, or an undo. Anything else
// answers from the grounding, and the voice register tells Vorath to offer a
// lookup instead of guessing, so "yes, look it up" brings the tools back.

const LOOKUP = /\b(look(?:\s+\w+)?\s+up|search|find|check|dig\s+(?:in|into|up)|pull\s+up|go\s+through|recall|remind\s+me)\b/
const FRESH = /\b(latest|newest|recent(?:ly)?|today|tonight|this\s+(?:morning|afternoon|evening|week|month)|yesterday|last\s+(?:night|week|month)|so\s+far|right\s+now|currently|status|progress|update[sd]?|what(?:'s|\s+is|\s+has)\s+(?:new|happened|changed)|what\s+happened)\b/
const DID = /\bwhat\s+(?:did|have|has)\s+(?:i|we|you)\b|\bwhen\s+did\b|\bdo\s+you\s+remember\b|\bwhat\s+did\s+i\s+(?:say|decide)\b/
const BOARD = /\b(boards?|cards?|tasks?|backlog|sprint|projects?|tickets?)\b/
const UNDO = /\b(undo|veto|revert|forget|unlearn)\b/
const BRAIN = /\b(synthesis|overnight|cortex|brain\s+health|aether)\b/

export function voiceNeedsTools(text: string): boolean {
  const said = text.toLowerCase().replace(/[’`]/g, "'")
  return [LOOKUP, FRESH, DID, BOARD, UNDO, BRAIN].some((pattern) => pattern.test(said))
}
