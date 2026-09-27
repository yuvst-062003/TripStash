/**
 * What a traveller calls a thing, rather than what the database calls it.
 *
 * Two columns are deliberately mixed here: what a place IS (a hostel, a
 * viewpoint) and what you DO there (hiking, diving). Tremendo Hostel answers to
 * both, and nobody scanning a city separates them, so neither does this.
 *
 * Kept in one place because the city filters, the catalog headings and the
 * profile picks all print the same words, and three copies would drift.
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  // what you do
  hike: 'Hiking',
  surf: 'Surf',
  volcano: 'Volcanoes',
  dive: 'Diving',
  spanish: 'Spanish',
  street_food: 'Street food',
  nightlife: 'Nightlife',
  waterfall: 'Waterfalls',
  ruins: 'Ruins',
  wildlife: 'Wildlife',
  coffee: 'Coffee',
  islands: 'Islands',

  // what a place is
  accommodation: 'Places to stay',
  bar: 'Bars',
  cafe: 'Cafés',
  restaurant: 'Food',
  viewpoint: 'Viewpoints',
  nature: 'Nature',
  attraction: 'Sights',
  activity: 'Things to do',
  shop: 'Shops',
  transport: 'Getting around',
  other: 'Everything else',
}

export function labelFor(slug: string): string {
  return ACTIVITY_LABELS[slug] ?? slug
}
