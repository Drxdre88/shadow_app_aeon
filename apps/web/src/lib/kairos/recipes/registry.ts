import type { Recipe, RecipeDescriptor } from './_recipe'
import { BRIEF } from './brief'

// Phase 3: static frozen registry. Recipes are added by importing them and
// listing them in RECIPES below — matches the static-import convention used
// for PROVIDERS in lib/ai/providers.ts and STREAM_CLASSES in streamClass.ts.
//
// Doc 17 §Phase 11 upgrades this to a hybrid (code recipes + DB-stored
// data recipes) when Kairos can author his own. Until then, registry stays
// closed and side-effect-free — no registerRecipe(), no mutation.

const RECIPES: Readonly<Record<string, Recipe>> = Object.freeze({ BRIEF })

export function getRecipe(name: string): Recipe | null {
  return Object.prototype.hasOwnProperty.call(RECIPES, name) ? RECIPES[name] : null
}

export function listRecipes(): RecipeDescriptor[] {
  return Object.values(RECIPES).map(({ name, description, reads, writes }) => ({
    name,
    description,
    reads,
    writes,
  }))
}
