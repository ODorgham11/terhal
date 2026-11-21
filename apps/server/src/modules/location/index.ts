// Places the platform serves (governorates, districts, areas), their coverage, and the public copy of the tree.
// Booking and pricing resolve pins and walk the tree through what's exported here.
export { coveringLocationId, resolvePin } from "./application/coverage";
export { chainsOf, resolvedFrom } from "./application/queries";
export { seedGovernorates, type GovernorateFeature } from "./application/seed-governorates";
export { adminLocationRoutes, siteLocationRoutes, staffLocationRoutes } from "./http/routes";
