// Wire types — the shapes the API actually sends. Kept separate from the
// Sequelize attribute types (server/sequelize/models/index.d.ts) because what
// goes over the wire is not what sits in the table: timestamps become ISO
// strings and DECIMAL columns arrive from pg as strings.
export interface ListResponse<T> {
  results: T[];
  total: number;
}

export interface ApiError {
  error: string;
  /** Present on 422s: which fields failed and why. */
  details?: Record<string, string>;
}
