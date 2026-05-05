/**
 * Tile-grid cartogram positions for US states + DC. A hand-tuned layout so each
 * state occupies one grid cell — loses geographic accuracy but makes small
 * states (RI, CT, DC) fully visible and treats every state equally.
 *
 * Coordinates: (col, row). Origin at top-left. Deliberately compact.
 */
export interface StateCell {
  abv: string;
  name: string;
  col: number;
  row: number;
}

export const STATE_GRID: readonly StateCell[] = [
  // Row 0 (Alaska top-left, Maine top-right-ish)
  { abv: 'AK', name: 'Alaska', col: 0, row: 0 },
  { abv: 'ME', name: 'Maine', col: 10, row: 0 },
  // Row 1
  { abv: 'VT', name: 'Vermont', col: 9, row: 1 },
  { abv: 'NH', name: 'New Hampshire', col: 10, row: 1 },
  // Row 2
  { abv: 'WA', name: 'Washington', col: 1, row: 2 },
  { abv: 'MT', name: 'Montana', col: 2, row: 2 },
  { abv: 'ND', name: 'North Dakota', col: 3, row: 2 },
  { abv: 'MN', name: 'Minnesota', col: 4, row: 2 },
  { abv: 'IL', name: 'Illinois', col: 5, row: 2 },
  { abv: 'WI', name: 'Wisconsin', col: 6, row: 2 },
  { abv: 'MI', name: 'Michigan', col: 7, row: 2 },
  { abv: 'NY', name: 'New York', col: 9, row: 2 },
  { abv: 'MA', name: 'Massachusetts', col: 10, row: 2 },
  // Row 3
  { abv: 'ID', name: 'Idaho', col: 1, row: 3 },
  { abv: 'WY', name: 'Wyoming', col: 2, row: 3 },
  { abv: 'SD', name: 'South Dakota', col: 3, row: 3 },
  { abv: 'IA', name: 'Iowa', col: 4, row: 3 },
  { abv: 'IN', name: 'Indiana', col: 5, row: 3 },
  { abv: 'OH', name: 'Ohio', col: 6, row: 3 },
  { abv: 'PA', name: 'Pennsylvania', col: 7, row: 3 },
  { abv: 'NJ', name: 'New Jersey', col: 8, row: 3 },
  { abv: 'CT', name: 'Connecticut', col: 9, row: 3 },
  { abv: 'RI', name: 'Rhode Island', col: 10, row: 3 },
  // Row 4
  { abv: 'OR', name: 'Oregon', col: 1, row: 4 },
  { abv: 'NV', name: 'Nevada', col: 2, row: 4 },
  { abv: 'UT', name: 'Utah', col: 3, row: 4 },
  { abv: 'NE', name: 'Nebraska', col: 4, row: 4 },
  { abv: 'MO', name: 'Missouri', col: 5, row: 4 },
  { abv: 'KY', name: 'Kentucky', col: 6, row: 4 },
  { abv: 'WV', name: 'West Virginia', col: 7, row: 4 },
  { abv: 'VA', name: 'Virginia', col: 8, row: 4 },
  { abv: 'MD', name: 'Maryland', col: 9, row: 4 },
  { abv: 'DE', name: 'Delaware', col: 10, row: 4 },
  // Row 5
  { abv: 'CA', name: 'California', col: 1, row: 5 },
  { abv: 'CO', name: 'Colorado', col: 2, row: 5 },
  { abv: 'KS', name: 'Kansas', col: 3, row: 5 },
  { abv: 'AR', name: 'Arkansas', col: 4, row: 5 },
  { abv: 'TN', name: 'Tennessee', col: 5, row: 5 },
  { abv: 'NC', name: 'North Carolina', col: 6, row: 5 },
  { abv: 'SC', name: 'South Carolina', col: 7, row: 5 },
  { abv: 'DC', name: 'District of Columbia', col: 9, row: 5 },
  // Row 6
  { abv: 'AZ', name: 'Arizona', col: 2, row: 6 },
  { abv: 'NM', name: 'New Mexico', col: 3, row: 6 },
  { abv: 'OK', name: 'Oklahoma', col: 4, row: 6 },
  { abv: 'LA', name: 'Louisiana', col: 5, row: 6 },
  { abv: 'MS', name: 'Mississippi', col: 6, row: 6 },
  { abv: 'AL', name: 'Alabama', col: 7, row: 6 },
  { abv: 'GA', name: 'Georgia', col: 8, row: 6 },
  // Row 7
  { abv: 'HI', name: 'Hawaii', col: 0, row: 7 },
  { abv: 'TX', name: 'Texas', col: 4, row: 7 },
  { abv: 'FL', name: 'Florida', col: 8, row: 7 },
];

export const STATE_GRID_COLS = 11;
export const STATE_GRID_ROWS = 8;
