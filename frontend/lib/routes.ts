// Where someone lands after signing in: staff go to their dashboard, everyone else to the main site.
export const homePathFor = (role: string | undefined) => (role === "STAFF" ? "/dashboard" : "/");
