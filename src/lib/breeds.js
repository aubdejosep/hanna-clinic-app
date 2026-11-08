// Breed suggestions for the pet form: the standard names the importer uses.
import { BREED_MAP } from '../../scripts/breeds.mjs'

export const BREED_NAMES = [...new Set(Object.values(BREED_MAP).filter(Boolean))].sort()
