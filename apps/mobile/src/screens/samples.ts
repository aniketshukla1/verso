// Dev-only label fixtures.
//
// The camera is unavailable on web and on the iOS Simulator, and iterating on
// the verdict UI should not require a packet of crisps on the desk. These run
// through the real API and the real canon — nothing is stubbed, only the
// capture step is skipped.
//
// `productKey` links one product's labels across markets, which is what lets a
// verdict offer "See the US label" directly. Real scans have no such link yet:
// finding a product's counterpart in another market is the Phase 2 pipeline
// (docs/PLAN.md §06), so for them the verdict offers the picker instead.

export interface SampleLabel {
  id: string;
  label: string;
  market: string;
  text: string;
  productKey?: string;
}

export const SAMPLES: SampleLabel[] = [
  { id: 'bromated', label: 'US bread · bromated', market: 'US',
    text: 'Enriched Flour, Water, Potassium Bromate, Azodicarbonamide, Calcium Propionate, Soy Lecithin, Salt.' },
  { id: 'in-snack', label: 'India snack · palmolein', market: 'IN',
    text: 'Refined Wheat Flour, Edible Vegetable Oil (Palmolein Oil), Sugar, Colour (INS 102), Preservative (INS 211), Antioxidant (INS 319), Flavour Enhancer (INS 621), Salt.' },
  { id: 'lays-in', label: "Lay's India", market: 'IN', productKey: 'lays-classic',
    text: 'Potato, Edible Vegetable Oil (Palmolein Oil), Salt, Spices & Condiments.' },
  { id: 'lays-us', label: "Lay's US", market: 'US', productKey: 'lays-classic',
    text: 'Potatoes, Vegetable Oil (Sunflower, Corn, and/or Canola Oil), Salt.' },
  { id: 'nutella-fr', label: 'Nutella FR · français', market: 'FR',
    text: 'Sucre, huile de palme, NOISETTES 13%, cacao maigre 7,4%, LAIT écrémé en poudre 6,6%, LACTOSERUM en poudre, émulsifiants: lécithines [SOJA), vanilline.' },
];
