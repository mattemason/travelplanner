export const FUEL_TYPES = [
  { key: "diesel", label: "Diesel" },
  { key: "petrol", label: "Petrol" },
] as const;
export type FuelType = (typeof FUEL_TYPES)[number]["key"];

export type Vehicle = { lPer100km: number | null; fuelType: FuelType | null };
export type FuelPrices = { diesel: number | null; petrol: number | null };

/** Estimated fuel cost in dollars for a distance, or null when the vehicle or price isn't set. */
export function fuelCost(distanceM: number, vehicle: Vehicle, prices: FuelPrices): number | null {
  if (!vehicle.lPer100km || !vehicle.fuelType) return null;
  const price = prices[vehicle.fuelType];
  if (!price) return null;
  return (distanceM / 1000) * (vehicle.lPer100km / 100) * price;
}

export const formatCost = (dollars: number) =>
  dollars >= 100 ? `$${Math.round(dollars)}` : `$${dollars.toFixed(dollars < 10 ? 2 : 0)}`;
