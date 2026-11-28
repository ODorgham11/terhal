// The driver's trip, cached by the link's token: the page and the form both write to it.
export const reportKey = (token: string) => ["report", token] as const;
