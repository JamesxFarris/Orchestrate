import { PALETTE } from './palette.ts';
import { archetypeFor, type Archetype } from './scene/archetypes.ts';
import type { Team, TeamRole, TeamSquad } from './store.ts';

export interface Placement {
  role: TeamRole;
  x: number;
  z: number;
  height: number;
  width: number;
  archetype: Archetype;
  /** Accent colour: squad colour, or HQ gold. */
  accent: string;
  squad?: TeamSquad;
}

export interface District {
  squad: TeamSquad;
  angle: number;
  x: number;
  z: number;
  /** Half-extent of the district pad. */
  size: number;
}

export interface CityLayout {
  buildings: Placement[];
  byId: Map<string, Placement>;
  districts: District[];
  circleRadius: number;
  /** Radius of the paved central plaza (HQ + Tech Circle + leads). */
  plazaRadius: number;
}

export const HQ_ACCENT = PALETTE.sand;
export const PLATFORM_RADIUS = 125;

/** Radius of a district's paved plaza (its towers stand on it). */
export const districtPlazaRadius = (size: number) => size + 3;


const CIRCLE_RADIUS = 22;
const DISTRICT_RADIUS = 64;
const SPACING = 11.5;

/**
 * Downtown HQ in the middle, the Tech Circle ring around it with each squad lead standing on the rim
 * facing its district, and one district per squad radiating outward.
 */
export function layoutCity(team: Team): CityLayout {
  const buildings: Placement[] = [];
  const districts: District[] = [];
  const n = Math.max(team.squads.length, 1);
  const angleOf = (i: number) => -Math.PI / 2 - Math.PI / 4 + (i * 2 * Math.PI) / n;
  const place = (role: TeamRole, x: number, z: number, accent: string, squad?: TeamSquad) => {
    const archetype = archetypeFor(role);
    buildings.push({ role, x, z, height: archetype.height, width: archetype.footprint, archetype, accent, squad });
  };

  // HQ: master in the centre, other squad-less roles in an inner ring between the districts.
  const hq = team.roles.filter((r) => !r.squad);
  const master = hq.find((r) => r.kind === 'master');
  if (master) place(master, 0, 0, HQ_ACCENT);
  hq.filter((r) => r !== master).forEach((r, i, arr) => {
    const a = angleOf(0) + Math.PI / n + (i * 2 * Math.PI) / Math.max(arr.length, 1);
    place(r, Math.cos(a) * 14.5, Math.sin(a) * 14.5, HQ_ACCENT);
  });

  team.squads.forEach((squad, i) => {
    const a = angleOf(i);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const members = team.roles.filter((r) => r.squad === squad.id);
    const lead = members.find((r) => r.kind === 'lead');
    if (lead) place(lead, dx * CIRCLE_RADIUS, dz * CIRCLE_RADIUS, squad.color, squad);

    // Remaining members stand in rows across the radial direction.
    const rest = members.filter((r) => r !== lead);
    const perRow = 3;
    rest.forEach((r, j) => {
      const row = Math.floor(j / perRow);
      const inRow = Math.min(perRow, rest.length - row * perRow);
      const col = (j % perRow) - (inRow - 1) / 2;
      const radial = DISTRICT_RADIUS + row * SPACING;
      place(r, dx * radial - dz * col * SPACING, dz * radial + dx * col * SPACING, squad.color, squad);
    });
    const rows = Math.ceil(rest.length / perRow);
    districts.push({
      squad,
      angle: a,
      x: dx * (DISTRICT_RADIUS + ((rows - 1) * SPACING) / 2),
      z: dz * (DISTRICT_RADIUS + ((rows - 1) * SPACING) / 2),
      size: Math.max(Math.min(rest.length, perRow), 1) * SPACING * 0.5 + 3,
    });
  });

  return { buildings, byId: new Map(buildings.map((b) => [b.role.id, b])), districts, circleRadius: CIRCLE_RADIUS, plazaRadius: CIRCLE_RADIUS + 8 };
}
