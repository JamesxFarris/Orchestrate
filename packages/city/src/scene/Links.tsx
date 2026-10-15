import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { AgentActivity } from '@orchestrate/shared';
import type { CityLayout, Placement } from '../layout.ts';
import { ACTIVITY_COLOR, useCity, type TeamRole } from '../store.ts';

/** Who an active agent is exchanging work with right now. */
function partnerOf(role: TeamRole, roles: TeamRole[]): TeamRole | undefined {
  const inSquad = (kind: string) => roles.find((r) => r.squad === role.squad && r.kind === kind);
  const master = roles.find((r) => r.kind === 'master');
  switch (role.kind) {
    case 'qa':
      return inSquad('dev') ?? inSquad('lead'); // tests hand over to the implementer
    case 'dev':
    case 'analyst':
      return inSquad('lead'); // diffs and specs go up for review
    case 'lead':
    case 'architect':
    case 'qa_head':
      return master;
    default:
      return undefined;
  }
}

function arc(a: Placement, b: Placement): THREE.Vector3[] {
  const from = new THREE.Vector3(a.x, a.archetype.top * 0.82, a.z);
  const to = new THREE.Vector3(b.x, b.archetype.top * 0.82, b.z);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y = Math.max(from.y, to.y) + from.distanceTo(to) * 0.22;
  return new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(40);
}

/** A dashed line whose dashes flow from sender to receiver, like packets on a wire. */
function FlowLine({ points, color }: { points: THREE.Vector3[]; color: string }) {
  const ref = useRef<{ material: { dashOffset: number } }>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * 2.2;
  });
  return (
    <Line
      ref={ref as never}
      points={points}
      color={color}
      lineWidth={2.6}
      dashed
      dashSize={1.1}
      gapSize={0.7}
      transparent
      opacity={0.9}
      toneMapped={false}
    />
  );
}

const NO_ROLES: TeamRole[] = [];

export function Links({ layout }: { layout: CityLayout }) {
  // Only who is active, and how, decides the lines. Selecting all of `agents` re-rendered on every
  // progress and cost event, and each re-render rebuilt every line's geometry.
  const active = useCity((s) =>
    Object.values(s.agents)
      .filter((a) => a.activity !== 'idle')
      .map((a) => `${a.agentId}:${a.activity}`)
      .sort()
      .join('|'),
  );
  // a module-level empty list: `?? []` would be a new array on every call, which re-renders forever
  const roles = useCity((s) => s.team?.roles ?? NO_ROLES);
  const arcs = useRef({ layout, byKey: new Map<string, THREE.Vector3[]>() });

  const links = useMemo(() => {
    // arcs are cached per pair; a new layout moves the buildings, so start over
    if (arcs.current.layout !== layout) arcs.current = { layout, byKey: new Map() };
    const out: { key: string; points: THREE.Vector3[]; color: string }[] = [];
    for (const entry of active ? active.split('|') : []) {
      const [agentId, activity] = entry.split(':') as [string, AgentActivity];
      const role = roles.find((r) => r.id === agentId);
      const partner = role && partnerOf(role, roles);
      const from = layout.byId.get(agentId);
      const to = partner && layout.byId.get(partner.id);
      if (!from || !to) continue;
      const key = `${agentId}->${partner.id}`;
      let points = arcs.current.byKey.get(key);
      if (!points) arcs.current.byKey.set(key, (points = arc(from, to)));
      out.push({ key, points, color: ACTIVITY_COLOR[activity] });
    }
    return out;
  }, [active, roles, layout]);

  return (
    <>
      {links.map((l) => (
        <FlowLine key={l.key} points={l.points} color={l.color} />
      ))}
    </>
  );
}
